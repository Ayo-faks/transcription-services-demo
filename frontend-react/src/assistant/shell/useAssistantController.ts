import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { useOperationalContext } from '../../assistant/context/OperationalContextProvider'
import { useAgentRuntime } from '../../assistant/runtime/AgentRuntimeProvider'
import { useAssistantTurnsStore } from '../../assistant/state/AssistantTurnsStore'
import { useAssistantTransport } from '../../app/providers/AssistantWorkspaceProvider'
import { useEncounterContext } from '../../assistant/context/EncounterContextProvider'
import {
  getProcessedJobId,
  hydrateEncounterPayload,
} from '../../assistant/transport/AssistantTransport'
import type {
  AmbientVoiceErrorCode,
  AmbientVoiceEvent,
  AmbientVoiceRealtimeStatus,
  AmbientVoiceSession,
  AmbientVoiceStopResult,
} from '../../assistant/transport/voiceLiveSession'
import { useGlobalKnowledge } from '../../assistant/tools/GlobalKnowledgeProvider'
import { useCurrentView } from '../../assistant/tools/CurrentViewProvider'
import { useAssistantSessionStore } from '../state/AssistantSessionStore'
import type { AssistantScope } from '../state/assistantTypes'
import type { EncounterContextResponse, EncounterResponse } from '../../shared/types/api'

interface UseAssistantControllerOptions {
  variant: 'docked' | 'expanded' | 'ambient'
  onClose?: () => void
}

function timestamp() {
  return new Date().toISOString()
}

function formatEncounterContextAnswer(response: EncounterContextResponse | null) {
  if (!response || response.items.length === 0) {
    return null
  }

  const excerpts = response.items.slice(0, 4).map((item) => {
    const preview = item.text.length > 140 ? `${item.text.slice(0, 137)}...` : item.text
    return `${item.title}: ${preview}`
  })

  const categorySummary = response.summary.categories.slice(0, 4).join(', ')
  return `Visit evidence${categorySummary ? ` [${categorySummary}]` : ''}: ${excerpts.join(' ')}`
}

