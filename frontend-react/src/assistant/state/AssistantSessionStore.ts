import { create } from 'zustand'
import type {
  ClinicianReviewResult,
  DiarizationPhrase,
  EncounterReviewAction,
  EncounterSegment,
  EncounterStatus,
  JobProcessingStage,
} from '../../shared/types/api'
import type { AssistantMessage, AssistantMode, AssistantSessionState } from './assistantTypes'

interface AssistantSessionActions {
  open: (mode?: AssistantMode) => void
  close: () => void
  setMode: (mode: AssistantMode) => void
  setEncounter: (payload: {
    encounterId: string | null
    status: EncounterStatus | null
    processingStage?: JobProcessingStage | null
    draftVersion: number
    draftText: string
    transcriptSegments: EncounterSegment[]
    diarizedPhrases: DiarizationPhrase[]
    speakerCount: number
    draftSource: string | null
    reviewResult?: ClinicianReviewResult | null
  }) => void
  setReviewResult: (reviewResult: ClinicianReviewResult | null) => void
  setProcessingStage: (processingStage: JobProcessingStage | null) => void
  setLastReviewAction: (action: EncounterReviewAction | null) => void
  setDraftText: (draftText: string) => void
  replaceTranscriptSegments: (segments: EncounterSegment[]) => void
  appendTranscriptSegments: (segments: EncounterSegment[]) => void
  setMessages: (messages: AssistantMessage[]) => void
  addMessage: (message: Omit<AssistantMessage, 'id' | 'createdAt'>) => void
  setBusy: (value: boolean) => void
  setError: (error: string | null) => void
  setLastProcessedJobId: (jobId: string | null) => void
}

const initialState: AssistantSessionState = {
  isOpen: false,
  mode: 'docked',
  encounterId: null,
  encounterStatus: null,
  processingStage: null,
  draftVersion: 0,
  draftText: '',
  transcriptSegments: [],
  diarizedPhrases: [],
  speakerCount: 0,
  draftSource: null,
  reviewResult: null,
  reviewedNote: null,
  reviewedNoteText: '',
  lastReviewAction: null,
  messages: [
    {
      id: crypto.randomUUID(),
      role: 'system',
      content:
        'Use this assistant to move through intake, automatic processing, and final clinician review with approval at the end.',
      createdAt: new Date().toISOString(),
    },
  ],
  isBusy: false,
  error: null,
  lastProcessedJobId: null,
}

export const useAssistantSessionStore = create<AssistantSessionState & AssistantSessionActions>((set) => ({
  ...initialState,
  open: (mode) => set((state) => ({ isOpen: true, mode: mode || state.mode })),
  close: () => set({ isOpen: false }),
  setMode: (mode) => set({ mode, isOpen: true }),
  setEncounter: ({ encounterId, status, processingStage, draftVersion, draftText, transcriptSegments, diarizedPhrases, speakerCount, draftSource, reviewResult }) =>
    set({
      encounterId,
      encounterStatus: status,
      processingStage: processingStage ?? reviewResult?.processing_stage ?? null,
      draftVersion,
      draftText,
      transcriptSegments,
      diarizedPhrases,
      speakerCount,
      draftSource,
      reviewResult: reviewResult ?? null,
      reviewedNote: reviewResult?.final_note_sections || null,
      reviewedNoteText: reviewResult?.final_note_text || '',
    }),
  setReviewResult: (reviewResult) =>
    set({
      reviewResult,
      reviewedNote: reviewResult?.final_note_sections || null,
      reviewedNoteText: reviewResult?.final_note_text || '',
      processingStage: reviewResult?.processing_stage || null,
    }),
  setProcessingStage: (processingStage) => set({ processingStage }),
  setLastReviewAction: (lastReviewAction) => set({ lastReviewAction }),
  setDraftText: (draftText) => set({ draftText }),
  replaceTranscriptSegments: (segments) => set({ transcriptSegments: segments }),
  appendTranscriptSegments: (segments) =>
    set((state) => ({ transcriptSegments: [...state.transcriptSegments, ...segments] })),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          ...message,
        },
      ],
    })),
  setBusy: (value) => set({ isBusy: value }),
  setError: (error) => set({ error }),
  setLastProcessedJobId: (jobId) => set({ lastProcessedJobId: jobId }),
}))