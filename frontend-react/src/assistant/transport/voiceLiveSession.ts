import type { VoiceLiveRuntimeConfig } from '../../app/providers/RuntimeConfigProvider'
import { encountersApi } from '../../api/encountersApi'
import { buildApiUrl } from '../../api/client'
import type { EncounterResponse, EncounterSegment } from '../../shared/types/api'
import { BrowserAudioCapture, BrowserAudioCaptureError, type BrowserAudioChunk } from './browserAudioCapture'

const SESSION_START_TIMEOUT_MS = 25000
const GATEWAY_PREFLIGHT_TIMEOUT_MS = 5000
const STOP_TRANSCRIPT_DRAIN_MS = 300
const STOP_FLUSH_TIMEOUT_MS = 5000
const DEBUG_EVENT_LIMIT = 250
const BACKEND_UPLOAD_BATCH_SAMPLES = 12000
const SESSION_START_RETRY_DELAY_MS = 2000
const SESSION_START_MAX_ATTEMPTS = 3

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => {
      window.setTimeout(() => {
        console.warn(`[AmbientVoiceDebug] ${label} timed out after ${ms}ms — proceeding`)
        resolve(undefined)
      }, ms)
    }),
  ])
}

export type AmbientVoiceRealtimeStatus =
  | 'idle'
  | 'requesting-microphone'
  | 'connecting'
  | 'recording'
  | 'muted'
  | 'stopping'
  | 'stopped'
  | 'error'

export type AmbientVoiceErrorCode =
  | 'microphone-denied'
  | 'microphone-unavailable'
  | 'worklet-load-failure'
  | 'gateway-timeout'
  | 'gateway-connection-failure'
  | 'gateway-unreachable'
  | 'session-start-failure'
  | 'websocket-disconnected'

export type AmbientVoiceEvent =
  | { type: 'status'; status: AmbientVoiceRealtimeStatus }
  | { type: 'transcript'; segment: EncounterSegment }
  | { type: 'encounter-synced'; payload: EncounterResponse }
  | { type: 'system'; message: string }
  | { type: 'error'; code: AmbientVoiceErrorCode; message: string }

export interface AmbientVoiceStopResult {
  capturedAudio: Blob | null
  finalizedRemotely: boolean
  speakerCount: number | null
  /** Resolves when the background finalize completes (diarized draft ready). */
  pendingFinalize: Promise<{ speakerCount: number; payload: EncounterResponse } | null> | null
}

class AmbientVoiceSessionError extends Error {
  readonly code: AmbientVoiceErrorCode

  constructor(code: AmbientVoiceErrorCode, message: string) {
    super(message)
    this.name = 'AmbientVoiceSessionError'
    this.code = code
  }
}

interface CreateAmbientVoiceSessionOptions {
  apiBaseUrl: string
  encounterId: string
  config: VoiceLiveRuntimeConfig
  onEvent: (event: AmbientVoiceEvent) => void
}

function buildAssistantWsUrl(config: VoiceLiveRuntimeConfig, clientId: string, sessionToken: string) {
  let resolvedUrl = ''

  if (config.wsUrl) {
    if (config.wsUrl.includes('{clientId}')) {
      resolvedUrl = config.wsUrl.replace('{clientId}', clientId)
    } else if (config.wsUrl.endsWith('/ws')) {
      resolvedUrl = `${config.wsUrl}/${clientId}`
    } else {
      resolvedUrl = config.wsUrl
    }
  }

  if (!resolvedUrl) {
    if (!config.gatewayBaseUrl) {
      return ''
    }

    const baseUrl = new URL(config.gatewayBaseUrl, window.location.origin)
    const protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:'
    const path = config.wsPath.endsWith('/') ? `${config.wsPath}${clientId}` : `${config.wsPath}/${clientId}`
    resolvedUrl = `${protocol}//${baseUrl.host}${path}`
  }

  const url = new URL(resolvedUrl, window.location.origin)
  url.searchParams.set('session_token', sessionToken)
  return url.toString()
}

function getAssistantStartPayload(config: VoiceLiveRuntimeConfig) {
  return {
    type: 'start_session',
    mode: config.mode,
    model: config.model,
    voice_type: config.voiceType,
    voice: config.voice,
    transcribe_model: config.transcribeModel,
    input_language: config.inputLanguage,
    instructions: config.instructions,
    proactive_greeting: false,
    interim_response: false,
    noise_reduction: true,
    echo_cancellation: true,
  }
}