export function useAssistantController({ variant, onClose }: UseAssistantControllerOptions) {
  const navigate = useNavigate()
  const transport = useAssistantTransport()
  const { activeAgent, syncAgentToMode } = useAgentRuntime()
  const {
    activeThreadId,
    threads,
    turns,
    ensureThread,
    applyEnvelope,
  } = useAssistantTurnsStore(useShallow((state) => ({
    activeThreadId: state.activeThreadId,
    threads: state.threads,
    turns: state.turns,
    ensureThread: state.ensureThread,
    applyEnvelope: state.applyEnvelope,
  })))
  const { view, queryView } = useCurrentView()
  const { queryGlobalKnowledge, isAvailable } = useGlobalKnowledge()
  const {
    data: encounterContext,
    error: encounterContextError,
    isLoading: isEncounterContextLoading,
    refreshEncounterContext,
    searchEncounterContext,
  } = useEncounterContext()
  const {
    operationalContext,
    actionPreviews,
    isLoadingOperationalContext,
    isLoadingActionPreviews,
    error: operationalContextError,
    refreshActionPreviews,
  } = useOperationalContext()
  const {
    encounterId,
    encounterStatus,
    draftVersion,
    draftText,
    draftSource,
    transcriptSegments,
    messages,
    error,
    isBusy,
    setEncounter,
    setDraftText,
    replaceTranscriptSegments,
    addMessage,
    setBusy,
    setError,
    setLastProcessedJobId,
    setMode,
  } = useAssistantSessionStore(useShallow((state) => ({
    encounterId: state.encounterId,
    encounterStatus: state.encounterStatus,
    draftVersion: state.draftVersion,
    draftText: state.draftText,
    draftSource: state.draftSource,
    transcriptSegments: state.transcriptSegments,
    messages: state.messages,
    error: state.error,
    isBusy: state.isBusy,
    setEncounter: state.setEncounter,
    setDraftText: state.setDraftText,
    replaceTranscriptSegments: state.replaceTranscriptSegments,
    addMessage: state.addMessage,
    setBusy: state.setBusy,
    setError: state.setError,
    setLastProcessedJobId: state.setLastProcessedJobId,
    setMode: state.setMode,
  })))

  const [segmentRole, setSegmentRole] = useState('clinician')
  const [segmentText, setSegmentText] = useState('')
  const [questionText, setQuestionText] = useState('')
  const [scope, setScope] = useState<AssistantScope>('local')
  const [realtimeStatus, setRealtimeStatus] = useState<AmbientVoiceRealtimeStatus>('idle')
  const [realtimeErrorCode, setRealtimeErrorCode] = useState<AmbientVoiceErrorCode | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const voiceSessionRef = useRef<AmbientVoiceSession | null>(null)
  const hasVoiceLive = transport.canUseVoiceLive()
  const voiceLiveUnavailableReason = transport.getVoiceLiveUnavailableReason()
  const currentRoute = view?.route || ''

  useEffect(() => {
    void currentRoute
    setError(null)
  }, [currentRoute, setError])

  const suggestedQuestions = useMemo(() => {
    if (currentRoute.startsWith('/jobs/')) {
      return [
        'What technical evidence supports this visit?',
        'Where can I inspect the transcript and FHIR payloads?',
        'Which entities and relations were extracted?',
        'Should I go back to final review from here?',
      ]
    }

    if (currentRoute.includes('/review')) {
      return [
        'What still needs review before I approve the final note?',
        'Which medication changes are ready?',
        'What follow-up should the patient receive?',
        'What evidence supports this final review?',
      ]
    }

    return [
      'How do I start this visit?',
      'Should I start Wulo Scribe or upload a recording instead?',
      'What will happen after intake?',
    ]
  }, [currentRoute])
  const questionPlaceholder = useMemo(() => {
    if (currentRoute.startsWith('/jobs/')) {
      return 'Ask about the technical payload, transcript evidence, extracted entities, or whether you should return to final review.'
    }

    if (currentRoute.includes('/review')) {
      return 'Ask whether the final note is ready for approval, what follow-up is ready, or where the supporting evidence appears.'
    }

    return 'Ask how to start capture, when to upload audio instead, or what happens after intake.'
  }, [currentRoute])
  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'user') || null,
    [messages],
  )

  useEffect(() => {
    if (draftSource === 'audio_transcription') {
      return
    }

    const autoDraft = transcriptSegments
      .filter((segment) => segment.is_final !== false)
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join('\n')

    if (autoDraft && autoDraft !== draftText) {
      setDraftText(autoDraft)
    }
  }, [draftSource, draftText, setDraftText, transcriptSegments])

  useEffect(() => {
    return () => {
      void voiceSessionRef.current?.abort('controller-unmount')
      voiceSessionRef.current = null
    }
  }, [])

  async function applyEncounterPayload(payload: EncounterResponse, options?: { skipContextRefresh?: boolean }) {
    setEncounter(hydrateEncounterPayload(payload))
    if (!options?.skipContextRefresh) {
      // Fire context refresh in background — don't block the caller
      void refreshEncounterContext(payload.encounter_id, { limit: 80 })
    }
    return payload
  }

  async function syncEncounterState(nextEncounterId: string, options?: { skipContextRefresh?: boolean }) {
    const payload = await transport.getEncounter(nextEncounterId)
    return applyEncounterPayload(payload, options)
  }

  async function ensureEncounter(options?: { skipContextRefresh?: boolean }) {
    if (encounterId) {
      // If encounter already exists, just return the stored state without re-fetching
      // when we're about to do more work (e.g. start capture) that will sync anyway.
      if (options?.skipContextRefresh) {
        return { encounter_id: encounterId } as EncounterResponse
      }
      return syncEncounterState(encounterId, options)
    }

    const payload = await transport.createEncounter()
    return applyEncounterPayload(payload, options)
  }

  async function runAction(action: () => Promise<void>) {
    setBusy(true)
    setError(null)

    try {
      await action()
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : 'Assistant action failed.'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  function mergeLiveTranscriptSegment(nextSegment: (typeof transcriptSegments)[number]) {
    if (!nextSegment.text.trim()) {
      return
    }

    const nextSegments = [...transcriptSegments]
    const hasInterimTail = nextSegments.length > 0 && nextSegments[nextSegments.length - 1].is_final === false

    if (nextSegment.is_final === false && hasInterimTail) {
      nextSegments[nextSegments.length - 1] = nextSegment
      replaceTranscriptSegments(nextSegments)
      return
    }

    if (nextSegment.is_final === false) {
      replaceTranscriptSegments([...nextSegments, nextSegment])
      return
    }

    replaceTranscriptSegments([...nextSegments.filter((segment) => segment.is_final !== false), nextSegment])
  }

  function handleVoiceEvent(event: AmbientVoiceEvent) {
    if (event.type === 'status') {
      setRealtimeStatus(event.status)
      if (event.status !== 'error') {
        setRealtimeErrorCode(null)
      }
      if (event.status === 'muted') {
        setIsMuted(true)
      } else if (event.status === 'recording' || event.status === 'stopped' || event.status === 'stopping' || event.status === 'idle') {
        setIsMuted(false)
      }
      return
    }

    if (event.type === 'transcript') {
      mergeLiveTranscriptSegment(event.segment)
      return
    }

    if (event.type === 'encounter-synced') {
      setEncounter(hydrateEncounterPayload(event.payload))
      void refreshEncounterContext(event.payload.encounter_id, { limit: 80 })
      return
    }

    if (event.type === 'system') {
      addMessage({ role: 'system', content: event.message })
      return
    }

    setRealtimeStatus('error')
    setRealtimeErrorCode(event.code)
    setError(event.message)
  }

  async function handleStartCapture() {
    await runAction(async () => {
      // Fast path: get or create encounter without blocking on context refresh
      const payload = await ensureEncounter({ skipContextRefresh: true })
      const shouldStartBackendCapture = !encounterId || encounterStatus !== 'capturing'

      setRealtimeErrorCode(null)
      setRealtimeStatus(hasVoiceLive ? 'connecting' : 'idle')

      // Start backend capture in background — don't block voice session
      if (shouldStartBackendCapture) {
        void transport.startCapture(payload.encounter_id)
      }

      if (hasVoiceLive) {
        const voiceSession = transport.createAmbientVoiceSession(payload.encounter_id, handleVoiceEvent)
        voiceSessionRef.current = voiceSession
        try {
          await voiceSession.start()
          setIsMuted(voiceSession.isMuted())
        } catch (voiceError) {
          voiceSessionRef.current = null
          setIsMuted(false)
          throw voiceError
        }
      } else {
        addMessage({
          role: 'system',
          content:
            voiceLiveUnavailableReason ||
            'Voice Live is not configured for this environment. You can still capture the visit manually and let automatic processing prepare final review.',
        })
      }
      addMessage({
        role: 'system',
        content: 'Visit capture started. Live transcript segments will stream into the shared transcript while automatic processing waits for capture to end.',
      })

      // Background sync — don't block the user
      void syncEncounterState(payload.encounter_id)
    })
  }

  async function handleAppendSegment() {
    const normalizedText = segmentText.trim()
    if (!normalizedText) {
      return
    }

    await runAction(async () => {
      const payload = await ensureEncounter()
      await transport.appendTranscriptSegments(payload.encounter_id, [
        {
          role: segmentRole,
          text: normalizedText,
          timestamp: timestamp(),
          is_final: true,
        },
      ])
      await syncEncounterState(payload.encounter_id)
      setSegmentText('')
    })
  }

  async function handleStopCapture() {
    if (!encounterId) {
      return
    }

    const backgroundEncounterId = encounterId

    async function finalizeStopHandoff(stopResult: AmbientVoiceStopResult) {
      if (stopResult.pendingFinalize) {
        try {
          const finalizeResult = await stopResult.pendingFinalize
          if (finalizeResult) {
            addMessage({
              role: 'system',
              content: `Diarized transcript ready. ${finalizeResult.speakerCount} speaker${finalizeResult.speakerCount === 1 ? '' : 's'} detected. Refresh final review to see the updated transcript evidence.`,
            })
            setEncounter(hydrateEncounterPayload(finalizeResult.payload))
            return
          }
        } catch {
          addMessage({
            role: 'system',
            content: 'Background audio processing encountered an issue. The captured transcript is still available.',
          })
          return
        }
      }

      if (stopResult.capturedAudio && stopResult.capturedAudio.size > 0) {
        try {
          const ingestResult = await transport.ingestCapturedAudio(backgroundEncounterId, stopResult.capturedAudio)
          addMessage({
            role: 'system',
            content: `Diarized transcript ready. ${ingestResult.speaker_count || 0} speaker${ingestResult.speaker_count === 1 ? '' : 's'} detected.`,
          })
          await syncEncounterState(backgroundEncounterId)
        } catch {
          addMessage({
            role: 'system',
            content: 'Background audio processing encountered an issue. The captured transcript is still available while final review continues.',
          })
        }
        return
      }

      try {
        const payload = await transport.stopCapture(backgroundEncounterId)
        if ('job_id' in payload && payload.job_id) {
          setLastProcessedJobId(payload.job_id)
        }

        if ('status' in payload) {
          setEncounter({
            encounterId: backgroundEncounterId,
            status: payload.status,
            processingStage: 'processing_stage' in payload ? payload.processing_stage ?? null : null,
            draftVersion,
            draftText,
            transcriptSegments,
            diarizedPhrases: [],
            speakerCount: 0,
            draftSource,
            reviewResult: null,
          })
        }
      } catch {
        addMessage({
          role: 'system',
          content: 'The background processing handoff took longer than expected. The review page will keep polling until the pipeline catches up.',
        })
      }
    }

    // Stop the voice session and mic first — bounded to 12s so the UI always progresses
    setBusy(true)
    setError(null)
    setRealtimeStatus('stopping')

    const STOP_TIMEOUT_MS = 12000
    const stopPromise = voiceSessionRef.current?.stop()
    if (stopPromise) {
      void stopPromise.then((stopResult) => {
        void finalizeStopHandoff(stopResult)
      }).catch(() => {
        addMessage({
          role: 'system',
          content: 'Background audio processing encountered an issue. The captured transcript is still available.',
        })
      })

      const finishedWithinTimeout = await Promise.race([
        stopPromise.then(() => true),
        new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), STOP_TIMEOUT_MS)),
      ])
      if (!finishedWithinTimeout) {
        console.warn('[handleStopCapture] voiceSession.stop() timed out after', STOP_TIMEOUT_MS, 'ms — proceeding to review')
      }
    }
    voiceSessionRef.current = null

    // Seed the review handoff immediately so the processing animation can start
    setEncounter({
      encounterId,
      status: 'processing',
      processingStage: 'queued',
      draftVersion,
      draftText,
      transcriptSegments,
      diarizedPhrases: [],
      speakerCount: 0,
      draftSource,
      reviewResult: null,
    })

    setIsMuted(false)
    setRealtimeStatus('stopped')
    setBusy(false)

    // Navigate BEFORE any finalize/ingest — clinician sees review page immediately
    navigate(`/encounters/${encounterId}/review`)
    onClose?.()

    addMessage({
      role: 'system',
      content: 'Capture stopped. Starting transcription and clinical processing now.',
    })

    // Start backend processing in the background once the voice stop handoff actually settles.
    if (!stopPromise) {
      void finalizeStopHandoff({
        capturedAudio: null,
        finalizedRemotely: false,
        speakerCount: null,
        pendingFinalize: null,
      })
    }
  }

  function handleToggleMute() {
    if (!voiceSessionRef.current) {
      return
    }

    setIsMuted(voiceSessionRef.current.toggleMute())
  }

  async function handleSaveDraft() {
    if (!encounterId) {
      return
    }

    await runAction(async () => {
      const payload = await transport.saveDraft(encounterId, draftText, draftVersion, transcriptSegments)
      await applyEncounterPayload(payload)
      addMessage({ role: 'system', content: 'Capture transcript saved. The latest transcript will flow into final review.' })
    })
  }

  async function handleFinalizeDraft() {
    if (!encounterId) {
      return
    }

    await runAction(async () => {
      const payload = await transport.finalizeDraft(encounterId, draftVersion)
      await applyEncounterPayload(payload)
      addMessage({ role: 'system', content: 'Capture transcript locked. Automatic processing can continue toward final review.' })
    })
  }

  async function handleProcessClinically() {
    if (!encounterId) {
      return
    }

    await runAction(async () => {
      const payload = await transport.processClinically(encounterId)
      const jobId = getProcessedJobId(payload)
      setLastProcessedJobId(jobId)
      addMessage({
        role: 'assistant',
        content: `Automatic processing started for encounter ${encounterId}. Opening the technical results page for job ${jobId}.`,
      })
      navigate(`/jobs/${jobId}`)
      onClose?.()
    })
  }

  async function submitAssistantQuestion(normalizedQuestion: string, activeScope: AssistantScope) {
    addMessage({ role: 'user', content: normalizedQuestion, scope: activeScope })

    if (activeScope === 'local' && encounterId) {
      const threadId = `thread:${encounterId}:${activeAgent.id}`
      ensureThread({
        threadId,
        agentId: activeAgent.id,
        title: `${activeAgent.title} thread`,
        contextSnapshotId: encounterContext?.context_version || encounterId,
        surfaceState: variant,
      })

      await runAction(async () => {
        await transport.streamAssistantQuery(
          encounterId,
          {
            question: normalizedQuestion,
            scope: activeScope,
            agentId: activeAgent.id,
          },
          (envelope) => {
            applyEnvelope(envelope)
          },
        )
      })
      return
    }

    if (activeScope === 'local') {
      const contextResponse = await searchEncounterContext(normalizedQuestion)
      const encounterAnswer = formatEncounterContextAnswer(contextResponse)

      if (encounterAnswer) {
        addMessage({ role: 'assistant', content: encounterAnswer, scope: 'local' })
        return
      }

      const answer = queryView(normalizedQuestion)
      addMessage({ role: 'assistant', content: answer, scope: 'local' })
      return
    }

    const answer = await queryGlobalKnowledge(normalizedQuestion)
    addMessage({ role: 'assistant', content: answer, scope: 'global' })
  }

  async function handleAskAssistant() {
    const normalizedQuestion = questionText.trim()
    if (!normalizedQuestion) {
      return
    }

    setQuestionText('')
    await submitAssistantQuestion(normalizedQuestion, scope)
  }

  async function handleAskSuggestedQuestion(question: string) {
    setScope('local')
    setQuestionText('')
    await submitAssistantQuestion(question, 'local')
  }

  async function handleRetryFailedTurn() {
    const retryQuestion = lastUserMessage?.content.trim()
    const retryScope = lastUserMessage?.scope || scope

    if (!retryQuestion || isBusy) {
      return
    }

    await submitAssistantQuestion(retryQuestion, retryScope)
  }

  async function handlePreviewAction(toolId?: string) {
    if (!encounterId) {
      return
    }

    await runAction(async () => {
      const previewResponse = await refreshActionPreviews(encounterId, toolId)
      const preview = previewResponse?.previews[0]
      if (!preview) {
        addMessage({
          role: 'system',
          content: `No preview is available for ${toolId || 'the requested action'} in the current encounter state.`,
        })
        return
      }

      addMessage({
        role: 'assistant',
        content: `Output preview ready: ${preview.title}. Approval requirements: ${preview.approvalRequirements.join(', ')}.`,
      })
    })
  }

  function handleSwitchMode(mode: 'docked' | 'expanded' | 'ambient') {
    syncAgentToMode(mode)
    setMode(mode)
  }

  const activeThread = activeThreadId ? threads[activeThreadId] || null : null
  const streamedTurns = activeThread ? activeThread.turnIds.map((turnId) => turns[turnId]).filter(Boolean) : []
  const lastFailedTurn = [...streamedTurns].reverse().find((turn) => turn.status === 'failed') || null

  return {
    shellClassName: `assistant-surface assistant-surface-${variant}`,
    view,
    encounterId,
    encounterStatus,
    draftVersion,
    draftText,
    transcriptSegments,
    messages,
    error,
    isBusy,
    activeAgent,
    setDraftText,
    segmentRole,
    setSegmentRole,
    segmentText,
    setSegmentText,
    questionText,
    setQuestionText,
    questionPlaceholder,
    scope,
    setScope,
    suggestedQuestions,
    realtimeStatus,
    realtimeErrorCode,
    isMuted,
    hasActiveVoiceSession: Boolean(voiceSessionRef.current),
    hasVoiceLive,
    voiceLiveUnavailableReason,
    isAvailable,
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
    handleAskAssistant,
    handleAskSuggestedQuestion,
    handleRetryFailedTurn,
    handlePreviewAction,
    handleSwitchMode,
    handleStartCapture,
    handleToggleMute,
    handleStopCapture,
    handleSaveDraft,
    handleFinalizeDraft,
    handleProcessClinically,
    handleAppendSegment,
    navigate,
    onClose,
  }
}