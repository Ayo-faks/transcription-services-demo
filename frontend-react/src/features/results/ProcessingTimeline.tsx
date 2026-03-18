import { useEffect, useMemo, useState } from 'react'
import type { JobProcessingStage, JobStatus } from '../../shared/types/api'

interface ProcessingTimelineProps {
  status: Exclude<JobStatus, 'completed' | 'failed'>
  processingStage?: JobProcessingStage | null
  jobId?: string | null
  processingTimeLabel: string
}

type StepState = 'pending' | 'active' | 'complete'

interface ProcessingStep {
  id: string
  label: string
  detail: string
  state: StepState
}

interface ProcessingStage {
  eyebrow: string
  headline: string
  narrative: string
  minProgress: number
  maxProgress: number
  pulseLabel: string
}

function buildSteps(status: Exclude<JobStatus, 'completed' | 'failed'>, processingStage?: JobProcessingStage | null): ProcessingStep[] {
  switch (processingStage) {
    case 'search_indexing':
      return [
        {
          id: 'transcribe',
          label: 'Transcript generation',
          detail: 'Transcript generation completed successfully.',
          state: 'complete',
        },
        {
          id: 'analyze',
          label: 'Clinical analysis',
          detail: 'Findings, medications, tests, and timeline evidence have been assembled.',
          state: 'complete',
        },
        {
          id: 'complete',
          label: 'Results handoff',
          detail: 'Search indexing and final review packaging are finishing now.',
          state: 'active',
        },
      ]
    case 'summary_generation':
    case 'clinical_analysis':
      return [
        {
          id: 'transcribe',
          label: 'Transcript generation',
          detail: 'Transcript generation completed successfully.',
          state: 'complete',
        },
        {
          id: 'analyze',
          label: 'Clinical analysis',
          detail: 'The system is deriving findings, medications, tests, and follow-up evidence.',
          state: 'active',
        },
        {
          id: 'complete',
          label: 'Results handoff',
          detail: 'Final review packaging unlocks as soon as analysis finishes.',
          state: 'pending',
        },
      ]
    case 'queued':
      return [
        {
          id: 'transcribe',
          label: 'Transcript generation',
          detail: 'Speech recognition is starting immediately now that capture has ended.',
          state: 'active',
        },
        {
          id: 'analyze',
          label: 'Clinical analysis',
          detail: 'Clinical extraction will begin as soon as the transcript is ready.',
          state: 'pending',
        },
        {
          id: 'complete',
          label: 'Results handoff',
          detail: 'The review page will switch into the completed result as soon as the pipeline lands.',
          state: 'pending',
        },
      ]
  }

  switch (status) {
    case 'transcribing':
      return [
        {
          id: 'transcribe',
          label: 'Transcript generation',
          detail: 'Speech recognition is converting the visit into timed clinical text.',
          state: 'active',
        },
        {
          id: 'analyze',
          label: 'Clinical analysis',
          detail: 'Entity extraction, relations, and visit signals are waiting on the transcript.',
          state: 'pending',
        },
        {
          id: 'complete',
          label: 'Results handoff',
          detail: 'Summaries and final review packaging unlock once analysis lands.',
          state: 'pending',
        },
      ]
    case 'analyzing':
      return [
        {
          id: 'transcribe',
          label: 'Transcript generation',
          detail: 'Transcript generation completed successfully.',
          state: 'complete',
        },
        {
          id: 'analyze',
          label: 'Clinical analysis',
          detail: 'The system is deriving findings, tests, medications, and follow-up evidence.',
          state: 'active',
        },
        {
          id: 'complete',
          label: 'Results handoff',
          detail: 'The visit outputs page will unlock as soon as the analysis contract completes.',
          state: 'pending',
        },
      ]
    default:
      return [
        {
          id: 'transcribe',
          label: 'Transcript generation',
          detail: 'Speech recognition is starting automatically now that intake has finalized.',
          state: 'active',
        },
        {
          id: 'analyze',
          label: 'Clinical analysis',
          detail: 'Clinical extraction follows once the transcript is ready.',
          state: 'pending',
        },
        {
          id: 'complete',
          label: 'Results handoff',
          detail: 'Summaries and outputs appear as the final handoff.',
          state: 'pending',
        },
      ]
  }
}

