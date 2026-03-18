export type JobStatus = 'pending' | 'transcribing' | 'analyzing' | 'completed' | 'failed'

export type JobProcessingStage =
  | 'queued'
  | 'clinical_analysis'
  | 'summary_generation'
  | 'search_indexing'
  | 'completed'
  | 'failed'

export type EncounterStatus =
  | 'draft'
  | 'capturing'
  | 'review'
  | 'ready_for_processing'
  | 'processing'
  | 'ready_for_review'
  | 'approved'
  | 'completed'
  | 'failed'

export type TenantRole = 'owner' | 'admin' | 'editor' | 'reviewer' | 'viewer'

export interface TenantMembership {
  tenant_id: string
  tenant_name: string
  tenant_slug: string
  role: TenantRole
}

export interface AuthSessionResponse {
  authenticated: boolean
  user_id: string
  email?: string | null
  name?: string | null
  identity_provider: string
  tenant_id?: string | null
  role?: TenantRole | null
  memberships: TenantMembership[]
  can_create_tenant: boolean
  has_default_tenant_membership?: boolean
  default_tenant_id?: string | null
}

export interface CreateTenantRequest {
  name: string
  slug?: string
}

export interface CreateTenantResponse {
  tenant: {
    id: string
    name: string
    slug: string
    status: string
    isolation_mode: string
    created_at: string
  }
  membership: TenantMembership
}

export interface TenantMemberAssignmentRequest {
  email: string
  name?: string
  role: TenantRole
}

export interface TenantMemberAssignmentResponse {
  tenant_id: string
  user_id: string
  email: string
  role: TenantRole
  placeholder_user_created: boolean
  membership_created: boolean
}

export interface VoiceSessionResponse {
  session_token: string
  expires_at: string
  encounter_id?: string | null
}

export interface LinkMap {
  [key: string]: string
}

export interface UploadResponse {
  job_id: string
  filename: string
  status: JobStatus
  links: LinkMap
}

export interface EncounterUploadResponse {
  encounter_id: string
  filename: string
  status: EncounterStatus
  draft_text?: string
  draft_version: number
  draft_segments?: EncounterSegment[]
  diarized_phrases?: DiarizationPhrase[]
  speaker_count?: number
  draft_source?: string | null
  updated_at?: string
  created_at?: string
  job_id?: string | null
  review_result?: ClinicianReviewResult | null
  links: LinkMap
}

export interface JobStatusResponse {
  job_id: string
  filename: string
  status: JobStatus
  created_at: string
  updated_at: string
  processing_time_seconds?: number | null
  error_message?: string | null
  processing_stage?: JobProcessingStage | null
}

export interface MedicalAssertion {
  certainty?: string
  conditionality?: string
  association?: string
  temporal?: string
}

export interface MedicalEntity {
  text?: string
  category?: string
  subcategory?: string
  confidenceScore?: number
  offset?: number
  length?: number
  assertion?: MedicalAssertion
  [key: string]: unknown
}

export interface MedicalRelationRole {
  name?: string
  text?: string
  category?: string
  [key: string]: unknown
}

export interface MedicalRelation {
  relationType?: string
  confidenceScore?: number
  roles?: MedicalRelationRole[]
  [key: string]: unknown
}

export interface DiarizationPhrase {
  speaker?: string
  offset?: number
  duration?: number
  text?: string
  [key: string]: unknown
}

export interface MedicalAnalysisSummary {
  total_entities: number
  total_relations: number
  categories: string[]
  speaker_count: number
  linked_entities: number
  assertions: Record<string, number>
}

export interface MedicalAnalysis {
  entities: MedicalEntity[]
  entities_by_category: Record<string, MedicalEntity[]>
  relations: MedicalRelation[]
  diarization: {
    phrases: DiarizationPhrase[]
    speaker_count: number
  }
  summary: MedicalAnalysisSummary
}

export interface JobResult {
  job_id: string
  filename: string
  status: JobStatus
  created_at: string
  updated_at: string
  processing_time_seconds?: number | null
  transcription: {
    text?: string
    word_count: number
  }
  medical_analysis?: MedicalAnalysis | null
  clinical_summary?: ClinicalSummaryResponse | null
  fhir_bundle?: Record<string, unknown> | null
  error_message?: string | null
  source_encounter_id?: string | null
  encounter_id?: string
}

export interface ClinicalSummaryResponse {
  job_id: string
  cached?: boolean
  error?: string
  summary_text?: string
  generated_at?: string | null
  model?: string
  token_usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    estimated_cost_usd: number
  }
  input_stats?: {
    transcription_chars: number
    entity_count: number
    relation_count: number
  }
  [key: string]: unknown
}

export type FinalNoteSectionKey = 'hpi' | 'ros' | 'pe' | 'assessment' | 'plan'

export interface FinalNoteSection {
  key: FinalNoteSectionKey
  title: string
  content: string
  bullets?: string[]
}

