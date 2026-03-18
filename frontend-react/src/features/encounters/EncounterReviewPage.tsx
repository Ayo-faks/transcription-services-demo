import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { jobsApi } from '../../api/jobsApi'
import { useApiBaseUrl } from '../../api/client'
import { useAssistantTransport } from '../../app/providers/AssistantWorkspaceProvider'
import { getEncounterReviewResult, hydrateEncounterPayload } from '../../assistant/transport/AssistantTransport'
import { useAssistantSessionStore } from '../../assistant/state/AssistantSessionStore'
import { useRegisterCurrentView } from '../../assistant/tools/CurrentViewProvider'
import type { EncounterResponse, FinalNoteSectionKey, JobProcessingStage, JobStatus, JobStatusResponse } from '../../shared/types/api'
import { AnalysisResultsPanel } from '../results/AnalysisResultsPanel'
import { OutputActionRail } from '../results/OutputActionRail'
import { OutputsReadyPanel } from '../results/OutputsReadyPanel'
import { ProcessingTimeline } from '../results/ProcessingTimeline'
import { SummaryPanel } from '../results/SummaryPanel'
import { getNextPollDelayMs } from '../../shared/utils/polling'

export function EncounterReviewPage() {
  const { encounterId: routeEncounterId = '' } = useParams()
  const location = useLocation()
  const encounterId = useMemo(() => {
    if (routeEncounterId) {
      return routeEncounterId
    }

    const match = location.pathname.match(/\/encounters\/([^/]+)\/review$/)
    return match?.[1] || ''
  }, [location.pathname, routeEncounterId])
  const navigate = useNavigate()
  const apiBaseUrl = useApiBaseUrl()
  const transport = useAssistantTransport()
  const {
    encounterStatus,
    processingStage,
    reviewResult,
    setEncounter,
    setReviewResult,
    setBusy,
    setError,
    error,
    isBusy,
    setLastReviewAction,
  } = useAssistantSessionStore(useShallow((state) => ({
    encounterStatus: state.encounterStatus,
    processingStage: state.processingStage,
    reviewResult: state.reviewResult,
    setEncounter: state.setEncounter,
    setReviewResult: state.setReviewResult,
    setBusy: state.setBusy,
    setError: state.setError,
    error: state.error,
    isBusy: state.isBusy,
    setLastReviewAction: state.setLastReviewAction,
  })))
  const [isLoaded, setIsLoaded] = useState(false)
  const [processingJob, setProcessingJob] = useState<JobStatusResponse | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editedSections, setEditedSections] = useState<Partial<Record<FinalNoteSectionKey, string>>>({})
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [currentEncounter, setCurrentEncounter] = useState<EncounterResponse | null>(null)
  const autoRestartRequestedRef = useRef(false)

  const effectiveReviewResult = currentEncounter?.review_result || reviewResult || null
  const effectiveStatus = effectiveReviewResult?.status || currentEncounter?.status || encounterStatus || 'processing'
  const reviewJobId = effectiveReviewResult?.job_id || null

  const syncEncounterPayload = useCallback((payload: EncounterResponse) => {
    setCurrentEncounter(payload)
    setEncounter(hydrateEncounterPayload(payload))
    if (payload.review_result) {
      setReviewResult(payload.review_result)
    }
    return payload
  }, [setEncounter, setReviewResult])

  const ensureEncounterProcessing = useCallback(async (payload: EncounterResponse) => {
    const hasTranscriptContent = Boolean((payload.finalized_text || payload.draft_text || '').trim())
    const isOrphanedReview = payload.status === 'review' && hasTranscriptContent && !payload.process_job_id && !payload.review_result
    if (!isOrphanedReview || autoRestartRequestedRef.current) {
      return null
    }

    autoRestartRequestedRef.current = true
    const processPayload = await transport.processClinically(encounterId)
    setProcessingJob({
      job_id: processPayload.job_id,
      filename: 'encounter-audio',
      status: processPayload.job_status || 'pending',
      created_at: '',
      updated_at: '',
      processing_time_seconds: processPayload.processing_time_seconds,
      error_message: null,
      processing_stage: processPayload.processing_stage,
    })

    return transport.getEncounter(encounterId)
  }, [encounterId, transport])

  useEffect(() => {
    autoRestartRequestedRef.current = false
  }, [])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    void loadAttempt

    async function loadEncounter() {
      setBusy(true)
      setError(null)
      setIsLoaded(false)

      try {
        const payload = await transport.getEncounter(encounterId, controller.signal)
        if (!cancelled) {
          const recoveredPayload = await ensureEncounterProcessing(payload).catch(() => null)
          const effectivePayload = recoveredPayload || payload
          syncEncounterPayload(effectivePayload)
          setIsLoaded(true)

          if (effectivePayload.process_job_id && effectivePayload.status === 'processing') {
            const nextStatus = await jobsApi.getStatus(apiBaseUrl, effectivePayload.process_job_id, controller.signal).catch(() => null)
            if (!cancelled) {
              setProcessingJob(nextStatus)
            }
          }
        }
      } catch (loadError) {
        if (controller.signal.aborted) {
          return
        }
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Encounter review could not be loaded.')
        }
      } finally {
        if (!cancelled) {
          setBusy(false)
        }
      }
    }

    if (encounterId) {
      void loadEncounter()
    }

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [apiBaseUrl, encounterId, ensureEncounterProcessing, loadAttempt, setBusy, setError, syncEncounterPayload, transport])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const controller = new AbortController()

    async function pollEncounter(attempt = 0) {
      if (!encounterId) {
        return
      }

      try {
        const payload = await transport.getEncounter(encounterId, controller.signal)
        if (cancelled) {
          return
        }

        const recoveredPayload = await ensureEncounterProcessing(payload).catch(() => null)
        const effectivePayload = recoveredPayload || payload
        syncEncounterPayload(effectivePayload)

        if (effectivePayload.process_job_id) {
          const nextStatus = await jobsApi.getStatus(apiBaseUrl, effectivePayload.process_job_id, controller.signal).catch(() => null)
          if (!cancelled) {
            setProcessingJob(nextStatus)
          }
        }

        if (effectivePayload.review_result || effectivePayload.status === 'ready_for_review' || effectivePayload.status === 'approved' || effectivePayload.status === 'failed') {
          if (!effectivePayload.review_result) {
            // Try to fetch review result directly — it may exist even without a process_job_id
            const nextReviewResult = await transport.getEncounterReviewResult(encounterId, controller.signal).catch(() => null)
            if (!cancelled && nextReviewResult) {
              setReviewResult(nextReviewResult)
            }
          }
          return
        }

        timer = window.setTimeout(() => {
          void pollEncounter(attempt + 1)
        }, getNextPollDelayMs(attempt))
      } catch {
        if (controller.signal.aborted) {
          return
        }
        timer = window.setTimeout(() => {
          void pollEncounter(attempt + 1)
        }, getNextPollDelayMs(attempt))
      }
    }

    if (!encounterId || effectiveReviewResult?.status === 'ready_for_review' || effectiveReviewResult?.status === 'approved' || effectiveStatus === 'failed') {
      return () => undefined
    }

    if (effectiveStatus === 'processing' || !effectiveReviewResult) {
      void pollEncounter()
    }

    return () => {
      cancelled = true
      controller.abort()
      if (timer) {
        window.clearTimeout(timer)
      }
    }
  }, [apiBaseUrl, effectiveReviewResult, effectiveStatus, encounterId, ensureEncounterProcessing, setReviewResult, syncEncounterPayload, transport])

  const viewContext = useMemo(
    () => ({
      route: `/encounters/${encounterId}/review`,
      title: 'Final Review',
      summary: effectiveReviewResult
        ? `Final clinician review is ${effectiveStatus}. The note and structured clinical outputs are ready for clinician review.`
        : `Encounter ${encounterId} is ${effectiveStatus}. Automatic processing is still preparing the final clinician review payload.`,
      facts: [
        `Encounter status: ${effectiveStatus}.`,
        effectiveReviewResult ? `Review version: ${effectiveReviewResult.review_version}.` : 'Review payload is not ready yet.',
        effectiveReviewResult ? `Structured findings: ${effectiveReviewResult.structured_findings.length}.` : 'Structured findings are still being prepared.',
        effectiveReviewResult ? `Medication changes: ${effectiveReviewResult.medication_changes.length}.` : 'Medication changes are still being prepared.',
        effectiveReviewResult ? `Tests: ${effectiveReviewResult.tests_and_referrals.tests.length}.` : 'Tests and referrals are still being prepared.',
      ],
      outcomes: effectiveReviewResult
        ? ['Final note is ready.', 'Clinician action cards are ready.', 'Evidence is available as optional disclosure.']
        : ['Automatic transcription and clinical processing are still running.'],
      nextSteps: effectiveReviewResult
        ? ['Approve the final note, edit note sections, or regenerate clinician outputs.']
        : ['Wait for the pipeline to finish, then review the final note.'],
      raw: {
        encounterId,
        encounterStatus: effectiveStatus,
        processingStage,
        reviewResult: effectiveReviewResult,
        processingJob,
      },
    }),
    [effectiveReviewResult, effectiveStatus, encounterId, processingJob, processingStage],
  )

  useRegisterCurrentView(viewContext)

  async function runAction(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Encounter action failed.')
    } finally {
      setBusy(false)
    }
  }

  async function refreshEncounter() {
    const payload = await transport.getEncounter(encounterId)
    syncEncounterPayload(payload)
    return payload
  }

  function handleRetryLoad() {
    setLoadAttempt((currentAttempt) => currentAttempt + 1)
  }

  async function handleSaveReview() {
    if (!effectiveReviewResult || Object.keys(editedSections).length === 0) {
      setIsEditing(false)
      return
    }

    await runAction(async () => {
      const response = await transport.saveEncounterReview(encounterId, {
        action: 'save_edits',
        note_sections: editedSections,
      })

      const nextReviewResult = getEncounterReviewResult(response) || (await transport.getEncounterReviewResult(encounterId))
      setReviewResult(nextReviewResult)
      setLastReviewAction('save_edits')
      setEditedSections({})
      setIsEditing(false)
      await refreshEncounter()
    })
  }

  async function handleApprove() {
    await runAction(async () => {
      if (isEditing && Object.keys(editedSections).length > 0) {
        const saveResponse = await transport.saveEncounterReview(encounterId, {
          action: 'save_edits',
          note_sections: editedSections,
        })
        const savedReviewResult = getEncounterReviewResult(saveResponse)
        if (savedReviewResult) {
          setReviewResult(savedReviewResult)
        }
      }

      const response = await transport.approveEncounterReview(encounterId)
      const nextReviewResult = getEncounterReviewResult(response) || (await transport.getEncounterReviewResult(encounterId))
      setReviewResult(nextReviewResult)
      setLastReviewAction('approve')
      setEditedSections({})
      setIsEditing(false)
      await refreshEncounter()
    })
  }

  async function handleRegenerate() {
    await runAction(async () => {
      const response = await transport.regenerateEncounterReview(encounterId)
      const nextReviewResult = getEncounterReviewResult(response) || (await transport.getEncounterReviewResult(encounterId))
      setReviewResult(nextReviewResult)
      setLastReviewAction('regenerate')
      setEditedSections({})
      setIsEditing(false)
      await refreshEncounter()
    })
  }

  function handleChangeSection(key: FinalNoteSectionKey, value: string) {
    setEditedSections((currentState) => ({
      ...currentState,
      [key]: value,
    }))
  }

  const activeProcessingStatus = processingJob && processingJob.status !== 'completed' && processingJob.status !== 'failed'
    ? processingJob.status
    : null
  const activeProcessingStage: JobProcessingStage | null = processingJob?.processing_stage || processingStage || effectiveReviewResult?.processing_stage || null

  const noteHasUnsavedChanges = Object.keys(editedSections).length > 0
  const canApprove = Boolean(effectiveReviewResult) && effectiveStatus !== 'approved'
  const technicalJobId = effectiveReviewResult?.job_id || processingJob?.job_id || reviewJobId

  const hasReadyReviewState = Boolean(effectiveReviewResult) || effectiveStatus === 'ready_for_review' || effectiveStatus === 'approved' || effectiveStatus === 'failed'
  const isProcessingStatus = (
    effectiveStatus === 'processing' ||
    effectiveStatus === 'capturing' ||
    effectiveStatus === 'ready_for_processing' ||
    effectiveStatus === 'draft'
  )
  const isWaitingForProcessing = !hasReadyReviewState && (
    activeProcessingStatus ||
    (activeProcessingStage && activeProcessingStage !== 'completed' && activeProcessingStage !== 'failed') ||
    isProcessingStatus ||
    (!isLoaded && !error)
  )

  if (isWaitingForProcessing) {
    const timelineStatus: Exclude<JobStatus, 'completed' | 'failed'> = activeProcessingStatus || 'pending'
    const timelineJobId = processingJob?.job_id || reviewJobId || null
    const timelineTime = processingJob?.processing_time_seconds
      ? `${processingJob.processing_time_seconds.toFixed(1)}s`
      : 'Pending'

    return (
      <div className="page-grid review-page-grid">
        {error ? (
          <div className="retry-banner">
            <div className="error-banner">{error}</div>
            <button type="button" className="secondary-button retry-button" onClick={handleRetryLoad} disabled={isBusy}>
              Try again
            </button>
          </div>
        ) : null}
        <section className="surface-card review-intro-card">
          <div>
            <p className="shell-eyebrow">In Progress</p>
            <h3>Preparing the final clinician review</h3>
            <p>
              Audio capture and uploaded recordings now run through the full pipeline automatically. The clinician review opens when the final note and structured outputs are ready.
            </p>
          </div>
          <div className="review-meta">
            <span className="status-pill">{effectiveStatus.replace(/_/g, ' ')}</span>
            {processingStage ? <span className="status-pill subtle">{processingStage.replace(/_/g, ' ')}</span> : null}
          </div>
        </section>

        <ProcessingTimeline
          status={timelineStatus}
          processingStage={activeProcessingStage}
          jobId={timelineJobId}
          processingTimeLabel={timelineTime}
        />
      </div>
    )
  }

  return (
    <div className="page-grid review-page-grid">
      {error ? (
        <div className="retry-banner">
          <div className="error-banner">{error}</div>
          <button type="button" className="secondary-button retry-button" onClick={handleRetryLoad} disabled={isBusy}>
            Try again
          </button>
        </div>
      ) : null}
      {!isLoaded && !error ? <p className="loading-state">Loading review...</p> : null}

      <section className="surface-card review-intro-card">
        <div>
          <p className="shell-eyebrow">Final Review</p>
          <h3>Clinician-ready note and action items</h3>
        </div>
        <div className="review-meta">
          <span className="status-pill">{effectiveStatus.replace(/_/g, ' ')}</span>
          {effectiveReviewResult?.transcript.speaker_count ? (
            <span className="status-pill subtle">
              {effectiveReviewResult.transcript.speaker_count} speaker{effectiveReviewResult.transcript.speaker_count === 1 ? '' : 's'}
            </span>
          ) : null}
          {effectiveReviewResult?.job_status ? <span className="status-pill subtle">Pipeline {effectiveReviewResult.job_status}</span> : null}
          {effectiveStatus === 'approved' ? <span className="status-pill subtle">Clinician approved</span> : null}
        </div>
      </section>

      <div className="review-layout">
        <section className="surface-card review-compact-card review-draft-card">
          <div className="review-header">
            <div>
              <p className="section-label">Final note</p>
              <h4>Review, edit, or approve</h4>
            </div>
            {isEditing && noteHasUnsavedChanges ? (
              <button type="button" className="secondary-button" onClick={handleSaveReview} disabled={isBusy}>
                Save edits
              </button>
            ) : null}
          </div>

          <SummaryPanel
            reviewResult={effectiveReviewResult}
            isEditing={isEditing}
            editedSections={editedSections}
            onChangeSection={handleChangeSection}
          />

          <OutputsReadyPanel reviewResult={effectiveReviewResult} />
        </section>

        <div className="review-side-column">
          <OutputActionRail
            isBusy={isBusy}
            isEditing={isEditing}
            canApprove={canApprove}
            onApprove={handleApprove}
            onToggleEdit={() => setIsEditing((currentState) => !currentState)}
            onRegenerate={handleRegenerate}
            onOpenTechnicalView={technicalJobId ? () => navigate(`/jobs/${technicalJobId}`) : undefined}
          />
        </div>
      </div>

      {effectiveReviewResult ? <AnalysisResultsPanel reviewResult={effectiveReviewResult} /> : null}
    </div>
  )
}