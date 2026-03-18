import type {
  ClinicianReviewResult,
  DiarizationPhrase,
  EncounterReviewAction,
  EncounterSegment,
  EncounterStatus,
  FinalNoteSections,
  JobProcessingStage,
} from '../../shared/types/api'

export type AssistantMode = 'docked' | 'expanded' | 'ambient'
export type AssistantScope = 'local' | 'global'

export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  scope?: AssistantScope
  createdAt: string
}

export interface AssistantSessionState {
  isOpen: boolean
  mode: AssistantMode
  encounterId: string | null
  encounterStatus: EncounterStatus | null
  processingStage: JobProcessingStage | null
  draftVersion: number
  draftText: string
  transcriptSegments: EncounterSegment[]
  diarizedPhrases: DiarizationPhrase[]
  speakerCount: number
  draftSource: string | null
  reviewResult: ClinicianReviewResult | null
  reviewedNote: FinalNoteSections | null
  reviewedNoteText: string
  lastReviewAction: EncounterReviewAction | null
  messages: AssistantMessage[]
  isBusy: boolean
  error: string | null
  lastProcessedJobId: string | null
}