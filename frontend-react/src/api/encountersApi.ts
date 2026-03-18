import type {
  ActionPreviewResponse,
  AssistantQueryRequest,
  ClinicianReviewResult,
  EncounterContextQuery,
  EncounterContextResponse,
  EncounterAudioIngestResponse,
  EncounterAudioChunkUploadResponse,
  EncounterAudioUploadSessionResponse,
  EncounterProcessResponse,
  EncounterReviewActionRequest,
  EncounterReviewActionResponse,
  EncounterResponse,
  EncounterSegment,
  OperationalContextSnapshot,
  StreamingEnvelope,
  VoiceSessionResponse,
} from '../shared/types/api'
import { buildApiUrl, fetchJson, fetchNdjsonStream } from './client'

export const encountersApi = {
  create(apiBaseUrl: string, payload?: { source?: string; language?: string }) {
    return fetchJson<EncounterResponse>(buildApiUrl(apiBaseUrl, '/encounters'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload || {}),
    })
  },

  get(apiBaseUrl: string, encounterId: string, signal?: AbortSignal) {
    return fetchJson<EncounterResponse>(buildApiUrl(apiBaseUrl, `/encounters/${encounterId}`), { signal })
  },

  getReviewResult(apiBaseUrl: string, encounterId: string, signal?: AbortSignal) {
    return fetchJson<ClinicianReviewResult>(buildApiUrl(apiBaseUrl, `/encounters/${encounterId}/results`), { signal })
  },

  getContext(apiBaseUrl: string, encounterId: string, query?: EncounterContextQuery) {
    const url = new URL(buildApiUrl(apiBaseUrl, `/encounters/${encounterId}/context`), window.location.origin)

    if (query?.q) {
      url.searchParams.set('q', query.q)
    }

    if (query?.category) {
      url.searchParams.set('category', query.category)
    }

    if (query?.assertion) {
      url.searchParams.set('assertion', query.assertion)
    }

    if (query?.limit) {
      url.searchParams.set('limit', String(query.limit))
    }

    return fetchJson<EncounterContextResponse>(url.toString())
  },

  getOperationalContext(apiBaseUrl: string, encounterId: string) {
    return fetchJson<OperationalContextSnapshot>(
      buildApiUrl(apiBaseUrl, `/encounters/${encounterId}/operational-context`),
    )
  },

  previewActions(apiBaseUrl: string, encounterId: string, toolId?: string) {
    return fetchJson<ActionPreviewResponse>(buildApiUrl(apiBaseUrl, `/encounters/${encounterId}/actions/preview`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(toolId ? { toolId } : {}),
    })
  },

  streamAssistantQuery(
    apiBaseUrl: string,
    encounterId: string,
    payload: AssistantQueryRequest,
    onEnvelope: (envelope: StreamingEnvelope) => void,
  ) {
    return fetchNdjsonStream<StreamingEnvelope>(
      buildApiUrl(apiBaseUrl, `/encounters/${encounterId}/assistant/query`),
      onEnvelope,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    )
  },

  startCapture(apiBaseUrl: string, encounterId: string) {
    return fetchJson<EncounterResponse>(buildApiUrl(apiBaseUrl, `/encounters/${encounterId}/capture/start`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mode: 'ambient' }),
    })
  },

  stopCapture(apiBaseUrl: string, encounterId: string) {
    return fetchJson<EncounterResponse | EncounterProcessResponse>(buildApiUrl(apiBaseUrl, `/encounters/${encounterId}/capture/stop`), {
      method: 'POST',
    })
  },

  ingestAudio(apiBaseUrl: string, encounterId: string, audioBlob: Blob) {
    return fetchJson<EncounterAudioIngestResponse>(buildApiUrl(apiBaseUrl, `/encounters/${encounterId}/audio`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: audioBlob,
    })
  },

  startAudioUploadSession(apiBaseUrl: string, encounterId: string, payload?: { sampleRate?: number; channels?: number; format?: string }) {
    return fetchJson<EncounterAudioUploadSessionResponse>(buildApiUrl(apiBaseUrl, `/encounters/${encounterId}/audio-session/start`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload || {}),
    })
  },

  appendAudioUploadChunk(apiBaseUrl: string, encounterId: string, sessionId: string, sequence: number, chunkBytes: Uint8Array) {
    const url = new URL(buildApiUrl(apiBaseUrl, `/encounters/${encounterId}/audio-session/chunks`), window.location.origin)
    url.searchParams.set('session_id', sessionId)
    url.searchParams.set('sequence', String(sequence))
    const chunkPayload = new Uint8Array(chunkBytes.length)
    chunkPayload.set(chunkBytes)

    return fetchJson<EncounterAudioChunkUploadResponse>(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: chunkPayload.buffer,
    })
  },

  finalizeAudioUploadSession(apiBaseUrl: string, encounterId: string, sessionId: string) {
    return fetchJson<EncounterAudioIngestResponse>(buildApiUrl(apiBaseUrl, `/encounters/${encounterId}/audio-session/finalize`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ session_id: sessionId }),
    })
  },

  abortAudioUploadSession(apiBaseUrl: string, encounterId: string, sessionId: string) {
    return fetchJson<{ encounter_id: string; session_id: string; aborted: boolean; status?: string }>(
      buildApiUrl(apiBaseUrl, `/encounters/${encounterId}/audio-session/abort`),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ session_id: sessionId }),
      },
    )
  },

  appendSegments(apiBaseUrl: string, encounterId: string, segments: EncounterSegment[]) {
    return fetchJson<EncounterResponse>(buildApiUrl(apiBaseUrl, `/encounters/${encounterId}/segments`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ segments }),
    })
  },

  saveDraft(
    apiBaseUrl: string,
    encounterId: string,
    draftText: string,
    expectedDraftVersion: number,
    segments: EncounterSegment[],
  ) {
    return fetchJson<EncounterResponse>(buildApiUrl(apiBaseUrl, `/encounters/${encounterId}/draft`), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        draft_text: draftText,
        expected_draft_version: expectedDraftVersion,
        segments,
      }),
    })
  },

  finalize(apiBaseUrl: string, encounterId: string, expectedDraftVersion: number) {
    return fetchJson<EncounterResponse>(buildApiUrl(apiBaseUrl, `/encounters/${encounterId}/finalize`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expected_draft_version: expectedDraftVersion,
      }),
    })
  },

  process(apiBaseUrl: string, encounterId: string) {
    return fetchJson<EncounterProcessResponse>(buildApiUrl(apiBaseUrl, `/encounters/${encounterId}/process`), {
      method: 'POST',
    })
  },

  saveReview(apiBaseUrl: string, encounterId: string, payload: EncounterReviewActionRequest) {
    return fetchJson<EncounterReviewActionResponse>(buildApiUrl(apiBaseUrl, `/encounters/${encounterId}/review`), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  },

  approveReview(apiBaseUrl: string, encounterId: string) {
    return fetchJson<EncounterReviewActionResponse>(buildApiUrl(apiBaseUrl, `/encounters/${encounterId}/review/approve`), {
      method: 'POST',
    })
  },

  regenerateReview(apiBaseUrl: string, encounterId: string) {
    return fetchJson<EncounterReviewActionResponse>(buildApiUrl(apiBaseUrl, `/encounters/${encounterId}/review/regenerate`), {
      method: 'POST',
    })
  },

  createVoiceSession(apiBaseUrl: string, encounterId: string) {
    return fetchJson<VoiceSessionResponse>(buildApiUrl(apiBaseUrl, '/voice-sessions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ encounter_id: encounterId }),
    })
  },
}