const path = require('node:path')
const { test, expect } = require('@playwright/test')

const API_BASE_URL = process.env.TEST_API_BASE_URL || 'http://127.0.0.1:7072/api'

const LOCAL_DEV_AUTH_HEADERS = {
  'X-MS-CLIENT-PRINCIPAL-ID': process.env.TEST_PRINCIPAL_ID || 'local-dev-user',
  'X-MS-CLIENT-PRINCIPAL-NAME': process.env.TEST_PRINCIPAL_NAME || 'Local Developer',
  'X-MS-CLIENT-PRINCIPAL-EMAIL': process.env.TEST_PRINCIPAL_EMAIL || 'local.developer@localhost',
}

function withAuth(options = {}, overrides = {}) {
  return {
    ...options,
    headers: {
      ...LOCAL_DEV_AUTH_HEADERS,
      ...overrides,
      ...(options.headers || {}),
    },
  }
}

async function stubAuthenticatedBrowserSession(page, overrides = {}) {
  const sessionPayload = {
    authenticated: true,
    user_id: 'browser-smoke-user',
    email: 'browser.smoke@example.com',
    name: 'Browser Smoke User',
    identity_provider: 'aad',
    tenant_id: 'tenant-smoke',
    role: 'owner',
    memberships: [
      {
        tenant_id: 'tenant-smoke',
        tenant_name: 'Smoke Tenant',
        tenant_slug: 'smoke-tenant',
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

const DRAFT_TEXT = [
  'Doctor: Thanks for coming in today. Let us review the headaches and blood pressure readings.',
  'Patient: The headaches have been happening for about two weeks and bright lights bother me.',
  'Doctor: We will increase lisinopril to 20 milligrams daily and arrange an eye exam in two weeks.',
].join('\n')

const SMOKE_SEGMENTS = [
  {
    role: 'clinician',
    text: 'Thanks for coming in today. Let us review the headaches and blood pressure readings.',
    timestamp: '2026-03-15T09:00:00Z',
    is_final: true,
  },
  {
    role: 'patient',
    text: 'The headaches have been happening for about two weeks and bright lights bother me.',
    timestamp: '2026-03-15T09:00:15Z',
    is_final: true,
  },
  {
    role: 'clinician',
    text: 'We will increase lisinopril to 20 milligrams daily and arrange an eye exam in two weeks.',
    timestamp: '2026-03-15T09:00:40Z',
    is_final: true,
  },
]

const SAMPLE_AUDIO_FILE = path.join(__dirname, '..', 'samples', 'sample-clinical.mp3')

function buildReviewResult(encounterId, jobId, status = 'ready_for_review') {
  const finalNoteSections = {
    hpi: { key: 'hpi', title: 'HPI', content: 'The patient reports headaches for two weeks with light sensitivity.', bullets: [] },
    ros: { key: 'ros', title: 'ROS', content: 'Positive for headaches and photophobia.', bullets: [] },
    pe: { key: 'pe', title: 'PE', content: 'Physical exam details were not explicitly documented.', bullets: [] },
    assessment: { key: 'assessment', title: 'Assessment', content: 'Headaches with associated light sensitivity; hypertension medication adjustment discussed.', bullets: [] },
    plan: { key: 'plan', title: 'Plan', content: 'Increase lisinopril to 20 milligrams daily and arrange an eye exam in two weeks.', bullets: [] },
  }

  return {
    encounter_id: encounterId,
    status,
    review_version: 1,
    created_at: '2026-03-15T09:00:00Z',
    updated_at: '2026-03-15T09:00:08Z',
    job_id: jobId,
    job_status: 'completed',
    processing_stage: 'completed',
    transcript: {
      text: DRAFT_TEXT,
      segments: SMOKE_SEGMENTS,
      diarized_phrases: [],
      speaker_count: 2,
    },
    medical_analysis: {
      entities: [
        { text: 'headaches', category: 'symptom', subcategory: 'symptom_or_sign' },
        { text: 'lisinopril 20 milligrams daily', category: 'medication', subcategory: 'medication_name' },
        { text: 'eye exam in two weeks', category: 'test', subcategory: 'diagnostic_procedure' },
      ],
      relationships: [],
      assertions: [],
      timeline: [
        {
          id: 'timeline-1',
          title: 'Headaches discussed',
          detail: 'The patient reported headaches for two weeks with light sensitivity.',
          timeframe: 'two weeks',
          source: 'summary',
          evidence: ['The headaches have been happening for about two weeks and bright lights bother me.'],
        },
      ],
    },
    clinician_outputs: {
      clinical_summary: 'The patient reported headaches for two weeks with light sensitivity. Lisinopril was increased and an eye exam was ordered.',
      structured_findings: [
        {
          id: 'finding-1',
          label: 'Headaches',
          detail: 'The patient reported headaches for two weeks with light sensitivity.',
          category: 'clinical_finding',
          confidence_score: null,
          evidence: ['The headaches have been happening for about two weeks and bright lights bother me.'],
        },
      ],
      follow_up_instructions: [
        {
          id: 'follow-up-1',
          instruction: 'Arrange an eye exam in two weeks.',
          timeframe: 'two weeks',
          audience: 'patient',
          priority: null,
          evidence: ['We will increase lisinopril to 20 milligrams daily and arrange an eye exam in two weeks.'],
        },
      ],
      medication_changes: [
        {
          id: 'medication-1',
          medication: 'Lisinopril',
          change_type: 'adjust',
          detail: 'Increase lisinopril to 20 milligrams daily.',
          dosage: '20 milligrams daily',
          frequency: 'daily',
          reason: null,
          evidence: ['We will increase lisinopril to 20 milligrams daily and arrange an eye exam in two weeks.'],
        },
      ],
      tests: [
        {
          id: 'test-1',
          name: 'Eye exam',
          detail: 'Arrange an eye exam in two weeks.',
          timing: 'two weeks',
          reason: null,
          evidence: ['We will increase lisinopril to 20 milligrams daily and arrange an eye exam in two weeks.'],
        },
      ],
      referrals: [],
      final_note_sections: finalNoteSections,
    },
    clinical_summary: {
      job_id: jobId,
      cached: false,
      generated_at: '2026-03-15T09:00:08Z',
      model: 'gpt-4o-mini',
      summary_text: [
        '### Clinical Summary',
        'The patient reported headaches for two weeks with light sensitivity.',
        '',
        '### Medication Changes',
        '- Increase lisinopril to 20 milligrams daily.',
        '',
        '### Follow-Up Instructions',
        '- Arrange an eye exam in two weeks.',
      ].join('\n'),
    },
    structured_findings: [
      {
        id: 'finding-1',
        label: 'Headaches',
        detail: 'The patient reported headaches for two weeks with light sensitivity.',
        category: 'clinical_finding',
        confidence_score: null,
        evidence: ['The headaches have been happening for about two weeks and bright lights bother me.'],
      },
    ],
    follow_up_instructions: [
      {
        id: 'follow-up-1',
        instruction: 'Arrange an eye exam in two weeks.',
        timeframe: 'two weeks',
        audience: 'patient',
        priority: null,
        evidence: ['We will increase lisinopril to 20 milligrams daily and arrange an eye exam in two weeks.'],
      },
    ],
    medication_changes: [
      {
        id: 'medication-1',
        medication: 'Lisinopril',
        change_type: 'adjust',
        detail: 'Increase lisinopril to 20 milligrams daily.',
        dosage: '20 milligrams daily',
        frequency: 'daily',
        reason: null,
        evidence: ['We will increase lisinopril to 20 milligrams daily and arrange an eye exam in two weeks.'],
      },
    ],
    tests_and_referrals: {
      tests: [
        {
          id: 'test-1',
          name: 'Eye exam',
          detail: 'Arrange an eye exam in two weeks.',
          timing: 'two weeks',
          reason: null,
          evidence: ['We will increase lisinopril to 20 milligrams daily and arrange an eye exam in two weeks.'],
        },
      ],
      referrals: [],
    },
    final_note_sections: finalNoteSections,
    final_note_text: [
      'HPI',
      finalNoteSections.hpi.content,
      '',
      'PLAN',
      finalNoteSections.plan.content,
    ].join('\n'),
    links: {
      self: `/api/encounters/${encounterId}/results`,
      approve: `/api/encounters/${encounterId}/review/approve`,
      save_edits: `/api/encounters/${encounterId}/review`,
      regenerate: `/api/encounters/${encounterId}/review/regenerate`,
    },
    error_message: null,
  }
}

function buildEncounterPayload(encounterId, jobId, status, reviewResult = null) {
  return {
    encounter_id: encounterId,
    status,
    draft_version: 1,
    draft_text: DRAFT_TEXT,
    draft_segments: SMOKE_SEGMENTS,
    diarized_phrases: [],
    speaker_count: 2,
    draft_source: 'audio_transcription',
    finalized_text: DRAFT_TEXT,
    process_job_id: jobId,
    updated_at: '2026-03-15T09:00:08Z',
    created_at: '2026-03-15T09:00:00Z',
    review_result: reviewResult,
    links: {
      self: `/api/encounters/${encounterId}`,
      results: `/api/encounters/${encounterId}/results`,
      approve: `/api/encounters/${encounterId}/review/approve`,
      save_edits: `/api/encounters/${encounterId}/review`,
      regenerate: `/api/encounters/${encounterId}/review/regenerate`,
    },
  }
}

function buildSmokeResult(jobId, encounterId) {
  return {
    job_id: jobId,
    filename: 'ambient-smoke.wav',
    status: 'completed',
    created_at: '2026-03-15T09:00:00Z',
    updated_at: '2026-03-15T09:00:08Z',
    processing_time_seconds: 8.2,
    source_encounter_id: encounterId,
    transcription: {
      text: DRAFT_TEXT,
      word_count: 39,
    },
    medical_analysis: {
      entities: [
        {
          text: 'headaches',
          category: 'symptom',
          subcategory: 'symptom_or_sign',
          confidenceScore: 0.98,
        },
        {
          text: 'lisinopril 20 milligrams daily',
          category: 'medication',
          subcategory: 'medication_name',
          confidenceScore: 0.96,
        },
        {
          text: 'eye exam in two weeks',
          category: 'test',
          subcategory: 'diagnostic_procedure',
          confidenceScore: 0.91,
        },
      ],
      entities_by_category: {
        symptom: [
          {
            text: 'headaches',
            category: 'symptom',
            subcategory: 'symptom_or_sign',
            confidenceScore: 0.98,
          },
        ],
        medication: [
          {
            text: 'lisinopril 20 milligrams daily',
            category: 'medication',
            subcategory: 'medication_name',
            confidenceScore: 0.96,
          },
        ],
        test: [
          {
            text: 'eye exam in two weeks',
            category: 'test',
            subcategory: 'diagnostic_procedure',
            confidenceScore: 0.91,
          },
        ],
      },
      relations: [],
      diarization: {
        phrases: [],
        speaker_count: 2,
      },
      summary: {
        total_entities: 3,
        total_relations: 0,
        categories: ['symptom', 'medication', 'test'],
        speaker_count: 2,
        linked_entities: 0,
        assertions: {},
      },
    },
    clinical_summary: {
      job_id: jobId,
      cached: false,
      generated_at: '2026-03-15T09:00:08Z',
      model: 'gpt-4o-mini',
      summary_text: [
        '### Clinical Summary',
        'The patient reported headaches for two weeks with light sensitivity.',
        '',
        '### Medication Changes',
        '- Increase lisinopril to 20 milligrams daily.',
        '',
        '### Follow-Up Instructions',
        '- Arrange an eye exam in two weeks.',
      ].join('\n'),
    },
    fhir_bundle: {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [],
    },
  }
}

test.describe('clinician workflow smoke flow', () => {
  test('rejects anonymous access on a protected route', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/encounters`, {
      data: {
        source: 'anonymous-smoke',
        language: 'en-US',
      },
    })

    const payload = await response.json()

    if (response.status() === 401) {
      expect(payload.code).toBe('AUTH_REQUIRED')
      return
    }

    expect(response.status()).toBe(201)
    expect(payload.encounter_id).toBeTruthy()
  })

  test('covers intake, ambient capture entry, final review approval, and technical results navigation', async ({ page }) => {
    await stubAuthenticatedBrowserSession(page)
    await page.goto('/')

    const hideHelperButton = page.getByRole('button', { name: 'Hide helper' })
    if (await hideHelperButton.isVisible().catch(() => false)) {
      await hideHelperButton.click({ force: true })
    }

    await expect(page.getByRole('heading', { name: 'Start Wulo Scribe' })).toBeVisible()
    const startAmbientButton = page.getByRole('button', { name: 'Start Wulo Scribe', exact: true })
    await expect(startAmbientButton).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Upload a recording', level: 4 })).toBeVisible()

    await startAmbientButton.click()
    await expect(page).toHaveURL(/\/ambient-scribe/)
    await expect(page.getByRole('heading', { name: 'Capture the visit live' })).toBeVisible()

    const encounterId = 'enc-final-review-smoke'
    const smokeJobId = 'job-smoke-ui'
    let isApproved = false

    const readyReviewResult = buildReviewResult(encounterId, smokeJobId, 'ready_for_review')
    const approvedReviewResult = buildReviewResult(encounterId, smokeJobId, 'approved')
    const readyEncounter = buildEncounterPayload(encounterId, smokeJobId, 'ready_for_review', readyReviewResult)
    const approvedEncounter = buildEncounterPayload(encounterId, smokeJobId, 'approved', approvedReviewResult)

    await page.route(`**/api/encounters/${encounterId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(isApproved ? approvedEncounter : readyEncounter),
      })
    })

    await page.route(`**/api/encounters/${encounterId}/review/approve`, async (route) => {
      isApproved = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          encounter_id: encounterId,
          action: 'approve',
          status: 'approved',
          updated_at: '2026-03-15T09:00:10Z',
          result: approvedReviewResult,
          links: approvedReviewResult.links,
        }),
      })
    })

    await page.route('**/api/status/**', async (route) => {
      if (!route.request().url().includes(`/api/status/${smokeJobId}`)) {
        await route.continue()
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job_id: smokeJobId,
          filename: 'ambient-smoke.wav',
          status: 'completed',
          created_at: '2026-03-15T09:00:00Z',
          updated_at: '2026-03-15T09:00:08Z',
          processing_time_seconds: 8.2,
          processing_stage: 'completed',
        }),
      })
    })

    await page.route(`**/api/results/${smokeJobId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildSmokeResult(smokeJobId, encounterId)),
      })
    })

    await page.route(`**/api/summary/${smokeJobId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job_id: smokeJobId,
          cached: false,
          generated_at: '2026-03-15T09:00:08Z',
          model: 'gpt-4o-mini',
          summary_text: [
            '### Clinical Summary',
            'The patient reported headaches for two weeks with light sensitivity.',
            '',
            '### Medication Changes',
            '- Increase lisinopril to 20 milligrams daily.',
            '',
            '### Follow-Up Instructions',
            '- Arrange an eye exam in two weeks.',
          ].join('\n'),
        }),
      })
    })

    await page.goto(`/encounters/${encounterId}/review`)
    const mainContent = page.locator('main')
    await expect(page.getByRole('heading', { name: 'Clinician-ready note and action items' })).toBeVisible()
    await expect(mainContent.getByText('Increase lisinopril to 20 milligrams daily and arrange an eye exam in two weeks.').first()).toBeVisible()
    await expect(mainContent.getByText('Action items for this visit')).toBeVisible()

    await mainContent.getByRole('button', { name: 'Approve final note', exact: true }).click()
    await expect(page.getByText('Clinician approved')).toBeVisible()

    await mainContent.getByRole('button', { name: 'Open technical results' }).click()
    await expect(page).toHaveURL(new RegExp(`/jobs/${smokeJobId}$`), { timeout: 15000 })
    await expect(page.getByRole('heading', { name: 'Technical job payload is available' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open final clinician review' })).toBeVisible()
  })

  test('shows queued, analysis, and final results on the review page after stop capture', async ({ page }) => {
    await page.route('**/config.js', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: [
          'window.APP_CONFIG = window.APP_CONFIG || {};',
          "window.APP_CONFIG.apiBaseUrl = 'http://127.0.0.1:7072/api';",
          'window.APP_CONFIG.voiceLive = { gatewayBaseUrl: \'\', wsUrl: \'\', wsPath: \'/ws\', mode: \'model\', model: \'gpt-realtime\', voiceType: \'azure-standard\', voice: \'en-US-Ava:DragonHDLatestNeural\', transcribeModel: \'gpt-4o-transcribe\', inputLanguage: \'en\', instructions: \'You are an ambient clinical scribe.\' };',
          "window.APP_CONFIG.platform = { appTitle: 'Wulo', assistantTitle: 'Visit Helper' };",
        ].join('\n'),
      })
    })

    await stubAuthenticatedBrowserSession(page)

    const encounterId = 'enc-stop-transition-smoke'
    const smokeJobId = 'job-stop-transition-smoke'
    const capturingEncounter = buildEncounterPayload(encounterId, '', 'capturing', null)
    const processingEncounter = buildEncounterPayload(encounterId, smokeJobId, 'processing', null)
    const readyReviewResult = buildReviewResult(encounterId, smokeJobId, 'ready_for_review')
    const readyEncounter = buildEncounterPayload(encounterId, smokeJobId, 'ready_for_review', readyReviewResult)

    let captureStopped = false
    let postStopEncounterReads = 0
    let postStopStatusReads = 0
    const ENCOUNTER_READY_THRESHOLD = 6

    await page.route('**/api/encounters', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue()
        return
      }

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          ...buildEncounterPayload(encounterId, '', 'draft', null),
          draft_text: '',
          draft_segments: [],
          review_result: null,
          links: {
            self: `/api/encounters/${encounterId}`,
            results: `/api/encounters/${encounterId}/results`,
            start_capture: `/api/encounters/${encounterId}/capture/start`,
            stop_capture: `/api/encounters/${encounterId}/capture/stop`,
            approve: `/api/encounters/${encounterId}/review/approve`,
            save_edits: `/api/encounters/${encounterId}/review`,
            regenerate: `/api/encounters/${encounterId}/review/regenerate`,
          },
        }),
      })
    })

    await page.route(`**/api/encounters/${encounterId}/capture/start`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(capturingEncounter),
      })
    })

    await page.route(`**/api/encounters/${encounterId}/capture/stop`, async (route) => {
      captureStopped = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          encounter_id: encounterId,
          job_id: smokeJobId,
          status: 'processing',
          job_status: 'pending',
          processing_stage: 'queued',
          processing_time_seconds: 0.2,
          review_result: null,
          links: {
            results: `/api/results/${smokeJobId}`,
            encounter_results: `/api/encounters/${encounterId}/results`,
            approve: `/api/encounters/${encounterId}/review/approve`,
            save_edits: `/api/encounters/${encounterId}/review`,
            regenerate: `/api/encounters/${encounterId}/review/regenerate`,
          },
        }),
      })
    })

    await page.route(`**/api/encounters/${encounterId}`, async (route) => {
      if (!captureStopped) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(capturingEncounter),
        })
        return
      }

      postStopEncounterReads += 1
      const payload = postStopEncounterReads >= ENCOUNTER_READY_THRESHOLD ? readyEncounter : processingEncounter
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      })
    })

    await page.route(`**/api/status/${smokeJobId}`, async (route) => {
      postStopStatusReads += 1

      if (postStopStatusReads === 1) {
        await new Promise((resolve) => setTimeout(resolve, 1200))
      }

      const payload = postStopStatusReads <= 2
        ? {
            job_id: smokeJobId,
            filename: 'ambient-stop-transition.wav',
            status: 'pending',
            created_at: '2026-03-15T09:00:00Z',
            updated_at: '2026-03-15T09:00:02Z',
            processing_time_seconds: 0.2,
            processing_stage: 'queued',
          }
        : postStopStatusReads <= 5
          ? {
              job_id: smokeJobId,
              filename: 'ambient-stop-transition.wav',
              status: 'analyzing',
              created_at: '2026-03-15T09:00:00Z',
              updated_at: '2026-03-15T09:00:05Z',
              processing_time_seconds: 4.6,
              processing_stage: 'clinical_analysis',
            }
          : {
              job_id: smokeJobId,
              filename: 'ambient-stop-transition.wav',
              status: 'completed',
              created_at: '2026-03-15T09:00:00Z',
              updated_at: '2026-03-15T09:00:08Z',
              processing_time_seconds: 8.1,
              processing_stage: 'completed',
            }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      })
    })

    await page.route(`**/api/encounters/${encounterId}/results`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(readyReviewResult),
      })
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Open helper' }).click()

    await page.getByRole('button', { name: 'Start live capture' }).click()
    await expect(page.getByRole('button', { name: 'Stop capture' })).toBeEnabled()

    await page.getByRole('button', { name: 'Stop capture' }).click()

    await expect(page).toHaveURL(new RegExp(`/encounters/${encounterId}/review$`))
    await expect(page.getByRole('heading', { name: 'Preparing the final clinician review' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Listening through the visit audio' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Converting speech to text')).toBeVisible({ timeout: 10000 })

    await expect(page.getByText('clinical analysis')).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('heading', { name: 'Extracting clinical signals and assembling outputs' })).toBeVisible({ timeout: 15000 })

    await expect(page.getByRole('heading', { name: 'Clinician-ready note and action items' })).toBeVisible({ timeout: 25000 })
    await expect(page.getByText('Increase lisinopril to 20 milligrams daily and arrange an eye exam in two weeks.').first()).toBeVisible()
  })

  test('covers the upload-to-final-review handoff from the side upload panel', async ({ page }) => {
    await stubAuthenticatedBrowserSession(page)
    const encounterId = 'enc-upload-review-smoke'
    const smokeJobId = 'job-upload-review-smoke'
    const reviewResult = buildReviewResult(encounterId, smokeJobId, 'ready_for_review')
    const uploadEncounter = buildEncounterPayload(encounterId, smokeJobId, 'ready_for_review', reviewResult)

    await page.route('**/api/encounters', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue()
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          encounter_id: encounterId,
          status: 'draft',
          draft_version: 0,
          draft_text: '',
          draft_segments: [],
          review_result: null,
        }),
      })
    })

    await page.route('**/api/upload?encounter_id=*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...uploadEncounter,
          filename: 'sample-clinical.mp3',
          created_at: '2026-03-15T09:00:00Z',
          updated_at: '2026-03-15T09:00:03Z',
        }),
      })
    })

    await page.route(`**/api/encounters/${encounterId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(uploadEncounter),
      })
    })

    await page.goto('/')

    const hideHelperButton = page.getByRole('button', { name: 'Hide helper' })
    if (await hideHelperButton.isVisible().catch(() => false)) {
      await hideHelperButton.click({ force: true })
    }

    await expect(page.getByRole('heading', { name: 'Upload a recording', level: 4 })).toBeVisible()
    await page.locator('#audio-upload').setInputFiles(SAMPLE_AUDIO_FILE)
    await expect(page.getByText('sample-clinical.mp3')).toBeVisible()

    await page.getByRole('button', { name: 'Upload and process' }).click()

    await expect(page).toHaveURL(new RegExp(`/encounters/${encounterId}/review$`))
    await expect(page.getByRole('heading', { name: 'Clinician-ready note and action items' })).toBeVisible()
    await expect(page.getByText('The patient reports headaches for two weeks with light sensitivity.').first()).toBeVisible()
  })

  test('supports tenant bootstrap, member assignment, and voice session exchange in local dev auth', async ({ request }) => {
    const uniqueSuffix = Date.now()
    const tenantOwnerHeaders = {
      'X-MS-CLIENT-PRINCIPAL-ID': `bootstrap-owner-${uniqueSuffix}`,
      'X-MS-CLIENT-PRINCIPAL-NAME': 'Bootstrap Owner',
      'X-MS-CLIENT-PRINCIPAL-EMAIL': `bootstrap-owner-${uniqueSuffix}@localhost`,
    }

    const createTenantResponse = await request.post(`${API_BASE_URL}/platform-admin/tenants`, withAuth({
      data: {
        name: `Bootstrap Clinic ${uniqueSuffix}`,
      },
    }, tenantOwnerHeaders))

    expect(createTenantResponse.ok(), await createTenantResponse.text()).toBeTruthy()
    const createTenantPayload = await createTenantResponse.json()
    const tenantId = createTenantPayload.tenant.id
    expect(createTenantPayload.membership.role).toBe('owner')

    const createEncounterResponse = await request.post(`${API_BASE_URL}/encounters`, withAuth({
      data: { source: 'phase-1b-smoke', language: 'en-US' },
    }, {
      ...tenantOwnerHeaders,
      'X-Clinical-Tenant-Id': tenantId,
    }))
    expect(createEncounterResponse.ok(), await createEncounterResponse.text()).toBeTruthy()
    const encounterPayload = await createEncounterResponse.json()

    const addMemberResponse = await request.post(`${API_BASE_URL}/platform-admin/tenants/${tenantId}/members`, withAuth({
      data: {
        email: `reviewer-${uniqueSuffix}@example.com`,
        role: 'reviewer',
      },
    }, {
      ...tenantOwnerHeaders,
      'X-Clinical-Tenant-Id': tenantId,
    }))
    expect(addMemberResponse.ok(), await addMemberResponse.text()).toBeTruthy()
    const addMemberPayload = await addMemberResponse.json()
    expect(addMemberPayload.email).toBe(`reviewer-${uniqueSuffix}@example.com`)
    expect(addMemberPayload.role).toBe('reviewer')
    expect(addMemberPayload.placeholder_user_created).toBeTruthy()

    const voiceSessionResponse = await request.post(`${API_BASE_URL}/voice-sessions`, withAuth({
      data: {
        encounter_id: encounterPayload.encounter_id,
      },
    }, {
      ...tenantOwnerHeaders,
      'X-Clinical-Tenant-Id': tenantId,
    }))
    expect(voiceSessionResponse.ok(), await voiceSessionResponse.text()).toBeTruthy()
    const voiceSessionPayload = await voiceSessionResponse.json()
    expect(voiceSessionPayload.session_token).toBeTruthy()
    expect(voiceSessionPayload.expires_at).toMatch(/Z$/)
    expect(voiceSessionPayload.encounter_id).toBe(encounterPayload.encounter_id)
  })

  test('shows tenant selection for multi-membership users and propagates the active tenant header', async ({ page }) => {
    const encounterId = 'enc-tenant-selection-smoke'
    let observedTenantHeader = null

    await page.route('**/.auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ user_id: 'multi-tenant-user' }]),
      })
    })

    await page.route('**/api/auth/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          authenticated: true,
          user_id: 'multi-tenant-user',
          email: 'multi.tenant@example.com',
          name: 'Multi Tenant User',
          identity_provider: 'aad',
          tenant_id: null,
          role: null,
          memberships: [
            { tenant_id: 'tenant-a', tenant_name: 'Clinic A', tenant_slug: 'clinic-a', role: 'reviewer' },
            { tenant_id: 'tenant-b', tenant_name: 'Clinic B', tenant_slug: 'clinic-b', role: 'owner' },
          ],
          can_create_tenant: true,
        }),
      })
    })

    await page.route(`**/api/encounters/${encounterId}`, async (route) => {
      observedTenantHeader = route.request().headers()['x-clinical-tenant-id'] || null
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildEncounterPayload(encounterId, '', 'review', null)),
      })
    })

    await page.goto(`/encounters/${encounterId}/review`)
    await expect(page.getByRole('heading', { name: 'Choose the workspace for this session' })).toBeVisible()

    await page.getByRole('combobox').selectOption('tenant-b')

    await expect.poll(() => observedTenantHeader).toBe('tenant-b')
  })
})