function getStage(status: Exclude<JobStatus, 'completed' | 'failed'>, processingStage?: JobProcessingStage | null): ProcessingStage {
  switch (processingStage) {
    case 'search_indexing':
      return {
        eyebrow: 'Complete',
        headline: 'Packaging the final review and evidence',
        narrative: 'Search-backed context, summary artifacts, and final clinician outputs are being committed for the finished review surface.',
        minProgress: 88,
        maxProgress: 98,
        pulseLabel: 'Finishing final review handoff',
      }
    case 'summary_generation':
    case 'clinical_analysis':
      return {
        eyebrow: 'Analyze',
        headline: 'Extracting clinical signals and assembling outputs',
        narrative: 'Entities, relations, summaries, and clinician-ready outputs are being built from the completed transcript.',
        minProgress: 62,
        maxProgress: 86,
        pulseLabel: 'Extracting entities and visit outputs',
      }
    case 'queued':
      return {
        eyebrow: 'Transcribe',
        headline: 'Listening through the visit audio',
        narrative: 'Capture has ended and the recording is already moving through transcript generation for the final review.',
        minProgress: 18,
        maxProgress: 54,
        pulseLabel: 'Converting speech to text',
      }
  }

  switch (status) {
    case 'transcribing':
      return {
        eyebrow: 'Transcribe',
        headline: 'Listening through the visit audio',
        narrative: 'The service is turning the raw recording into structured transcript text before any clinical interpretation begins.',
        minProgress: 28,
        maxProgress: 64,
        pulseLabel: 'Converting speech to text',
      }
    case 'analyzing':
      return {
        eyebrow: 'Analyze',
        headline: 'Extracting clinical signals and assembling outputs',
        narrative: 'Entities, relations, summaries, and export-ready artifacts are being built from the completed transcript.',
        minProgress: 68,
        maxProgress: 96,
        pulseLabel: 'Extracting entities and visit outputs',
      }
    default:
      return {
        eyebrow: 'Transcribe',
        headline: 'Listening through the visit audio',
        narrative: 'The recording is staged and transcription is starting automatically.',
        minProgress: 18,
        maxProgress: 54,
        pulseLabel: 'Converting speech to text',
      }
  }
}

export function ProcessingTimeline({ status, processingStage, jobId, processingTimeLabel }: ProcessingTimelineProps) {
  const stage = useMemo(() => getStage(status, processingStage), [processingStage, status])
  const steps = buildSteps(status, processingStage)
  const [displayProgress, setDisplayProgress] = useState(stage.minProgress)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDisplayProgress((currentProgress) => {
        const normalizedProgress = Math.max(currentProgress, stage.minProgress)

        if (normalizedProgress >= stage.maxProgress) {
          return currentProgress
        }

        const remaining = stage.maxProgress - normalizedProgress
        const increment = Math.max(0.4, remaining / 18)
        return Number(Math.min(stage.maxProgress, normalizedProgress + increment).toFixed(1))
      })
    }, 180)

    return () => window.clearInterval(timer)
  }, [stage.maxProgress, stage.minProgress])

  return (
    <section className="surface-card processing-timeline-card">
      <div className="card-heading-row">
        <div>
          <p className="section-label">Automatic processing</p>
          <h4>{stage.headline}</h4>
        </div>
        <span className="status-pill">{status}</span>
      </div>

      <div className="processing-hero-row">
        <div className="processing-hero-copy">
          <p className="processing-stage-eyebrow">{stage.eyebrow}</p>
          <strong>{stage.pulseLabel}</strong>
          <p>{stage.narrative}</p>
          <p>
            {jobId
              ? `Job ${jobId} is running in the background. This page will switch into the finished outputs view as soon as processing completes.`
              : 'Processing is being started for this encounter. This page will switch into the finished outputs view as soon as the background job is available.'}
          </p>
        </div>
        <div className="processing-meta-grid">
          <div className="processing-meta-chip">
            <span>Elapsed</span>
            <strong>{processingTimeLabel}</strong>
          </div>
          <div className="processing-meta-chip processing-meta-chip-accent">
            <span>Workflow progress</span>
            <strong>{Math.round(displayProgress)}%</strong>
          </div>
        </div>
      </div>

      <div className="processing-progress-shell" aria-hidden="true">
        <div className="processing-progress-bar">
          <span className="processing-progress-fill" style={{ width: `${displayProgress}%` }} />
          <span className="processing-progress-beam" />
        </div>
        <div className="processing-progress-scale">
          <span>Upload</span>
          <span>Transcribe</span>
          <span>Analyze</span>
          <span>Complete</span>
        </div>
      </div>

      <div className="processing-step-list">
        {steps.map((step, index) => (
          <article key={step.id} className={`processing-step processing-step-${step.state}`}>
            <div className="processing-step-marker" aria-hidden="true">
              <span>{step.state === 'complete' ? '✓' : index + 1}</span>
            </div>
            <div className="processing-step-copy">
              <strong>{step.label}</strong>
              <p>{step.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}