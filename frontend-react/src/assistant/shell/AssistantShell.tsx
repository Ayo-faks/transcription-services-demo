import { useAssistantController } from './useAssistantController'
import type { AgentCitation, EncounterContextItem } from '../../shared/types/api'

interface AssistantShellProps {
  variant: 'docked' | 'expanded' | 'ambient'
  onClose?: () => void
  agentTitle?: string
  agentId?: string
}

function getCitationTitle(citation: AgentCitation | EncounterContextItem) {
  return ('title' in citation && citation.title) || 'Clinical context'
}

function getCitationExcerpt(citation: AgentCitation | EncounterContextItem) {
  const text = 'text' in citation ? citation.text : ''
  if (!text) {
    return null
  }

  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

function getCitationProvenanceLabel(citation: AgentCitation | EncounterContextItem) {
  const provenance = citation.provenance?.[0]
  if (!provenance) {
    return 'No provenance attached'
  }

  return `${provenance.source_type}: ${provenance.source_id}`
}

export function AssistantShell({ variant, onClose, agentTitle }: AssistantShellProps) {
  const {
    shellClassName,
    view,
    encounterId,
    encounterStatus,
    transcriptSegments,
    messages,
    error,
    isBusy,
    questionText,
    setQuestionText,
    questionPlaceholder,
    scope,
    setScope,
    suggestedQuestions,
    realtimeStatus,
    isMuted,
    hasActiveVoiceSession,
    hasVoiceLive,
    voiceLiveUnavailableReason,
    encounterContext,
    encounterContextError,
    isEncounterContextLoading,
    operationalContext,
    operationalContextError,
    isLoadingOperationalContext,
    actionPreviews,
    isLoadingActionPreviews,
    activeThread,
    streamedTurns,
    lastFailedTurn,
    activeAgent,
    handleAskAssistant,
    handleAskSuggestedQuestion,
    handleRetryFailedTurn,
    handlePreviewAction,
    handleSwitchMode,
    handleStartCapture,
    handleToggleMute,
    handleStopCapture,
    navigate,
    onClose: resolvedOnClose,
  } = useAssistantController({ variant, onClose })

  const assistantProfile = agentTitle || activeAgent.title
  const surfaceTitle = variant === 'ambient' ? 'Live capture helper' : 'Visit helper'
  const surfaceSubtitle = view
    ? `${view.title} is active. Use ${assistantProfile} only when you need clarification, supporting evidence, or the next action.`
    : `Open ${assistantProfile} only when you need clarification on the current workflow step.`

  return (
    <section className={shellClassName}>
      <header className="assistant-surface-header">
        <div>
          <p className="shell-eyebrow">Assistant</p>
          <h3>{surfaceTitle}</h3>
          <p className="assistant-subtitle">{surfaceSubtitle}</p>
        </div>

        <div className="assistant-surface-actions">
          <div className="mode-switcher assistant-mode-switcher">
            {variant !== 'docked' ? (
              <button type="button" className="mode-button" onClick={() => handleSwitchMode('docked')}>
                Compact helper
              </button>
            ) : null}
            {variant !== 'expanded' ? (
              <button type="button" className="mode-button" onClick={() => handleSwitchMode('expanded')}>
                Open workspace
              </button>
            ) : null}
            {hasVoiceLive && variant !== 'ambient' ? (
              <button type="button" className="mode-button" onClick={() => handleSwitchMode('ambient')}>
                Open live surface
              </button>
            ) : null}
          </div>
          {resolvedOnClose ? (
            <button
              type="button"
              className="assistant-close-button"
              onClick={resolvedOnClose}
              aria-label="Hide helper"
              title="Hide helper"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
                <path d="M6.7 5.3a1 1 0 0 1 1.4 0L12 9.17l3.9-3.88a1 1 0 1 1 1.4 1.42L13.42 10.6l3.88 3.9a1 1 0 0 1-1.42 1.4L12 12.02l-3.9 3.88a1 1 0 0 1-1.4-1.42l3.88-3.9-3.88-3.9a1 1 0 0 1 0-1.4Z" fill="currentColor" />
              </svg>
            </button>
          ) : null}
        </div>
      </header>

      <div className="assistant-status-bar">
        <span className="status-pill subtle">Step: {view?.title || 'No step selected'}</span>
        <span className="status-pill">Visit: {encounterStatus || 'not started'}</span>
        <span className="status-pill subtle">Capture: {hasVoiceLive ? realtimeStatus : 'manual'}</span>
        <span className="status-pill subtle">Evidence: {encounterContext?.summary.returned_items || 0}</span>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="assistant-grid">
        <section className="surface-card">
          <div className="card-heading-row">
            <div>
              <p className="section-label">Current step</p>
              <h4>Ask about this visit</h4>
            </div>
            <span className="status-pill subtle">On-demand helper</span>
          </div>

          <div className="assistant-query-row">
            <div className="scope-toggle">
              <button
                type="button"
                className={scope === 'local' ? 'scope-button active' : 'scope-button'}
                onClick={() => setScope('local')}
              >
                Current visit
              </button>
              <button
                type="button"
                className={scope === 'global' ? 'scope-button active' : 'scope-button'}
                onClick={() => setScope('global')}
              >
                Shared knowledge
              </button>
            </div>
            <textarea
              className="text-area compact"
              value={questionText}
              onChange={(event) => setQuestionText(event.target.value)}
              placeholder={questionPlaceholder}
            />
            <button type="button" className="primary-button" onClick={handleAskAssistant} disabled={isBusy}>
              Ask assistant
            </button>
          </div>

          <div className="chip-row">
            {suggestedQuestions.map((question) => (
                <button key={question} type="button" className="secondary-button" onClick={() => handleAskSuggestedQuestion(question)} disabled={isBusy}>
                  {question}
                </button>
            ))}
          </div>

          <div className="current-view-panel">
            <p className="section-label">View summary</p>
            <p>{view?.summary || 'The active route has not registered structured facts yet.'}</p>
          </div>

          <div className="current-view-panel">
            <p className="section-label">Visit evidence context</p>
            {encounterContext ? (
              <p>
                {encounterContext.summary.total_items} evidence items loaded for the current visit.
                {encounterContext.summary.categories.length > 0
                  ? ` Categories: ${encounterContext.summary.categories.slice(0, 6).join(', ')}.`
                  : ''}
              </p>
            ) : encounterId ? (
              <p>{isEncounterContextLoading ? 'Loading visit evidence context...' : 'Visit evidence context is not available yet.'}</p>
            ) : (
              <p>Start or open a visit to load supporting clinical context.</p>
            )}
            {encounterContextError ? <p>{encounterContextError}</p> : null}
          </div>

          <div className="current-view-panel">
            <p className="section-label">Outputs and follow-up context</p>
            {operationalContext ? (
              <div className="detail-list">
                <p>Eligibility: {operationalContext.eligibility.status}</p>
                <p>Plan: {operationalContext.scheme_qualification.plan_name}</p>
                <p>
                  Treatments: {operationalContext.treatment_lookup.results.slice(0, 3).map((item) => item.title).join(', ')}
                </p>
                <p>
                  Communication channels: {operationalContext.communication_options.results.map((item) => item.channel).join(', ')}
                </p>
              </div>
            ) : encounterId ? (
              <p>{isLoadingOperationalContext ? 'Loading output preview context...' : 'Output preview context is not available yet.'}</p>
            ) : (
              <p>Start or open a visit to load follow-up and admin preview context.</p>
            )}
            {operationalContextError ? <p>{operationalContextError}</p> : null}
          </div>

          <div className="message-stream">
            {activeThread ? (
              <div className="current-view-panel">
                <p className="section-label">Active thread</p>
                <p>{activeThread.title}</p>
              </div>
            ) : null}
            {streamedTurns.map((turn) => (
              <article key={turn.id} className="message-bubble message-assistant">
                <span className="message-role">assistant-turn</span>
                <p>{turn.parts.map((part) => part.text).join(' ') || turn.summary || 'Streaming response pending...'}</p>
                {turn.summary ? <p>{turn.summary}</p> : null}
                {turn.status === 'failed' ? (
                  <div className="retry-banner assistant-turn-retry">
                    <div className="error-banner">{turn.error || 'The assistant could not finish this answer.'}</div>
                    <button
                      type="button"
                      className="secondary-button retry-button"
                      onClick={handleRetryFailedTurn}
                      disabled={isBusy || lastFailedTurn?.id !== turn.id}
                    >
                      Try again
                    </button>
                  </div>
                ) : null}
                {turn.toolEvents.length > 0 ? (
                  <p>Tools: {turn.toolEvents.map((event) => `${event.toolId}:${event.status}`).join(', ')}</p>
                ) : null}
                {turn.citations.length > 0 ? (
                  <div className="detail-list">
                    <p className="section-label">Citations</p>
                    {turn.citations.map((citation, index) => (
                      <div key={`${turn.id}-citation-${index}`} className="current-view-panel">
                        <p>
                          <strong>{getCitationTitle(citation)}</strong>
                        </p>
                        <p>
                          Source: {citation.source || 'encounter'}
                          {citation.kind ? ` | Type: ${citation.kind}` : ''}
                          {citation.category ? ` | Category: ${citation.category}` : ''}
                        </p>
                        <p>Provenance: {getCitationProvenanceLabel(citation)}</p>
                        {getCitationExcerpt(citation) ? <p>{getCitationExcerpt(citation)}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
            {messages.map((message) => (
              <article key={message.id} className={`message-bubble message-${message.role}`}>
                <span className="message-role">{message.role}</span>
                <p>{message.content}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="surface-card">
          <div className="card-heading-row">
            <div>
              <p className="section-label">Quick actions</p>
              <h4>Open the right surface when you need it</h4>
            </div>
            <span className="status-pill subtle">Workflow shortcuts</span>
          </div>

          <div className="assistant-action-row">
            <button type="button" className="primary-button" onClick={handleStartCapture} disabled={isBusy}>
              Start live capture
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={handleToggleMute}
              disabled={!hasActiveVoiceSession || isBusy}
            >
              {isMuted ? 'Unmute' : 'Mute'} microphone
            </button>
            <button type="button" className="secondary-button" onClick={handleStopCapture} disabled={isBusy || !encounterId}>
              Stop capture
            </button>
            {encounterId ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => navigate(`/encounters/${encounterId}/review`)}
              >
                Open final review
              </button>
            ) : null}
          </div>

          <div className="status-block">
            <p className="section-label">Capture status</p>
            <p>
              {hasVoiceLive
                ? `Voice capture is currently ${realtimeStatus}.`
                : voiceLiveUnavailableReason || 'Live voice is not configured, so this workflow stays in manual transcript mode.'}
            </p>
          </div>

          <div className="status-block">
            <p className="section-label">Output drafts</p>
            <div className="assistant-action-row">
              <button type="button" className="secondary-button" onClick={() => handlePreviewAction('patient_follow_up_email')} disabled={isBusy || !encounterId}>
                Preview follow-up
              </button>
              <button type="button" className="secondary-button" onClick={() => handlePreviewAction('treatment_request')} disabled={isBusy || !encounterId}>
                Preview treatment
              </button>
              <button type="button" className="secondary-button" onClick={() => handlePreviewAction('prior_auth_packet')} disabled={isBusy || !encounterId}>
                Preview admin packet
              </button>
            </div>
            {actionPreviews ? (
              <div className="detail-list">
                {actionPreviews.previews.slice(0, 3).map((preview) => (
                  <p key={preview.actionId}>
                    {preview.title}: {preview.summary} Idempotency: {preview.idempotencyKey}
                  </p>
                ))}
              </div>
            ) : encounterId ? (
              <p>{isLoadingActionPreviews ? 'Loading preview-only output drafts...' : 'No output drafts loaded yet.'}</p>
            ) : null}
          </div>

          <div className="status-block">
            <p className="section-label">Supporting transcript</p>
            <div className="segment-list">
              {transcriptSegments.length === 0 ? (
                <p className="empty-state-inline">No transcript segments captured yet.</p>
              ) : (
                transcriptSegments.slice(-8).map((segment) => (
                  <article key={`${segment.timestamp}-${segment.text}`} className="segment-item">
                    <span>{segment.role}</span>
                    <p>{segment.text}</p>
                  </article>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}