export interface FinalNoteSections {
  hpi: FinalNoteSection
  ros: FinalNoteSection
  pe: FinalNoteSection
  assessment: FinalNoteSection
  plan: FinalNoteSection
}

export interface ClinicalTimelineItem {
  id: string
  title: string
  detail: string
  timeframe?: string | null
  source?: string | null
  evidence?: string[]
}

export interface ClinicalAssertionItem {
  id: string
  entity_text: string
  category?: string
  certainty?: string
  conditionality?: string
  association?: string
  temporal?: string
  confidence_score?: number
}

export interface StructuredFindingItem {
  id: string
  label: string
  detail: string
  category?: string
  confidence_score?: number
  evidence?: string[]
}

export interface FollowUpInstructionItem {
  id: string
  instruction: string
  timeframe?: string | null
  audience?: string | null
  priority?: string | null
  evidence?: string[]
}

export interface MedicationChangeItem {
  id: string
  medication: string
  change_type: 'start' | 'stop' | 'adjust' | 'continue' | 'monitor' | 'unknown'
  detail: string
  dosage?: string | null
  frequency?: string | null
  reason?: string | null
  evidence?: string[]
}

export interface TestRecommendationItem {
  id: string
  name: string
  detail: string
  timing?: string | null
  reason?: string | null
  evidence?: string[]
}

export interface ReferralItem {
  id: string
  specialty: string
  detail: string
  urgency?: string | null
  reason?: string | null
  evidence?: string[]
}

export interface ClinicianOutputs {
  clinical_summary: string
  structured_findings: StructuredFindingItem[]
  follow_up_instructions: FollowUpInstructionItem[]
  medication_changes: MedicationChangeItem[]
  tests: TestRecommendationItem[]
  referrals: ReferralItem[]
  final_note_sections: FinalNoteSections
}

export interface ClinicianReviewResult {
  encounter_id: string
  status: EncounterStatus
  review_version: number
  created_at?: string
  updated_at?: string
  job_id?: string | null
  job_status?: JobStatus | null
  processing_stage?: JobProcessingStage | null
  transcript: {
    text: string
    segments: EncounterSegment[]
    diarized_phrases: DiarizationPhrase[]
    speaker_count: number
  }
  medical_analysis: {
    entities: MedicalEntity[]
    relationships: MedicalRelation[]
    assertions: ClinicalAssertionItem[]
    timeline: ClinicalTimelineItem[]
  }
  clinician_outputs: ClinicianOutputs
  clinical_summary?: ClinicalSummaryResponse | null
  structured_findings: StructuredFindingItem[]
  follow_up_instructions: FollowUpInstructionItem[]
  medication_changes: MedicationChangeItem[]
  tests_and_referrals: {
    tests: TestRecommendationItem[]
    referrals: ReferralItem[]
  }
  final_note_sections: FinalNoteSections
  final_note_text: string
  links?: LinkMap
  error_message?: string | null
}

export type EncounterReviewAction = 'approve' | 'save_edits' | 'regenerate'

export interface EncounterReviewActionRequest {
  action: EncounterReviewAction
  note_sections?: Partial<Record<FinalNoteSectionKey, string>>
  clinician_summary?: string
  structured_findings?: string[]
  follow_up_instructions?: string[]
  medication_changes?: string[]
  tests?: string[]
  referrals?: string[]
}

export interface EncounterReviewActionResponse {
  encounter_id: string
  action: EncounterReviewAction
  status: EncounterStatus
  updated_at: string
  result?: ClinicianReviewResult | null
  links?: LinkMap
}

export interface EncounterSegment {
  role: string
  text: string
  timestamp: string
  is_final: boolean
}

export interface EncounterResponse {
  encounter_id: string
  status: EncounterStatus
  draft_version: number
  draft_text?: string
  draft_segments?: EncounterSegment[]
  diarized_phrases?: DiarizationPhrase[]
  speaker_count?: number
  draft_source?: string | null
  audio_blob_url?: string | null
  finalized_text?: string | null
  process_job_id?: string | null
  updated_at?: string
  created_at?: string
  metadata?: Record<string, unknown>
  review_result?: ClinicianReviewResult | null
  links?: LinkMap
}

export interface EncounterAudioIngestResponse {
  encounter_id: string
  draft_text: string
  speaker_count: number
  draft_version: number
  status?: EncounterStatus
  job_id?: string | null
  processing_stage?: JobProcessingStage | null
  review_result?: ClinicianReviewResult | null
}

export interface EncounterAudioUploadSessionResponse {
  encounter_id: string
  session_id: string
  status: EncounterStatus | string
  updated_at?: string
}

export interface EncounterAudioChunkUploadResponse {
  encounter_id: string
  session_id: string
  sequence: number
  accepted: boolean
}

export interface EncounterContextProvenance {
  source_type: string
  source_id: string
  excerpt?: string
}

