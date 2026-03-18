import type { ClinicianReviewResult } from '../../shared/types/api'

interface EvidencePanelProps {
  reviewResult: ClinicianReviewResult | null
}

export function EvidencePanel({ reviewResult }: EvidencePanelProps) {
  if (!reviewResult) {
    return null
  }

  const transcriptItems = reviewResult.transcript.diarized_phrases.length > 0
    ? reviewResult.transcript.diarized_phrases.map((phrase, index) => `${phrase.speaker || 'Speaker'}: ${phrase.text || `Phrase ${index + 1}`}`)
    : reviewResult.transcript.segments.map((segment) => `${segment.role}: ${segment.text}`)

  const evidenceGroups = [
    {
      title: 'Transcript',
      items: transcriptItems,
      emptyMessage: 'Transcript evidence is not available yet.',
    },
    {
      title: 'Medical entities',
      items: reviewResult.medical_analysis.entities.map((entity) => `${entity.category || 'Entity'}: ${entity.text || 'Unnamed item'}`),
      emptyMessage: 'No medical entities were extracted.',
    },
    {
      title: 'Relationships',
      items: reviewResult.medical_analysis.relationships.map((relationship) => relationship.relationType || 'Unnamed relationship'),
      emptyMessage: 'No relationships were extracted.',
    },
    {
      title: 'Assertions',
      items: reviewResult.medical_analysis.assertions.map((assertion) => `${assertion.entity_text}: ${[assertion.certainty, assertion.conditionality, assertion.temporal].filter(Boolean).join(', ') || 'No qualifiers'}`),
      emptyMessage: 'No assertion metadata is available.',
    },
  ]

  return (
    <section className="surface-card evidence-panel-card">
      <div className="card-heading-row">
        <div>
          <p className="section-label">Evidence</p>
          <h4>Optional evidence for cross-checking</h4>
        </div>
      </div>

      <div className="evidence-grid">
        {evidenceGroups.map((group) => (
          <details key={group.title} className="status-block evidence-card review-evidence-details">
            <summary>
              <span>{group.title}</span>
              <strong>{group.items.length}</strong>
            </summary>
            {group.items.length > 0 ? (
              <ul className="detail-list summary-bullet-list">
                {group.items.slice(0, 24).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p>{group.emptyMessage}</p>
            )}
          </details>
        ))}
      </div>
    </section>
  )
}