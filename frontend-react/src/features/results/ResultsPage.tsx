import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { jobsApi } from '../../api/jobsApi'
import { summaryApi } from '../../api/summaryApi'
import { useApiBaseUrl } from '../../api/client'
import { useAssistantSessionStore } from '../../assistant/state/AssistantSessionStore'
import { useRegisterCurrentView } from '../../assistant/tools/CurrentViewProvider'
import type { ClinicalSummaryResponse, JobResult, JobStatusResponse, MedicalEntity } from '../../shared/types/api'
import { AdvancedDataSection } from './AdvancedDataSection'
import { extractClinicalSummarySignals } from './clinicalSummary'
import { ProcessingTimeline } from './ProcessingTimeline'
import { getNextPollDelayMs } from '../../shared/utils/polling'

function formatDuration(seconds?: number | null) {
  if (!seconds) {
    return 'Pending'
  }

  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }

  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

function buildEntityFacts(entities: MedicalEntity[]) {
  return entities.slice(0, 5).map((entity) => {
    const category = entity.category || 'Uncategorized'
    return `${category}: ${entity.text || 'Unnamed entity'}.`
  })
}

function normalize(values: string[]) {
  const seen = new Set<string>()

  return values.filter((value) => {
    const normalized = value.trim().toLowerCase()
    if (!normalized || seen.has(normalized)) {
      return false
    }

    seen.add(normalized)
    return true
  })
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function ResultsPage() {
  const { jobId: routeJobId = '' } = useParams()
  const location = useLocation()
  const jobId = useMemo(() => {
    if (routeJobId) {
      return routeJobId
    }

    const match = location.pathname.match(/\/jobs\/([^/]+)$/)
    return match?.[1] || ''
  }, [location.pathname, routeJobId])
  const navigate = useNavigate()
  const apiBaseUrl = useApiBaseUrl()
  const { setLastProcessedJobId } = useAssistantSessionStore(useShallow((state) => ({
    setLastProcessedJobId: state.setLastProcessedJobId,
  })))
  const [status, setStatus] = useState<JobStatusResponse | null>(null)
  const [result, setResult] = useState<JobResult | null>(null)
  const [summary, setSummary] = useState<ClinicalSummaryResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const activeProcessingStatus = !result && status && status.status !== 'completed' && status.status !== 'failed' ? status.status : null
  const effectiveSummary = summary || result?.clinical_summary || null

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const controller = new AbortController()
    void loadAttempt

    async function load(attempt = 0) {
      if (!jobId) {
        return
      }

      try {
        const nextStatus = await jobsApi.getStatus(apiBaseUrl, jobId, controller.signal)
        if (cancelled) {
          return
        }

        setStatus(nextStatus)

        if (nextStatus.status === 'completed') {
          const [nextResult, nextSummary] = await Promise.all([
            jobsApi.getResults(apiBaseUrl, jobId, controller.signal),
            summaryApi.get(apiBaseUrl, jobId, controller.signal).catch(() => null),
          ])

          if (cancelled) {
            return
          }

          setResult(nextResult)
          setSummary(nextSummary || nextResult.clinical_summary || null)
          setLastProcessedJobId(jobId)
          setIsLoading(false)
          return
        }

        if (nextStatus.status === 'failed') {
          setError(nextStatus.error_message || 'Processing failed.')
          setIsLoading(false)
          return
        }

        setIsLoading(false)
        timer = window.setTimeout(() => {
          void load(attempt + 1)
        }, getNextPollDelayMs(attempt))
      } catch (loadError) {
        if (controller.signal.aborted) {
          return
        }
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Results could not be loaded.')
          setIsLoading(false)
        }
      }
    }

    queueMicrotask(() => {
      if (cancelled) {
        return
      }

      setIsLoading(true)
      setError(null)
      setResult(null)
      setSummary(null)
      void load()
    })

    return () => {
      cancelled = true
      controller.abort()
      if (timer) {
        window.clearTimeout(timer)
      }
    }
  }, [apiBaseUrl, jobId, loadAttempt, setLastProcessedJobId])

  const entities = useMemo(() => result?.medical_analysis?.entities ?? [], [result])
  const relations = useMemo(() => result?.medical_analysis?.relations ?? [], [result])
  const encounterId = result?.source_encounter_id || result?.encounter_id || null
  const summarySignals = useMemo(() => extractClinicalSummarySignals(effectiveSummary), [effectiveSummary])
  const followUpItems = useMemo(
    () => normalize([...summarySignals.followUpItems, ...summarySignals.patientInstructions]).slice(0, 6),
    [summarySignals.followUpItems, summarySignals.patientInstructions],
  )
  const summaryReady = Boolean(effectiveSummary && !effectiveSummary.error)

  const viewContext = useMemo(
    () => ({
      route: `/jobs/${jobId}`,
      title: 'Technical Results',
      summary: result
        ? `Technical job results are available for ${jobId}. Use the encounter review route for the clinician-first final note experience.`
        : `Job ${jobId} is processing and the technical payload is not ready yet.`,
      facts: [
        result
          ? `Visit output status: ${result.status || 'unknown'}.`
          : `Visit output status: ${status?.status || 'processing'}.`,
        result && summarySignals.headline ? `Visit summary: ${summarySignals.headline}` : 'Visit summary is not available yet.',
        ...(result ? buildEntityFacts(entities) : []),
        ...(result ? followUpItems.slice(0, 3).map((item) => `Follow-up item: ${item}`) : []),
      ],
      outcomes: result ? ['Technical result payload is available.', 'Advanced transcript and FHIR data are available.'] : ['Processing is still running.'],
      nextSteps: result
        ? ['Open encounter review for clinician approval.', 'Use this page only for technical inspection and export.']
        : ['Wait for transcription and clinical extraction to finish.'],
      raw: {
        jobId,
        status: result ? result.status : status?.status || 'processing',
        processingTimeSeconds: result?.processing_time_seconds || status?.processing_time_seconds || null,
      },
    }),
    [entities, followUpItems, jobId, result, status?.processing_time_seconds, status?.status, summarySignals.headline],
  )

  useRegisterCurrentView(viewContext)

  function handleRetryLoad() {
    setLoadAttempt((currentAttempt) => currentAttempt + 1)
  }

  return (
    <div className="page-grid">
      <section className="hero-card outputs-hero-card">
        <p className="shell-eyebrow">{result ? 'Technical results' : 'Automatic processing'}</p>
        <h3>{result ? 'Technical job payload is available' : 'Your upload is being processed'}</h3>
        <p>
          {result
            ? 'This route is now a lower-priority technical surface. Use encounter review for the clinician-first final note and approval workflow.'
            : 'The upload flow starts processing automatically. Watch each stage complete here until the final encounter review is ready.'}
        </p>

        <div className="chip-row outputs-hero-statuses">
          <span className="status-pill">Visit status: {status?.status || result?.status || 'loading'}</span>
          <span className="status-pill subtle">Processing time: {formatDuration(result?.processing_time_seconds || status?.processing_time_seconds)}</span>
          {encounterId ? <span className="status-pill subtle">Encounter-linked</span> : null}
        </div>
      </section>

      {isLoading ? <p className="loading-state">Loading outputs from the current backend contract...</p> : null}
      {error ? (
        <div className="retry-banner">
          <div className="error-banner">{error}</div>
          <button type="button" className="secondary-button retry-button" onClick={handleRetryLoad} disabled={isLoading}>
            Try again
          </button>
        </div>
      ) : null}

      {activeProcessingStatus ? (
        <ProcessingTimeline
          status={activeProcessingStatus}
          jobId={jobId}
          processingTimeLabel={formatDuration(status?.processing_time_seconds)}
        />
      ) : null}

      {!result && status && status.status === 'failed' ? (
        <section className="surface-card processing-panel">
          <p>This visit did not finish processing.</p>
          <p>{status.error_message || 'Transcription or downstream analysis failed.'}</p>
        </section>
      ) : null}

      {result ? (
        <>
          <section className="surface-card outputs-summary-card">
            <div className="card-heading-row">
              <div>
                <p className="section-label">Summary snapshot</p>
                <h4>Technical summary view</h4>
              </div>
            </div>

            <div>
                <p className="section-label">Clinician summary</p>
                <h4>What happened in the visit</h4>

              {effectiveSummary?.summary_text ? (
                <pre className="code-block transcription-block">{effectiveSummary.summary_text}</pre>
              ) : (
                <p>No structured summary text is available for this job yet.</p>
              )}
              {encounterId ? <span className="status-pill">Encounter-backed</span> : null}
            </div>
          </section>

          <section className="surface-card">
            <div className="card-heading-row">
              <div>
                <p className="section-label">Technical snapshot</p>
                <h4>Payload counts and next routes</h4>
              </div>
            </div>

            <div className="metric-grid">
              <article className="metric-card">
                <span>Entities</span>
                <strong>{entities.length}</strong>
                <p>Extracted medical entities in the technical payload.</p>
              </article>
              <article className="metric-card">
                <span>Relations</span>
                <strong>{relations.length}</strong>
                <p>Extracted relationships in the technical payload.</p>
              </article>
              <article className="metric-card">
                <span>Summary</span>
                <strong>{summaryReady ? 'Ready' : 'Pending'}</strong>
                <p>Structured summary generation state for the job payload.</p>
              </article>
            </div>

            <div className="action-row">
              {encounterId ? (
                <button type="button" className="primary-button" onClick={() => navigate(`/encounters/${encounterId}/review`)}>
                  Open final clinician review
                </button>
              ) : null}
              {result.fhir_bundle ? (
                <button type="button" className="secondary-button" onClick={() => downloadJson(`job-${jobId}-outputs.json`, result.fhir_bundle)}>
                  Export FHIR bundle
                </button>
              ) : null}
            </div>
          </section>

          <AdvancedDataSection
            transcriptText={result.transcription.text || ''}
            entities={entities}
            relations={relations}
            fhirBundle={result.fhir_bundle}
            summary={effectiveSummary}
          />
        </>
      ) : null}
    </div>
  )
}