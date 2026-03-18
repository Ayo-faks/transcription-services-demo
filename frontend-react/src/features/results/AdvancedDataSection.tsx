import type {
  ClinicalAssertionItem,
  ClinicalSummaryResponse,
  ClinicalTimelineItem,
  ClinicianReviewResult,
  MedicalEntity,
  MedicalRelation,
} from '../../shared/types/api'

interface AdvancedDataSectionProps {
  reviewResult?: ClinicianReviewResult | null
  transcriptText?: string
  entities?: MedicalEntity[]
  relations?: MedicalRelation[]
  assertions?: ClinicalAssertionItem[]
  timeline?: ClinicalTimelineItem[]
  fhirBundle?: Record<string, unknown> | null | undefined
  summary?: ClinicalSummaryResponse | null
}

export function AdvancedDataSection({
  reviewResult,
  transcriptText = '',
  entities = [],
  relations = [],
  assertions = [],
  timeline = [],
  fhirBundle,
  summary,
}: AdvancedDataSectionProps) {
  const effectiveTranscript = reviewResult?.transcript.text || transcriptText
  const effectiveEntities = reviewResult?.medical_analysis.entities || entities
  const effectiveRelations = reviewResult?.medical_analysis.relationships || relations
  const effectiveAssertions = reviewResult?.medical_analysis.assertions || assertions
  const effectiveTimeline = reviewResult?.medical_analysis.timeline || timeline
  const effectiveSummary = reviewResult?.clinical_summary || summary || null

  return (
    <section className="surface-card advanced-section-card">
      <details className="advanced-disclosure">
        <summary>
          <span>Advanced data</span>
          <strong>Open transcript, structured evidence, and export detail</strong>
        </summary>

        <div className="advanced-grid">
          <details className="status-block">
            <summary>Transcript</summary>
            <pre className="code-block transcription-block">{effectiveTranscript || 'No transcript returned.'}</pre>
          </details>

          <details className="status-block">
            <summary>Structured evidence</summary>
            <div className="detail-list">
              <p>Entities: {effectiveEntities.length}</p>
              <p>Relations: {effectiveRelations.length}</p>
              <p>Assertions: {effectiveAssertions.length}</p>
              <p>Timeline items: {effectiveTimeline.length}</p>
            </div>
            <pre className="code-block">{JSON.stringify({ entities: effectiveEntities, relations: effectiveRelations, assertions: effectiveAssertions, timeline: effectiveTimeline }, null, 2)}</pre>
          </details>

          <details className="status-block">
            <summary>FHIR bundle</summary>
            <pre className="code-block">{JSON.stringify(fhirBundle || {}, null, 2)}</pre>
          </details>

          <details className="status-block">
            <summary>Summary metadata</summary>
            <pre className="code-block">
              {JSON.stringify({
                generated_at: effectiveSummary?.generated_at || null,
                model: effectiveSummary?.model || null,
                token_usage: effectiveSummary?.token_usage || null,
                input_stats: effectiveSummary?.input_stats || null,
              }, null, 2)}
            </pre>
          </details>
        </div>
      </details>
    </section>
  )
}