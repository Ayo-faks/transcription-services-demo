import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useRegisterCurrentView } from '../../assistant/tools/CurrentViewProvider'
import { useAssistantController } from '../../assistant/shell/useAssistantController'

const ACTIVE_SESSION_STATUSES = new Set([
  'requesting-microphone',
  'connecting',
  'recording',
  'muted',
  'stopping',
  'stopped',
  'error',
])

function formatRealtimeStatus(status: string) {
  switch (status) {
    case 'requesting-microphone':
      return 'Waiting for microphone permission'
    case 'connecting':
      return 'Connecting to live gateway'
    case 'recording':
      return 'Recording live'
    case 'muted':
      return 'Microphone muted'
    case 'stopping':
      return 'Stopping recording'
    case 'stopped':
      return 'Recording stopped'
    case 'error':
      return 'Recording problem'
    default:
      return 'Ready to start'
  }
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function getSessionStatusCopy(status: string, transcriptCount: number, error: string | null) {
  switch (status) {
    case 'requesting-microphone':
      return {
        title: 'Allow the microphone to start the session',
        description: 'The gateway session is ready. Confirm microphone access so live capture can begin.',
        emphasis: 'Microphone step',
      }
    case 'connecting':
      return {
        title: 'Checking gateway and opening connection',
        description: 'Wulo is verifying the live gateway is reachable and opening the recording session. This usually takes a few seconds.',
        emphasis: 'Gateway step',
      }
    case 'recording':
      return {
        title: 'Recording in progress',
        description:
          transcriptCount > 0
            ? 'The visit is actively recording. Stop when the conversation ends and automatic processing will prepare the final clinician review.'
            : 'The visit is actively recording. Speak normally and stop when the conversation ends so automatic processing can prepare the final clinician review.',
        emphasis: 'Live',
      }
    case 'muted':
      return {
        title: 'Recording paused by microphone mute',
        description: 'The session is still open, but no microphone audio is being sent until you unmute.',
        emphasis: 'Muted',
      }
    case 'stopping':
      return {
        title: 'Stopping and saving the session',
        description: 'The recording is ending now. Wulo is closing capture and starting the automatic processing pipeline.',
        emphasis: 'Closing',
      }
    case 'stopped':
      return {
        title: 'Recording stopped',
        description: 'The session is complete. Opening the final review route while the clinician-ready outputs are prepared.',
        emphasis: 'Stopped',
      }
    case 'error':
      return {
        title: 'The session needs attention',
        description: error || 'Wulo Scribe hit a recording problem. Anything already captured can still move into final review once the session is stable.',
        emphasis: 'Needs review',
      }
    default:
      return {
        title: 'Ready for a focused recording session',
        description: 'Start Wulo Scribe to open a dedicated live capture surface for the visit. Automatic processing begins when you stop.',
        emphasis: 'Ready',
      }
  }
}

export function AmbientScribePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const autoStartedRef = useRef(false)
  const sessionStartedAtRef = useRef<number | null>(null)
  const [isTranscriptVisible, setIsTranscriptVisible] = useState(false)
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const {
    encounterId,
    encounterStatus,
    draftText,
    transcriptSegments,
    segmentRole,
    setSegmentRole,
    segmentText,
    setSegmentText,
    isBusy,
    error,
    realtimeStatus,
    isMuted,
    hasActiveVoiceSession,
    hasVoiceLive,
    voiceLiveUnavailableReason,
    setDraftText,
    handleStartCapture,
    handleToggleMute,
    handleStopCapture,
    handleSaveDraft,
    handleAppendSegment,
  } = useAssistantController({ variant: 'ambient' })

  useEffect(() => {
    if (searchParams.get('autostart') !== '1' || autoStartedRef.current || isBusy || encounterId) {
      return
    }

    autoStartedRef.current = true
    void handleStartCapture()
  }, [encounterId, handleStartCapture, isBusy, searchParams])

  useEffect(() => {
    let timeoutId: number | undefined

    if ((realtimeStatus === 'recording' || realtimeStatus === 'muted') && sessionStartedAtRef.current === null) {
      const startedAt = Date.now()
      sessionStartedAtRef.current = startedAt
      timeoutId = window.setTimeout(() => {
        setSessionStartedAt(startedAt)
      }, 0)
    }

    if (realtimeStatus === 'idle' && sessionStartedAtRef.current !== null) {
      sessionStartedAtRef.current = null
      timeoutId = window.setTimeout(() => {
        setSessionStartedAt(null)
        setElapsedSeconds(0)
      }, 0)
    }

    return () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [realtimeStatus])

  useEffect(() => {
    if (!sessionStartedAt) {
      return
    }

    const updateElapsed = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - sessionStartedAt) / 1000)))
    }

    updateElapsed()

    if (realtimeStatus !== 'recording' && realtimeStatus !== 'muted') {
      return
    }

    const timer = window.setInterval(updateElapsed, 1000)
    return () => window.clearInterval(timer)
  }, [realtimeStatus, sessionStartedAt])

  const shouldShowSessionSurface = hasVoiceLive && (hasActiveVoiceSession || ACTIVE_SESSION_STATUSES.has(realtimeStatus))
  const displayedElapsedSeconds = sessionStartedAt ? elapsedSeconds : 0

  const statusLabel = useMemo(() => formatRealtimeStatus(realtimeStatus), [realtimeStatus])
  const statusCopy = useMemo(
    () => getSessionStatusCopy(realtimeStatus, transcriptSegments.length, error),
    [error, realtimeStatus, transcriptSegments.length],
  )

  const visibleTranscriptSegments = useMemo(() => {
    const finals = transcriptSegments.filter((segment) => segment.is_final !== false)
    const interimSegment = transcriptSegments[transcriptSegments.length - 1]
    const entries = finals.slice(-10)

    if (interimSegment?.is_final === false) {
      return [...entries, interimSegment]
    }

    return entries
  }, [transcriptSegments])

  const viewContext = useMemo(
    () => ({
      route: '/ambient-scribe',
      title: 'Wulo Scribe',
      summary: encounterId
        ? `Wulo Scribe is ${statusLabel.toLowerCase()}. ${transcriptSegments.length} transcript segments are captured and automatic processing will prepare the final clinician review after capture stops.`
        : 'Wulo Scribe is ready to start live capture for the visit.',
      facts: [
        `Capture state: ${statusLabel}.`,
        hasVoiceLive ? 'Live voice transport is configured.' : 'Live voice transport is unavailable; manual note capture is enabled.',
        encounterId ? `Encounter active: ${encounterId}.` : 'No encounter is active yet.',
        `Captured transcript segments: ${transcriptSegments.length}.`,
      ],
      outcomes: [encounterId ? 'Ambient capture session is in progress or final review is being prepared.' : 'Ambient capture is ready to begin.'],
      nextSteps: [
        shouldShowSessionSurface ? 'Use the fixed session controls to mute, stop, or reveal the live transcript.' : 'Start Wulo Scribe to begin live capture.',
      ],
      raw: {
        encounterId,
        encounterStatus,
        realtimeStatus,
        segmentCount: transcriptSegments.length,
      },
    }),
    [encounterId, encounterStatus, hasVoiceLive, realtimeStatus, shouldShowSessionSurface, statusLabel, transcriptSegments.length],
  )

  useRegisterCurrentView(viewContext)

  return (
    <div className={`page-grid ambient-page-grid${shouldShowSessionSurface ? ' ambient-session-active' : ''}`}>
      {shouldShowSessionSurface ? (
        <>
          <section className="ambient-session-focused">
            {isTranscriptVisible && visibleTranscriptSegments.length > 0 ? (
              <div className="ambient-live-transcript">
                {visibleTranscriptSegments.map((segment) => (
                  <p key={`${segment.timestamp}-${segment.text}`} className={segment.is_final === false ? 'ambient-live-line interim' : 'ambient-live-line'}>
                    {segment.text}
                  </p>
                ))}
              </div>
            ) : null}

            <div className="ambient-focused-center">
              <div className={`ambient-orb ambient-session-orb ambient-orb-${realtimeStatus}`} aria-hidden="true" />
              <div className="ambient-focused-copy">
                <span className="status-pill ambient-focused-emphasis">{statusCopy.emphasis}</span>
                <strong>{statusCopy.title}</strong>
                <p>{statusCopy.description}</p>
              </div>
              <p className="ambient-focused-status">{statusLabel}</p>
              <p className="ambient-focused-time">{formatDuration(displayedElapsedSeconds)}</p>
              <p className="ambient-focused-support">
                {isTranscriptVisible ? 'Live transcript is visible.' : 'Live transcript stays optional while capture remains the focus.'}
              </p>
            </div>

            {error ? <div className="error-banner">{error}</div> : null}
          </section>

          <div className="ambient-control-bar" role="toolbar" aria-label="Session controls">
            {realtimeStatus === 'error' && !hasActiveVoiceSession ? (
              <button type="button" className="ambient-icon-btn" onClick={handleStartCapture} disabled={isBusy} aria-label="Retry" title="Retry">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
              </button>
            ) : null}
            <button
              type="button"
              className={`ambient-icon-btn${isTranscriptVisible ? ' active' : ''}`}
              onClick={() => setIsTranscriptVisible((current) => !current)}
              aria-label="Toggle captions"
              title="Captions"
            >
              <span style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '0.5px' }}>CC</span>
            </button>
            <button
              type="button"
              className={`ambient-icon-btn${isMuted ? ' muted' : ''}`}
              onClick={handleToggleMute}
              disabled={isBusy || !hasActiveVoiceSession || realtimeStatus === 'stopping' || realtimeStatus === 'stopped' || realtimeStatus === 'error'}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <rect x="9" y="1" width="6" height="12" rx="3" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
                {isMuted ? <line x1="1" y1="1" x2="23" y2="23" stroke="var(--danger)" strokeWidth="2.5" /> : null}
              </svg>
            </button>
            <button
              type="button"
              className="ambient-icon-btn end"
              onClick={handleStopCapture}
              disabled={isBusy || !encounterId || realtimeStatus === 'stopping' || realtimeStatus === 'stopped'}
              aria-label="End session"
              title="Stop capture"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </>
      ) : (
        <>
          <section className="hero-card ambient-hero-card">
            <p className="shell-eyebrow">Wulo Scribe</p>
            <h3>Capture the visit live</h3>
            <p>
              Start a focused recording session, keep the live screen calm, then let automatic processing prepare the final clinician review.
            </p>

            <div className="ambient-hero-center">
              <div className={`ambient-orb ambient-orb-${realtimeStatus}`} aria-hidden="true" />
              <div className="ambient-hero-copy">
                <strong>{statusCopy.title}</strong>
                <p>{statusCopy.description}</p>
                <p className="ambient-hero-note">The live transcript stays optional while capture remains the primary task.</p>
              </div>
              <div className="assistant-action-row ambient-primary-actions">
                <button type="button" className="primary-button" onClick={handleStartCapture} disabled={isBusy}>
                  {isBusy ? 'Starting...' : 'Start Wulo Scribe'}
                </button>
                <button type="button" className="secondary-button" onClick={() => navigate('/')}>
                  Back
                </button>
              </div>
            </div>

            <div className="chip-row ambient-calm-status-row">
              <span className="status-pill">Capture: {hasVoiceLive ? statusLabel : 'manual mode'}</span>
              <span className="status-pill subtle">Encounter: {encounterId ? 'active' : 'not started'}</span>
            </div>

            {error ? <div className="error-banner">{error}</div> : null}
            {!hasVoiceLive && voiceLiveUnavailableReason ? <div className="error-banner">{voiceLiveUnavailableReason}</div> : null}
          </section>

          <section className="surface-card ambient-workspace-card">
            <div className="card-heading-row">
              <div>
                <p className="section-label">Working transcript</p>
                <h4>Inspect the capture while it builds</h4>
              </div>
              {encounterId ? (
                <button type="button" className="secondary-button" onClick={handleSaveDraft} disabled={isBusy}>
                  Save capture
                </button>
              ) : null}
            </div>

            <div className="ambient-review-grid">
              <div className="status-block">
                <p className="section-label">Capture transcript</p>
                <textarea
                  className="text-area draft-area"
                  value={draftText}
                  onChange={(event) => setDraftText(event.target.value)}
                  placeholder="The capture transcript appears here while the visit is being recorded. Automatic processing prepares the final review after you stop."
                />
              </div>

              <div className="status-block">
                <p className="section-label">Supporting transcript segments</p>
                <div className="segment-list ambient-segment-list">
                  {transcriptSegments.length === 0 ? (
                    <p className="empty-state-inline">No transcript yet.</p>
                  ) : (
                    transcriptSegments.map((segment) => (
                      <article key={`${segment.timestamp}-${segment.text}`} className="segment-item">
                        <span>{segment.role}</span>
                        <p>{segment.text}</p>
                      </article>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>

          {!hasVoiceLive ? (
            <section className="surface-card">
              <div className="card-heading-row">
                <div>
                  <p className="section-label">Manual transcript</p>
                  <h4>Add text if live recording is not available</h4>
                </div>
              </div>

              <div className="ambient-composer">
                <label className="field-label" htmlFor="ambient-segment-role">
                  Segment role
                </label>
                <select
                  id="ambient-segment-role"
                  className="text-input"
                  value={segmentRole}
                  onChange={(event) => setSegmentRole(event.target.value)}
                >
                  <option value="clinician">Clinician</option>
                  <option value="patient">Patient</option>
                  <option value="speaker">Speaker</option>
                </select>

                <label className="field-label" htmlFor="ambient-segment-text">
                  Transcript segment
                </label>
                <textarea
                  id="ambient-segment-text"
                  className="text-area"
                  value={segmentText}
                  onChange={(event) => setSegmentText(event.target.value)}
                  placeholder="Add part of the conversation here so the final review has the right supporting transcript."
                />
                <button type="button" className="secondary-button" onClick={handleAppendSegment} disabled={isBusy}>
                  Add transcript text
                </button>
              </div>
            </section>
          ) : null}

          <section className="surface-card">
            <div className="card-heading-row">
              <div>
                <p className="section-label">Before you continue</p>
                <h4>How the capture flow ends</h4>
              </div>
            </div>

            <ul className="detail-list">
              <li>Start recording and let the note build.</li>
              <li>Stop when the visit ends.</li>
              <li>Automatic processing prepares the clinician-ready review package.</li>
              <li>Finish on the final review route.</li>
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
