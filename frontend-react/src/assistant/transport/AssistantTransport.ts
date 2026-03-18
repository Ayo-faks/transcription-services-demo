import type { VoiceLiveRuntimeConfig } from '../../app/providers/RuntimeConfigProvider'
import { encountersApi } from '../../api/encountersApi'
import type {
  ClinicianReviewResult,
  EncounterContextQuery,
  EncounterProcessResponse,
  EncounterReviewActionRequest,
  EncounterReviewActionResponse,
  EncounterResponse,
  EncounterSegment,
  StreamingEnvelope,
} from '../../shared/types/api'
import { AmbientVoiceSession, type AmbientVoiceEvent } from './voiceLiveSession'

export class AssistantTransport {
  private readonly apiBaseUrl: string
  private readonly voiceLiveConfig: VoiceLiveRuntimeConfig

  constructor(apiBaseUrl: string, voiceLiveConfig: VoiceLiveRuntimeConfig) {
    this.apiBaseUrl = apiBaseUrl
    this.voiceLiveConfig = voiceLiveConfig
  }

  createEncounter() {
    return encountersApi.create(this.apiBaseUrl, {
      source: 'frontend_react_shell',
      language: 'en-US',
    })
  }

  getEncounter(encounterId: string, signal?: AbortSignal) {
    return encountersApi.get(this.apiBaseUrl, encounterId, signal)
  }

  getEncounterReviewResult(encounterId: string, signal?: AbortSignal) {
    return encountersApi.getReviewResult(this.apiBaseUrl, encounterId, signal)
  }

  getEncounterContext(encounterId: string, query?: EncounterContextQuery) {
    return encountersApi.getContext(this.apiBaseUrl, encounterId, query)
  }

  getOperationalContext(encounterId: string) {
    return encountersApi.getOperationalContext(this.apiBaseUrl, encounterId)
  }

  previewActions(encounterId: string, toolId?: string) {
    return encountersApi.previewActions(this.apiBaseUrl, encounterId, toolId)
  }

  streamAssistantQuery(
    encounterId: string,
    payload: { question: string; scope: string; agentId: string },
    onEnvelope: (envelope: StreamingEnvelope) => void,
  ) {
    return encountersApi.streamAssistantQuery(this.apiBaseUrl, encounterId, payload, onEnvelope)
  }

  startCapture(encounterId: string) {
    return encountersApi.startCapture(this.apiBaseUrl, encounterId)
  }

  appendTranscriptSegments(encounterId: string, segments: EncounterSegment[]) {
    return encountersApi.appendSegments(this.apiBaseUrl, encounterId, segments)
  }

  stopCapture(encounterId: string) {
    return encountersApi.stopCapture(this.apiBaseUrl, encounterId)
  }

  ingestCapturedAudio(encounterId: string, audioBlob: Blob) {
    return encountersApi.ingestAudio(this.apiBaseUrl, encounterId, audioBlob)
  }

  saveDraft(encounterId: string, draftText: string, draftVersion: number, segments: EncounterSegment[]) {
    return encountersApi.saveDraft(this.apiBaseUrl, encounterId, draftText, draftVersion, segments)
  }

  finalizeDraft(encounterId: string, draftVersion: number) {
    return encountersApi.finalize(this.apiBaseUrl, encounterId, draftVersion)
  }

  processClinically(encounterId: string) {
    return encountersApi.process(this.apiBaseUrl, encounterId)
  }

  saveEncounterReview(encounterId: string, payload: EncounterReviewActionRequest) {
    return encountersApi.saveReview(this.apiBaseUrl, encounterId, payload)
  }

  approveEncounterReview(encounterId: string) {
    return encountersApi.approveReview(this.apiBaseUrl, encounterId)
  }

  regenerateEncounterReview(encounterId: string) {
    return encountersApi.regenerateReview(this.apiBaseUrl, encounterId)
  }

  canUseVoiceLive() {
    return Boolean(this.voiceLiveConfig.wsUrl || this.voiceLiveConfig.gatewayBaseUrl)
  }

  getVoiceLiveUnavailableReason() {
    if (this.canUseVoiceLive()) {
      return null
    }

    return 'Voice Live gateway URL is missing from the React runtime config. Update config.js or run configure-frontend.sh before using live Wulo Scribe capture.'
  }

  createAmbientVoiceSession(encounterId: string, onEvent: (event: AmbientVoiceEvent) => void) {
    return new AmbientVoiceSession({
      apiBaseUrl: this.apiBaseUrl,
      encounterId,
      config: this.voiceLiveConfig,
      onEvent,
    })
  }
}

export function hydrateEncounterPayload(payload: EncounterResponse) {
  return {
    encounterId: payload.encounter_id,
    status: payload.status,
    draftVersion: payload.draft_version,
    draftText: payload.draft_text || '',
    transcriptSegments: payload.draft_segments || [],
    diarizedPhrases: payload.diarized_phrases || [],
    speakerCount: payload.speaker_count || 0,
    draftSource: payload.draft_source || null,
    reviewResult: payload.review_result || null,
  }
}

export function getProcessedJobId(payload: EncounterProcessResponse) {
  return payload.job_id
}

export function getEncounterReviewResult(payload: EncounterResponse | ClinicianReviewResult | EncounterReviewActionResponse) {
  if ('transcript' in payload && 'clinician_outputs' in payload) {
    return payload as ClinicianReviewResult
  }

  if ('result' in payload && payload.result) {
    return payload.result
  }

  return ('review_result' in payload ? payload.review_result : null) || null
}