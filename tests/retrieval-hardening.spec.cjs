const fs = require('node:fs')
const path = require('node:path')
const { test, expect } = require('@playwright/test')

const API_BASE_URL = process.env.TEST_API_BASE_URL || 'http://127.0.0.1:7072/api'
const SAMPLE_TRANSCRIPT = fs.readFileSync(
  path.join(__dirname, '..', 'samples', 'sample_health_dialog.txt'),
  'utf8',
)
const LOCAL_SETTINGS_PATH = path.join(__dirname, '..', 'local.settings.json')

function readConfiguredKeys() {
  const keys = new Set()

  for (const [key, value] of Object.entries(process.env)) {
    if (value) {
      keys.add(key)
    }
  }

  if (!fs.existsSync(LOCAL_SETTINGS_PATH)) {
    return keys
  }

  try {
    const localSettings = JSON.parse(fs.readFileSync(LOCAL_SETTINGS_PATH, 'utf8'))
    for (const [key, value] of Object.entries(localSettings.Values || {})) {
      if (value) {
        keys.add(key)
      }
    }
  } catch (error) {
    throw new Error(`Unable to parse local.settings.json for regression preflight: ${error.message}`)
  }

  return keys
}

const CONFIGURED_KEYS = readConfiguredKeys()
const REQUIRED_RUNTIME_KEYS = ['AZURE_SEARCH_ENDPOINT']
const MISSING_RUNTIME_KEYS = REQUIRED_RUNTIME_KEYS.filter((key) => !CONFIGURED_KEYS.has(key))
let processedEncounterPromise
const LOCAL_DEV_AUTH_HEADERS = {
  'X-MS-CLIENT-PRINCIPAL-ID': process.env.TEST_PRINCIPAL_ID || 'local-dev-user',
  'X-MS-CLIENT-PRINCIPAL-NAME': process.env.TEST_PRINCIPAL_NAME || 'Local Developer',
  'X-MS-CLIENT-PRINCIPAL-EMAIL': process.env.TEST_PRINCIPAL_EMAIL || 'local.developer@localhost',
}

function withAuth(options = {}) {
  return {
    ...options,
    headers: {
      ...LOCAL_DEV_AUTH_HEADERS,
      ...(options.headers || {}),
    },
  }
}

async function stubAuthenticatedBrowserSession(page, overrides = {}) {
  const sessionPayload = {
    authenticated: true,
    user_id: 'browser-retrieval-user',
    email: 'browser.retrieval@example.com',
    name: 'Browser Retrieval User',
    identity_provider: 'aad',
    tenant_id: 'tenant-retrieval',
    role: 'owner',
    memberships: [
      {
        tenant_id: 'tenant-retrieval',
        tenant_name: 'Retrieval Tenant',
        tenant_slug: 'retrieval-tenant',
        role: 'owner',
      },
    ],
    can_create_tenant: true,
    ...overrides,
  }

  await page.route('**/.auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ user_id: sessionPayload.user_id }]),
    })
  })

  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(sessionPayload),
    })
  })
}

function buildSegments(transcript) {
  return transcript
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const match = block.match(/^\[(Doctor|Patient)\]:\s*(.*)$/s)
      const role = match?.[1]?.toLowerCase() || 'speaker'
      const text = match?.[2]?.trim() || block

      return {
        role,
        text,
        timestamp: new Date(Date.UTC(2026, 2, 12, 9, 0, index)).toISOString(),
        is_final: true,
      }
    })
}

async function parseJson(response) {
  const body = await response.text()
  return body ? JSON.parse(body) : {}
}

async function expectOk(response, label) {
  const body = await response.text()
  expect(
    response.ok(),
    `${label} failed with ${response.status}: ${body || '<empty body>'}`,
  ).toBeTruthy()
  return body ? JSON.parse(body) : {}
}