export interface EncounterContextItem {
  id: string
  category: string
  kind: string
  title: string
  text: string
  source: 'encounter' | 'job'
  assertion?: string
  confidence_score?: number
  provenance: EncounterContextProvenance[]
  metadata: Record<string, unknown>
}

export interface EncounterContextSummary {
  total_items: number
  returned_items: number
  categories: string[]
  assertions: string[]
  applied_filters: {
    q?: string | null
    category?: string | null
    assertion?: string | null
    limit: number
  }
}

export interface EncounterContextResponse {
  encounter_id: string
  status: EncounterStatus
  generated_at: string
  linked_job_id: string | null
  contract_version: string
  context_version: string
  items: EncounterContextItem[]
  summary: EncounterContextSummary
}

export interface EncounterContextQuery {
  q?: string
  category?: string
  assertion?: string
  limit?: number
}

export interface FreshnessMetadata {
  fetched_at: string
  expires_at: string
  is_mock: boolean
}

export interface EligibilitySummary {
  provider: string
  status: string
  member_reference: string
  summary: string
  freshness: FreshnessMetadata
}

export interface SchemeQualificationSummary {
  provider: string
  plan_name: string
  qualification_status: string
  summary: string
  freshness: FreshnessMetadata
}

export interface TreatmentLookupResult {
  code: string
  title: string
  category: string
  summary: string
  mock_source: string
}

export interface TreatmentLookupSnapshot {
  provider: string
  results: TreatmentLookupResult[]
  freshness: FreshnessMetadata
}

export interface PriorAuthSummary {
  treatment_code: string
  status: string
  summary: string
}

export interface PriorAuthSnapshot {
  provider: string
  results: PriorAuthSummary[]
  freshness: FreshnessMetadata
}

export interface CommunicationOption {
  channel: string
  target: string
  summary: string
}

export interface CommunicationOptionsSnapshot {
  provider: string
  results: CommunicationOption[]
  freshness: FreshnessMetadata
}

export interface OperationalContextSnapshot {
  encounter_id: string
  status: EncounterStatus
  generated_at: string
  linked_job_id: string | null
  contract_version: string
  eligibility: EligibilitySummary
  scheme_qualification: SchemeQualificationSummary
  treatment_lookup: TreatmentLookupSnapshot
  prior_auth_summaries: PriorAuthSnapshot
  communication_options: CommunicationOptionsSnapshot
  audit_metadata: Record<string, unknown>
}

export interface ActionPreview {
  actionId: string
  toolId: string
  title: string
  target: string
  summary: string
  payloadPreview: Record<string, unknown>
  approvalRequirements: string[]
  idempotencyKey: string
  riskFlags: string[]
  auditMetadata: Record<string, unknown>
}

export interface ActionPreviewResponse {
  encounter_id: string
  generated_at: string
  preview_only: boolean
  requested_tool_id?: string | null
  previews: ActionPreview[]
}

export interface AgentTurnPart {
  type: 'text'
  text: string
}

export interface AgentToolEvent {
  toolId: string
  status: string
  title?: string
  matchedItems?: number
  mode?: string
}

export interface AgentCitation {
  id?: string
  title?: string
  text?: string
  category?: string
  kind?: string
  source?: string
  confidence_score?: number
  provenance?: EncounterContextProvenance[]
  metadata?: Record<string, unknown>
}

export interface AgentTurn {
  id: string
  threadId: string
  role: 'assistant' | 'user' | 'system'
  source: string
  scope: string
  status: 'streaming' | 'completed' | 'failed' | 'cancelled'
  requestId: string
  parts: AgentTurnPart[]
  summary?: string | null
  toolEvents: AgentToolEvent[]
  citations: Array<AgentCitation | EncounterContextItem>
  error?: string | null
  startedAt: string
  completedAt?: string | null
}

export interface AgentThread {
  id: string
  agentId: string
  title: string
  createdAt: string
  updatedAt: string
  contextSnapshotId: string
  surfaceState: string
  turnIds: string[]
}

export type StreamingEnvelopeEvent =
  | 'turn.started'
  | 'turn.delta'
  | 'turn.reasoning_summary'
  | 'turn.tool_started'
  | 'turn.tool_delta'
  | 'turn.tool_completed'
  | 'turn.citation'
  | 'turn.completed'
  | 'turn.failed'
  | 'turn.cancelled'

export interface StreamingEnvelope {
  event: StreamingEnvelopeEvent
  requestId: string
  threadId: string
  turnId: string
  data: Record<string, unknown>
}

export interface AssistantQueryRequest {
  question: string
  scope: string
  agentId: string
}

export interface EncounterProcessResponse {
  encounter_id: string
  job_id: string
  status: EncounterStatus
  job_status?: JobStatus
  processing_stage?: JobProcessingStage | null
  processing_time_seconds?: number
  review_result?: ClinicianReviewResult | null
  links?: LinkMap
}