function generateClientId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID()
  }

  return `assistant-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

type AmbientDebugEvent = {
  timestamp: string
  stage: string
  details?: Record<string, unknown>
}

declare global {
  interface Window {
    __ambientVoiceDebug?: {
      events: AmbientDebugEvent[]
      sessionId?: string
      reset?: () => void
    }
  }
}

export class AmbientVoiceSession {
  private readonly apiBaseUrl: string
  private readonly encounterId: string
  private readonly config: VoiceLiveRuntimeConfig
  private readonly onEvent: (event: AmbientVoiceEvent) => void
  private readonly audioCapture = new BrowserAudioCapture()
  private socket: WebSocket | null = null
  private pendingSegments: EncounterSegment[] = []
  private persistTimer: number | null = null
  private stopped = false
  private sessionStarted = false
  private currentStatus: AmbientVoiceRealtimeStatus = 'idle'
  private transcriptCount = 0
  private audioChunkCount = 0
  private lastTranscriptAt = 0
  private audioUploadSessionId: string | null = null
  private uploadBatchSequence = 0
  private uploadBufferedChunks: Int16Array[] = []
  private uploadBufferedSampleCount = 0
  private uploadChain: Promise<void> = Promise.resolve()
  private readonly handlePageHide = () => {
    if (!this.audioUploadSessionId || this.stopped) {
      return
    }

    this.abortAudioUploadSessionWithBeacon(this.audioUploadSessionId)
  }
  private readonly debugSessionId = generateClientId()

  constructor(options: CreateAmbientVoiceSessionOptions) {
    this.apiBaseUrl = options.apiBaseUrl
    this.encounterId = options.encounterId
    this.config = options.config
    this.onEvent = options.onEvent
  }

  isConfigured() {
    return Boolean(this.config.wsUrl || this.config.gatewayBaseUrl)
  }

  isMuted() {
    return this.audioCapture.isMuted()
  }

  toggleMute() {
    const nextMuted = this.audioCapture.toggleMute()
    this.setStatus(nextMuted ? 'muted' : 'recording')
    return nextMuted
  }

  async start() {
    if (!this.isConfigured()) {
      this.onEvent({
        type: 'system',
        message:
          'Voice Live gateway is not configured in runtime config. Ambient review still works, but live microphone transport is unavailable.',
      })
      return
    }

    const clientId = generateClientId()
    this.stopped = false
    this.sessionStarted = false
    this.transcriptCount = 0
    this.audioChunkCount = 0
    this.lastTranscriptAt = 0
    this.audioUploadSessionId = null
    this.uploadBatchSequence = 0
    this.uploadBufferedChunks = []
    this.uploadBufferedSampleCount = 0
    this.uploadChain = Promise.resolve()
    this.logDebug('session-start', { encounterId: this.encounterId, clientId, transcribeModel: this.config.transcribeModel, inputLanguage: this.config.inputLanguage })
    this.setStatus('connecting')

    try {
      await this.preflightGateway()
      const voiceSession = await encountersApi.createVoiceSession(this.apiBaseUrl, this.encounterId)
      const wsUrl = buildAssistantWsUrl(this.config, clientId, voiceSession.session_token)
      this.logDebug('voice-session-created', {
        encounterId: this.encounterId,
        expiresAt: voiceSession.expires_at,
      })
      await this.connectSocketWithRetry(wsUrl)
      await this.startBackendAudioUploadSession()
      this.setStatus('requesting-microphone')
      await this.audioCapture.start((chunk) => {
        this.handleCapturedAudioChunk(chunk)
      })
      this.logDebug('microphone-started')
      this.setStatus(this.audioCapture.isMuted() ? 'muted' : 'recording')
    } catch (error) {
      if (error instanceof BrowserAudioCaptureError) {
        this.setStatus('error')
        this.onEvent({ type: 'error', code: error.code, message: error.message })
      } else if (error instanceof AmbientVoiceSessionError) {
        this.setStatus('error')
        this.onEvent({ type: 'error', code: error.code, message: error.message })
      }

      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.close()
      }
      this.socket = null
      await this.abortAudioUploadSession('session-start-failure')
      await this.audioCapture.stop({ discardCapturedAudio: true })
      this.logDebug('session-start-failed', { error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  async abort(reason = 'capture-aborted') {
    this.stopped = true
    this.sessionStarted = false
    this.logDebug('abort-requested', { reason })

    if (this.persistTimer) {
      window.clearTimeout(this.persistTimer)
      this.persistTimer = null
    }

    this.pendingSegments = []
    this.uploadBufferedChunks = []
    this.uploadBufferedSampleCount = 0

    await this.audioCapture.stop({ discardCapturedAudio: true })

    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.close()
    }
    this.socket = null

    await this.abortAudioUploadSession(reason)
    this.setStatus('stopped')
  }

  async stop(): Promise<AmbientVoiceStopResult> {
    this.stopped = true
    this.sessionStarted = false
    this.setStatus('stopping')
    this.logDebug('stop-requested', {
      pendingSegments: this.pendingSegments.length,
      transcriptCount: this.transcriptCount,
      audioChunkCount: this.audioChunkCount,
    })

    await this.audioCapture.stop()
    let capturedAudio = this.audioCapture.takeCapturedWavBlob()
    const speakerCount: number | null = null
    this.logDebug('captured-audio-prepared', { bytes: capturedAudio?.size || 0 })
    this.logDebug('microphone-stopped')

    await withTimeout(
      this.flushAudioUploadBatch({ force: true }),
      STOP_FLUSH_TIMEOUT_MS,
      'flushAudioUploadBatch',
    )
    await withTimeout(
      this.uploadChain.catch(() => undefined),
      STOP_FLUSH_TIMEOUT_MS,
      'uploadChain',
    )

    const drainStartedAt = Date.now()
    await new Promise((resolve) => window.setTimeout(resolve, STOP_TRANSCRIPT_DRAIN_MS))
    this.logDebug('stop-drain-finished', {
      waitedMs: Date.now() - drainStartedAt,
      msSinceTranscript: this.lastTranscriptAt ? Date.now() - this.lastTranscriptAt : null,
    })

    if (this.persistTimer) {
      window.clearTimeout(this.persistTimer)
      this.persistTimer = null
    }

    await withTimeout(
      this.flushPendingSegments(),
      STOP_FLUSH_TIMEOUT_MS,
      'flushPendingSegments',
    )

    if (this.socket?.readyState === WebSocket.OPEN) {
      this.logDebug('stop-session-sent')
      this.socket.send(JSON.stringify({ type: 'stop_session' }))
    }
    this.socket?.close()
    this.socket = null
    this.unregisterAbortLifecycleHandlers()

    let pendingFinalize: AmbientVoiceStopResult['pendingFinalize'] = null

    if (this.audioUploadSessionId) {
      const sessionIdToFinalize = this.audioUploadSessionId
      this.audioUploadSessionId = null
      capturedAudio = null

      pendingFinalize = (async () => {
        try {
          const finalizeResult = await encountersApi.finalizeAudioUploadSession(this.apiBaseUrl, this.encounterId, sessionIdToFinalize)
          const resultSpeakerCount = finalizeResult.speaker_count || 0
          this.logDebug('backend-audio-session-finalized', {
            sessionId: sessionIdToFinalize,
            speakerCount: resultSpeakerCount,
            draftVersion: finalizeResult.draft_version,
          })
          const payload = await encountersApi.get(this.apiBaseUrl, this.encounterId)
          this.onEvent({ type: 'encounter-synced', payload })
          return { speakerCount: resultSpeakerCount, payload }
        } catch (error) {
          this.logDebug('backend-audio-session-finalize-failed', {
            error: error instanceof Error ? error.message : String(error),
          })
          this.onEvent({
            type: 'system',
            message: 'Backend audio finalize is still running. The diarized draft will appear when ready.',
          })
          return null
        }
      })()
    }

    this.setStatus('stopped')
    return { capturedAudio, finalizedRemotely: false, speakerCount, pendingFinalize }
  }

  private setStatus(status: AmbientVoiceRealtimeStatus) {
    this.currentStatus = status
    this.logDebug('status', { status })
    this.onEvent({ type: 'status', status })
  }

  private async preflightGateway() {
    const baseUrl = this.config.gatewayBaseUrl || this.config.wsUrl
    if (!baseUrl) {
      return
    }

    const httpUrl = baseUrl.replace(/^wss?:\/\//, (m) => (m === 'wss://' ? 'https://' : 'http://'))
    try {
      await fetch(httpUrl, {
        method: 'HEAD',
        mode: 'no-cors',
        signal: AbortSignal.timeout(GATEWAY_PREFLIGHT_TIMEOUT_MS),
      })
      this.logDebug('gateway-preflight-ok')
    } catch {
      // Some gateways do not answer a simple HTTP HEAD probe even when the
      // websocket endpoint is healthy. Treat this as advisory and let the real
      // websocket handshake determine availability.
      this.logDebug('gateway-preflight-failed-nonblocking', { url: httpUrl })
    }
  }

  private async connectSocketWithRetry(wsUrl: string) {
    let lastError: unknown = null

    for (let attempt = 1; attempt <= SESSION_START_MAX_ATTEMPTS; attempt += 1) {
      try {
        this.logDebug('websocket-handshake-attempt', {
          attempt,
          maxAttempts: SESSION_START_MAX_ATTEMPTS,
          timeoutMs: SESSION_START_TIMEOUT_MS,
        })
        await this.connectSocket(wsUrl)
        return
      } catch (error) {
        lastError = error
        const isRetryable =
          error instanceof AmbientVoiceSessionError
          && (error.code === 'gateway-timeout' || error.code === 'gateway-connection-failure')

        this.logDebug('websocket-handshake-attempt-failed', {
          attempt,
          retryable: isRetryable,
          error: error instanceof Error ? error.message : String(error),
        })

        if (!isRetryable || attempt >= SESSION_START_MAX_ATTEMPTS) {
          throw error
        }

        this.onEvent({
          type: 'system',
          message: 'The live gateway is taking longer than usual to warm up. Retrying the recording session…',
        })

        if (this.socket) {
          try {
            this.socket.close()
          } catch {
            // Ignore cleanup failures before retrying.
          }
        }
        this.socket = null
        this.sessionStarted = false
        await new Promise((resolve) => window.setTimeout(resolve, SESSION_START_RETRY_DELAY_MS))
      }
    }

    throw lastError
  }

  private async connectSocket(wsUrl: string) {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const ws = new WebSocket(wsUrl)
      this.socket = ws
      this.logDebug('websocket-created', { readyState: ws.readyState })

      const settle = (callback: () => void) => {
        if (settled) {
          return
        }

        settled = true
        callback()
      }

      const handshakeTimer = window.setTimeout(() => {
        settle(() => {
          ws.close()
          reject(new AmbientVoiceSessionError('gateway-timeout', 'The live gateway took too long to start the recording session.'))
        })
      }, SESSION_START_TIMEOUT_MS)

      const finishHandshake = (callback: () => void) => {
        window.clearTimeout(handshakeTimer)
        settle(callback)
      }

      ws.onopen = () => {
        this.logDebug('websocket-open')
        ws.send(JSON.stringify(getAssistantStartPayload(this.config)))
        this.logDebug('start-session-sent', {
          mode: this.config.mode,
          model: this.config.model,
          transcribeModel: this.config.transcribeModel,
          inputLanguage: this.config.inputLanguage,
        })
      }

      ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data) as Record<string, unknown>
          this.logDebug('server-message', {
            type: typeof message.type === 'string' ? message.type : 'unknown',
            state: typeof message.state === 'string' ? message.state : undefined,
            role: typeof message.role === 'string' ? message.role : undefined,
          })
          switch (message.type) {
            case 'session_started': {
              this.sessionStarted = true
              finishHandshake(resolve)
              break
            }
            case 'transcript': {
              if (message.role !== 'user') {
                break
              }

              const segment: EncounterSegment = {
                role: 'speaker',
                text: String(message.text || ''),
                timestamp: new Date().toISOString(),
                is_final: Boolean(message.isFinal ?? message.is_final ?? true),
              }
              this.transcriptCount += 1
              this.lastTranscriptAt = Date.now()
              this.logDebug('transcript-received', {
                count: this.transcriptCount,
                textLength: segment.text.length,
                isFinal: segment.is_final,
                role: message.role,
              })
              this.onEvent({ type: 'transcript', segment })

              if (segment.is_final && segment.text.trim()) {
                this.queueSegmentPersistence(segment)
              }
              break
            }
            case 'status': {
              if (message.state === 'listening' && !this.sessionStarted) {
                this.sessionStarted = true
                finishHandshake(resolve)
              }

              if (message.state === 'listening' && this.currentStatus !== 'muted') {
                this.setStatus('recording')
              }
              break
            }
            case 'error': {
              const messageText = String(message.message || 'Voice session error')
              finishHandshake(() => reject(new AmbientVoiceSessionError('session-start-failure', messageText)))
              break
            }
            case 'session_stopped': {
              if (!this.stopped) {
                this.setStatus('stopped')
              }
              break
            }
            default:
              break
          }
        } catch (error) {
          finishHandshake(() => reject(error))
        }
      }

      ws.onerror = () => {
        this.logDebug('websocket-error')
        finishHandshake(() => {
          reject(new AmbientVoiceSessionError('gateway-connection-failure', 'Unable to connect to the live gateway for Wulo Scribe.'))
        })
      }

      ws.onclose = () => {
        window.clearTimeout(handshakeTimer)
        this.logDebug('websocket-closed', { settled, stopped: this.stopped, sessionStarted: this.sessionStarted })

        if (!settled && !this.stopped) {
          settled = true
          reject(new AmbientVoiceSessionError('gateway-connection-failure', 'The live gateway connection closed before the session was ready.'))
          return
        }

        if (!this.stopped && this.sessionStarted) {
          this.sessionStarted = false
          this.setStatus('error')
          this.onEvent({
            type: 'error',
            code: 'websocket-disconnected',
            message: 'The live gateway disconnected during recording. Review the captured draft before deciding whether to reconnect.',
          })
          this.onEvent({
            type: 'system',
            message: 'The live voice connection ended unexpectedly. Review the captured draft or reconnect to continue.',
          })
        }
      }
    })
  }

  private queueSegmentPersistence(segment: EncounterSegment) {
    this.pendingSegments.push(segment)
    this.logDebug('segment-queued', { pendingSegments: this.pendingSegments.length, textLength: segment.text.length })

    if (this.persistTimer) {
      window.clearTimeout(this.persistTimer)
    }

    this.persistTimer = window.setTimeout(() => {
      void this.flushPendingSegments()
    }, 600)
  }

  private async flushPendingSegments() {
    if (this.pendingSegments.length === 0) {
      this.logDebug('segment-flush-skipped')
      return
    }

    const segments = [...this.pendingSegments]
    this.pendingSegments = []
    this.logDebug('segment-flush-start', { count: segments.length })
    const payload = await encountersApi.appendSegments(this.apiBaseUrl, this.encounterId, segments)
    this.logDebug('segment-flush-complete', { count: segments.length, encounterId: payload.encounter_id })
    this.onEvent({ type: 'encounter-synced', payload })
  }

  private handleCapturedAudioChunk(chunk: BrowserAudioChunk) {
    if (this.sessionStarted && this.socket?.readyState === WebSocket.OPEN) {
      this.audioChunkCount += 1
      if (this.audioChunkCount <= 5 || this.audioChunkCount % 20 === 0) {
        this.logDebug('audio-chunk-sent', { count: this.audioChunkCount, bytes: chunk.base64Data.length })
      }
      this.socket.send(JSON.stringify({ type: 'audio_chunk', data: chunk.base64Data }))
    }

    this.bufferAudioUploadChunk(chunk.pcmChunk)
  }

  private async startBackendAudioUploadSession() {
    try {
      const response = await encountersApi.startAudioUploadSession(this.apiBaseUrl, this.encounterId, {
        sampleRate: 24000,
        channels: 1,
        format: 'pcm16le',
      })
      this.audioUploadSessionId = response.session_id
      this.registerAbortLifecycleHandlers()
      this.logDebug('backend-audio-session-started', { sessionId: response.session_id })
    } catch (error) {
      this.audioUploadSessionId = null
      this.logDebug('backend-audio-session-start-failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      this.onEvent({
        type: 'system',
        message: 'Continuous backend audio upload could not be started. The session will fall back to stop-time upload for draft generation.',
      })
    }
  }

  private bufferAudioUploadChunk(chunk: Int16Array) {
    if (!this.audioUploadSessionId || chunk.length === 0) {
      return
    }

    this.uploadBufferedChunks.push(chunk.slice())
    this.uploadBufferedSampleCount += chunk.length

    if (this.uploadBufferedSampleCount >= BACKEND_UPLOAD_BATCH_SAMPLES) {
      void this.flushAudioUploadBatch({ force: false })
    }
  }

  private async flushAudioUploadBatch({ force }: { force: boolean }) {
    if (!this.audioUploadSessionId || this.uploadBufferedSampleCount === 0) {
      return this.uploadChain
    }

    if (!force && this.uploadBufferedSampleCount < BACKEND_UPLOAD_BATCH_SAMPLES) {
      return this.uploadChain
    }

    const merged = new Int16Array(this.uploadBufferedSampleCount)
    let offset = 0
    for (const bufferedChunk of this.uploadBufferedChunks) {
      merged.set(bufferedChunk, offset)
      offset += bufferedChunk.length
    }

    const sessionId = this.audioUploadSessionId
    const sequence = this.uploadBatchSequence
    const chunkBytes = new Uint8Array(merged.buffer.slice(0))

    this.uploadBufferedChunks = []
    this.uploadBufferedSampleCount = 0
    this.uploadBatchSequence += 1

    this.uploadChain = this.uploadChain
      .then(async () => {
        if (!sessionId) {
          return
        }

        await encountersApi.appendAudioUploadChunk(this.apiBaseUrl, this.encounterId, sessionId, sequence, chunkBytes)
        this.logDebug('backend-audio-chunk-uploaded', {
          sessionId,
          sequence,
          bytes: chunkBytes.byteLength,
        })
      })
      .catch((error) => {
        this.logDebug('backend-audio-chunk-failed', {
          sessionId,
          sequence,
          error: error instanceof Error ? error.message : String(error),
        })
        void this.abortAudioUploadSession('chunk-upload-failed', sessionId)
        this.onEvent({
          type: 'system',
          message: 'Continuous backend audio upload failed mid-session. Falling back to stop-time upload for draft generation.',
        })
      })

    return this.uploadChain
  }

  private logDebug(stage: string, details?: Record<string, unknown>) {
    const isLocalHost = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
    if (!isLocalHost) {
      return
    }

    if (!window.__ambientVoiceDebug) {
      window.__ambientVoiceDebug = {
        events: [],
        sessionId: this.debugSessionId,
        reset: () => {
          if (window.__ambientVoiceDebug) {
            window.__ambientVoiceDebug.events = []
          }
        },
      }
    }

    const store = window.__ambientVoiceDebug

    store.sessionId = this.debugSessionId
    store.events.push({ timestamp: new Date().toISOString(), stage, details })
    if (store.events.length > DEBUG_EVENT_LIMIT) {
      store.events.splice(0, store.events.length - DEBUG_EVENT_LIMIT)
    }

    console.debug('[AmbientVoiceDebug]', stage, details || {})
  }

  private registerAbortLifecycleHandlers() {
    window.addEventListener('pagehide', this.handlePageHide)
  }

  private unregisterAbortLifecycleHandlers() {
    window.removeEventListener('pagehide', this.handlePageHide)
  }

  private async abortAudioUploadSession(reason: string, sessionIdOverride?: string) {
    const sessionId = sessionIdOverride || this.audioUploadSessionId
    if (!sessionId) {
      return
    }

    this.unregisterAbortLifecycleHandlers()
    this.audioUploadSessionId = null

    try {
      await encountersApi.abortAudioUploadSession(this.apiBaseUrl, this.encounterId, sessionId)
      this.logDebug('backend-audio-session-aborted', { sessionId, reason })
    } catch (error) {
      this.logDebug('backend-audio-session-abort-failed', {
        sessionId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private abortAudioUploadSessionWithBeacon(sessionId: string) {
    try {
      const url = new URL(buildApiUrl(this.apiBaseUrl, `/encounters/${this.encounterId}/audio-session/abort`), window.location.origin)
      url.searchParams.set('session_id', sessionId)
      navigator.sendBeacon(url.toString(), new Blob([JSON.stringify({ session_id: sessionId })], { type: 'application/json' }))
      this.logDebug('backend-audio-session-abort-beacon-sent', { sessionId })
    } catch (error) {
      this.logDebug('backend-audio-session-abort-beacon-failed', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}