async function createProcessedEncounter(request) {
  const createResponse = await request.post(`${API_BASE_URL}/encounters`, withAuth({
    data: { source: 'retrieval-regression', language: 'en-US' },
  }))
  const created = await expectOk(createResponse, 'Create encounter')

  const draftResponse = await request.put(`${API_BASE_URL}/encounters/${created.encounter_id}/draft`, withAuth({
    data: {
      draft_text: SAMPLE_TRANSCRIPT.trim(),
      expected_draft_version: created.draft_version,
      segments: buildSegments(SAMPLE_TRANSCRIPT),
    },
  }))
  const draftPayload = await expectOk(draftResponse, 'Save encounter draft')

  const finalizeResponse = await request.post(`${API_BASE_URL}/encounters/${created.encounter_id}/finalize`, withAuth({
    data: { expected_draft_version: draftPayload.draft_version },
  }))
  const finalizePayload = await expectOk(finalizeResponse, 'Finalize encounter draft')

  const processed = finalizePayload.job_id
    ? finalizePayload
    : await expectOk(
        await request.post(`${API_BASE_URL}/encounters/${created.encounter_id}/process`, withAuth({
          data: {},
        })),
        'Process encounter',
      )

  let statusPayload = null
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const statusResponse = await request.get(`${API_BASE_URL}/status/${processed.job_id}`, withAuth())
    statusPayload = await expectOk(statusResponse, 'Fetch processing status')

    if (statusPayload.status === 'completed') {
      break
    }

    if (statusPayload.status === 'failed') {
      throw new Error(`Encounter processing failed before results were fetched: ${statusPayload.error_message || 'Unknown failure'}`)
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  if (!statusPayload || statusPayload.status !== 'completed') {
    throw new Error(`Encounter processing did not finish in time for job ${processed.job_id}`)
  }

  const resultsResponse = await request.get(`${API_BASE_URL}/results/${processed.job_id}`, withAuth())
  const results = await expectOk(resultsResponse, 'Fetch processed results')

  return {
    encounterId: created.encounter_id,
    jobId: processed.job_id,
    processPayload: processed,
    results,
  }
}

async function getProcessedEncounter(request) {
  if (!processedEncounterPromise) {
    processedEncounterPromise = createProcessedEncounter(request)
  }

  return processedEncounterPromise
}

async function getContext(request, encounterId, params = {}) {
  const url = new URL(`${API_BASE_URL}/encounters/${encounterId}/context`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }
  const response = await request.get(url.toString(), withAuth())
  return expectOk(response, 'Fetch encounter context')
}

async function queryAssistant(request, encounterId, question) {
  const response = await request.post(`${API_BASE_URL}/encounters/${encounterId}/assistant/query`, withAuth({
    data: {
      question,
      scope: 'local',
      agentId: 'chat-agent',
    },
  }))
  const body = await response.text()
  expect(response.ok(), `Assistant query failed with ${response.status}: ${body || '<empty body>'}`).toBeTruthy()
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function extractCompletedAnswer(envelopes) {
  const completed = envelopes.find((envelope) => envelope.event === 'turn.completed')
  const parts = completed?.data?.parts || []
  return parts.map((part) => part.text || '').join(' ')
}

function extractCitationTitles(envelopes) {
  return envelopes
    .filter((envelope) => envelope.event === 'turn.citation')
    .map((envelope) => envelope.data?.title)
    .filter(Boolean)
}

function expectAnswerToContainOneOf(answer, expectedGroups) {
  for (const group of expectedGroups) {
    expect(group.some((candidate) => answer.includes(candidate))).toBeTruthy()
  }
}

test.describe('production retrieval hardening', () => {
  test.describe.configure({ timeout: 300000 })

  test.skip(
    MISSING_RUNTIME_KEYS.length > 0,
    `Local Azure prerequisite missing for retrieval hardening: ${MISSING_RUNTIME_KEYS.join(', ')}`,
  )

  test('processing auto-generates summary and exposes Search-backed context kinds', async ({ request }) => {
    const { encounterId, results, processPayload } = await getProcessedEncounter(request)

    expect(processPayload.job_id).toBeTruthy()
    expect(processPayload.status).toBeTruthy()
    expect(results.clinical_summary?.summary_text || '').toContain('### Clinical Summary')
    expect(results.clinical_summary?.summary_text || '').toContain('### Structured Findings')

    const fullContext = await getContext(request, encounterId, { limit: 50 })
    expect(fullContext.summary.total_items).toBeGreaterThan(0)
    const kinds = new Set(fullContext.items.map((item) => item.kind))
    expect(kinds.has('clinical_summary')).toBeTruthy()
    expect(kinds.has('clinical_entity')).toBeTruthy()
    expect(kinds.has('clinical_relation')).toBeTruthy()
    expect(['segment', 'speaker_phrase', 'finalized_transcript'].some((kind) => kinds.has(kind))).toBeTruthy()
  })

  test('gold questions return grounded facts and citations', async ({ request }) => {
    const { encounterId } = await getProcessedEncounter(request)
    const questions = [
      {
        question: 'What symptoms did the patient report?',
        expected: [['headaches'], ['blurry vision', 'visual symptoms'], ['sensitivity to light', 'bright lights seem to bother me', 'bright lights bother me']],
      },
      {
        question: 'What medication changes were recommended?',
        expected: [['acetaminophen'], ['lisinopril to 20 milligrams daily']],
      },
      {
        question: 'What blood pressure readings were documented?',
        expected: [['145 over 95', '145/95'], ['148 over 92', '148/92']],
      },
      {
        question: 'What tests or follow-up steps were ordered?',
        expected: [['complete metabolic panel'], ['eye exam'], ['two weeks']],
      },
    ]

    for (const scenario of questions) {
      const envelopes = await queryAssistant(request, encounterId, scenario.question)
      const answer = extractCompletedAnswer(envelopes).toLowerCase()
      const events = envelopes.map((envelope) => envelope.event)
      const citations = extractCitationTitles(envelopes)

      expect(events).toContain('turn.started')
      expect(events).toContain('turn.tool_started')
      expect(events).toContain('turn.tool_completed')
      expect(events).toContain('turn.citation')
      expect(events).toContain('turn.completed')
      expect(citations.length).toBeGreaterThan(0)

      expectAnswerToContainOneOf(answer, scenario.expected)
    }
  })

  test('paraphrase questions stay grounded across symptoms, meds, measurements, tests, and follow-up', async ({ request }) => {
    const { encounterId } = await getProcessedEncounter(request)
    const paraphrases = [
      {
        question: 'How long has she had the headaches and where are they located?',
        expected: [['two weeks'], ['front of the head', 'front of my head'], ['behind the eyes', 'behind my eyes']],
      },
      {
        question: 'Which pain reliever should replace ibuprofen and how often can she use it?',
        expected: [['acetaminophen 500 milligrams'], ['no more than twice a week']],
      },
      {
        question: 'Which home and office blood pressure values were mentioned?',
        expected: [['145 over 95', '145/95'], ['148 over 92', '148/92']],
      },
      {
        question: 'What red flags should prompt urgent care before the next appointment?',
        expected: [['weakness'], ['numbness'], ['severe visual changes']],
      },
    ]

    for (const scenario of paraphrases) {
      const envelopes = await queryAssistant(request, encounterId, scenario.question)
      const answer = extractCompletedAnswer(envelopes).toLowerCase()
      expect(extractCitationTitles(envelopes).length).toBeGreaterThan(0)

      expectAnswerToContainOneOf(answer, scenario.expected)
    }
  })

  test('react assistant renders structured citations for streamed turns', async ({ page }) => {
    const encounterId = '11111111-1111-4111-8111-111111111111'

    const reviewResult = {
      encounter_id: encounterId,
      status: 'ready_for_review',
      review_version: 1,
      created_at: '2026-03-15T09:00:00Z',
      updated_at: '2026-03-15T09:01:00Z',
      job_id: 'job-ui-citations',
      job_status: 'completed',
      processing_stage: 'completed',
      transcript: {
        text: SAMPLE_TRANSCRIPT.trim(),
        segments: buildSegments(SAMPLE_TRANSCRIPT),
        diarized_phrases: [],
        speaker_count: 2,
      },
      medical_analysis: {
        entities: [
          { text: 'acetaminophen 500 milligrams', category: 'medication' },
          { text: 'lisinopril 20 milligrams daily', category: 'medication' },
        ],
        relationships: [],
        assertions: [],
        timeline: [],
      },
      clinician_outputs: {
        clinical_summary: 'Medication changes are ready for clinician review.',
        structured_findings: [],
        follow_up_instructions: [],
        medication_changes: [
          {
            id: 'med-change-1',
            medication: 'Lisinopril',
            change_type: 'adjust',
            detail: 'Increase lisinopril to 20 milligrams daily.',
            dosage: '20 milligrams daily',
            evidence: ['Increase lisinopril to 20 milligrams daily.'],
          },
          {
            id: 'med-change-2',
            medication: 'Acetaminophen',
            change_type: 'start',
            detail: 'Switch from ibuprofen to acetaminophen 500 mg limited to twice a week.',
            dosage: '500 mg',
            evidence: ['Switch from ibuprofen to acetaminophen 500 mg limited to twice a week.'],
          },
        ],
        tests: [],
        referrals: [],
        final_note_sections: {
          hpi: { key: 'hpi', title: 'HPI', content: 'Headaches reviewed.' },
          ros: { key: 'ros', title: 'ROS', content: 'Blurry vision and headache symptoms reviewed.' },
          pe: { key: 'pe', title: 'PE', content: 'PE details were not explicitly documented.' },
          assessment: { key: 'assessment', title: 'Assessment', content: 'Headaches with elevated blood pressure.' },
          plan: { key: 'plan', title: 'Plan', content: 'Increase lisinopril and use acetaminophen instead of ibuprofen.' },
        },
      },
      clinical_summary: {
        job_id: 'job-ui-citations',
        summary_text: '### Clinical Summary\nMedication changes are ready for clinician review.\n\n### Medication Changes\n- Increase lisinopril to 20 milligrams daily.\n- Switch from ibuprofen to acetaminophen 500 mg limited to twice a week.',
      },
      structured_findings: [],
      follow_up_instructions: [],
      medication_changes: [
        {
          id: 'med-change-1',
          medication: 'Lisinopril',
          change_type: 'adjust',
          detail: 'Increase lisinopril to 20 milligrams daily.',
          dosage: '20 milligrams daily',
          evidence: ['Increase lisinopril to 20 milligrams daily.'],
        },
      ],
      tests_and_referrals: { tests: [], referrals: [] },
      final_note_sections: {
        hpi: { key: 'hpi', title: 'HPI', content: 'Headaches reviewed.' },
        ros: { key: 'ros', title: 'ROS', content: 'Blurry vision and headache symptoms reviewed.' },
        pe: { key: 'pe', title: 'PE', content: 'PE details were not explicitly documented.' },
        assessment: { key: 'assessment', title: 'Assessment', content: 'Headaches with elevated blood pressure.' },
        plan: { key: 'plan', title: 'Plan', content: 'Increase lisinopril and use acetaminophen instead of ibuprofen.' },
      },
      final_note_text: 'Increase lisinopril and use acetaminophen instead of ibuprofen.',
      links: {
        approve: `/api/encounters/${encounterId}/review/approve`,
        save_edits: `/api/encounters/${encounterId}/review`,
        regenerate: `/api/encounters/${encounterId}/review/regenerate`,
      },
    }

    const encounterPayload = {
      encounter_id: encounterId,
      status: 'ready_for_review',
      draft_version: 1,
      draft_text: SAMPLE_TRANSCRIPT.trim(),
      draft_segments: buildSegments(SAMPLE_TRANSCRIPT),
      diarized_phrases: [],
      speaker_count: 2,
      draft_source: 'audio_transcription',
      finalized_text: SAMPLE_TRANSCRIPT.trim(),
      process_job_id: 'job-ui-citations',
      updated_at: '2026-03-15T09:01:00Z',
      created_at: '2026-03-15T09:00:00Z',
      metadata: {},
      review_result: reviewResult,
      links: {
        self: `/api/encounters/${encounterId}`,
        results: `/api/encounters/${encounterId}/results`,
      },
    }

    await stubAuthenticatedBrowserSession(page)

    await page.route(`**/api/encounters/${encounterId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(encounterPayload),
      })
    })

    await page.route(`**/api/encounters/${encounterId}/context**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          encounter_id: encounterId,
          status: 'ready_for_review',
          generated_at: '2026-03-15T09:01:00Z',
          linked_job_id: 'job-ui-citations',
          contract_version: 'v1',
          context_version: 'v1',
          items: [
            {
              id: 'ctx-1',
              category: 'medication',
              kind: 'clinical_summary',
              title: 'Medication changes',
              text: 'Increase lisinopril to 20 milligrams daily and switch from ibuprofen to acetaminophen 500 mg limited to twice a week.',
              source: 'job',
              provenance: [{ source_type: 'summary_section', source_id: 'medication_changes' }],
              metadata: {},
            },
          ],
          summary: {
            total_items: 1,
            returned_items: 1,
            categories: ['medication'],
            assertions: [],
            applied_filters: { limit: 80 },
          },
        }),
      })
    })

    await page.route(`**/api/encounters/${encounterId}/operational-context`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          encounter_id: encounterId,
          status: 'ready_for_review',
          generated_at: '2026-03-15T09:01:00Z',
          linked_job_id: 'job-ui-citations',
          contract_version: 'v1',
          eligibility: { provider: 'mock', status: 'eligible', member_reference: 'member-1', summary: 'Eligible', freshness: { fetched_at: '2026-03-15T09:01:00Z', expires_at: '2026-03-15T10:01:00Z', is_mock: true } },
          scheme_qualification: { provider: 'mock', plan_name: 'Standard', qualification_status: 'qualified', summary: 'Qualified', freshness: { fetched_at: '2026-03-15T09:01:00Z', expires_at: '2026-03-15T10:01:00Z', is_mock: true } },
          treatment_lookup: { provider: 'mock', results: [], freshness: { fetched_at: '2026-03-15T09:01:00Z', expires_at: '2026-03-15T10:01:00Z', is_mock: true } },
          prior_auth_summaries: { provider: 'mock', results: [], freshness: { fetched_at: '2026-03-15T09:01:00Z', expires_at: '2026-03-15T10:01:00Z', is_mock: true } },
          communication_options: { provider: 'mock', results: [], freshness: { fetched_at: '2026-03-15T09:01:00Z', expires_at: '2026-03-15T10:01:00Z', is_mock: true } },
          audit_metadata: {},
        }),
      })
    })

    await page.route(`**/api/encounters/${encounterId}/actions/preview`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          encounter_id: encounterId,
          generated_at: '2026-03-15T09:01:00Z',
          preview_only: true,
          previews: [],
        }),
      })
    })

    await page.route(`**/api/encounters/${encounterId}/assistant/query`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: [
          JSON.stringify({ event: 'turn.started', requestId: 'req-1', threadId: 'thread-1', turnId: 'turn-1', data: { role: 'assistant', status: 'streaming' } }),
          JSON.stringify({ event: 'turn.citation', requestId: 'req-1', threadId: 'thread-1', turnId: 'turn-1', data: { title: 'Medication changes', text: 'Increase lisinopril to 20 milligrams daily and switch from ibuprofen to acetaminophen 500 mg limited to twice a week.', source: 'job', kind: 'clinical_summary', category: 'medication', provenance: [{ source_type: 'summary_section', source_id: 'medication_changes' }] } }),
          JSON.stringify({ event: 'turn.completed', requestId: 'req-1', threadId: 'thread-1', turnId: 'turn-1', data: { parts: [{ type: 'text', text: 'Increase lisinopril to 20 milligrams daily and switch from ibuprofen to acetaminophen 500 mg limited to twice a week.' }], summary: 'Medication changes summarized.', toolEvents: [] } }),
        ].join('\n'),
      })
    })

    await page.addInitScript((apiBaseUrl) => {
      window.APP_CONFIG = {
        apiBaseUrl,
        platform: {
          appTitle: 'HealthTranscribe Platform',
          assistantTitle: 'Clinical Assistant',
        },
      }
    }, API_BASE_URL)

    await page.goto(`/encounters/${encounterId}/review`)
    await expect(page.getByRole('heading', { name: 'Clinician-ready note and action items' })).toBeVisible({ timeout: 30000 })

    await page.getByRole('button', { name: 'Open helper' }).click()
    await expect(page.getByRole('heading', { name: 'Ask about this visit' })).toBeVisible({ timeout: 30000 })

    const assistantQuestion = page.locator('.assistant-query-row textarea').first()
    await expect(assistantQuestion).toBeVisible({ timeout: 30000 })
    await assistantQuestion.fill('What medication changes were recommended?')
    const askAssistantButton = page.getByRole('button', { name: 'Ask assistant' })
    await expect(askAssistantButton).toBeEnabled({ timeout: 30000 })
    await askAssistantButton.scrollIntoViewIfNeeded()
    await askAssistantButton.click()

    const citationsPanel = page.locator('.detail-list').filter({ hasText: 'Citations' }).first()

    await expect(citationsPanel).toBeVisible({ timeout: 30000 })
    await expect(citationsPanel.getByText('Citations')).toBeVisible({ timeout: 30000 })
    await expect(citationsPanel.getByText(/acetaminophen|lisinopril/i).first()).toBeVisible({ timeout: 30000 })

    expect(await citationsPanel.getByText(/^Provenance:/).count()).toBeGreaterThan(0)
    expect(await citationsPanel.getByText(/^Source:/).count()).toBeGreaterThan(0)
  })
})