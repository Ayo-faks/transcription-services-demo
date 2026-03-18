import type { ClinicianReviewResult, FinalNoteSectionKey } from '../../shared/types/api'
import { stripMarkdown } from '../../shared/utils/stripMarkdown'

interface SummaryPanelProps {
  reviewResult: ClinicianReviewResult | null
  isEditing?: boolean
  editedSections?: Partial<Record<FinalNoteSectionKey, string>>
  onChangeSection?: (key: FinalNoteSectionKey, value: string) => void
}

const NOTE_SECTION_ORDER: FinalNoteSectionKey[] = ['hpi', 'ros', 'pe', 'assessment', 'plan']

export function SummaryPanel({ reviewResult, isEditing = false, editedSections, onChangeSection }: SummaryPanelProps) {
  if (!reviewResult) {
    return <p>The final review payload is not available yet.</p>
  }

  if (reviewResult.error_message && reviewResult.status === 'failed') {
    return <div className="error-banner">{reviewResult.error_message}</div>
  }

  const noteSections = reviewResult.final_note_sections

  return (
    <div className="summary-layout clinician-review-summary">
      {reviewResult.clinician_outputs.clinical_summary ? (
        <div className="summary-panel-intro summary-panel-intro-hero review-summary-intro">
          <p>{stripMarkdown(reviewResult.clinician_outputs.clinical_summary)}</p>
        </div>
      ) : null}

      <div className="summary-section-stack review-note-stack">
        {NOTE_SECTION_ORDER.map((key) => {
          const section = noteSections[key]
          const value = editedSections?.[key] ?? section.content

          return (
            <section key={section.key} className="summary-section summary-section-annotated review-note-section">
              <div className="summary-section-heading">
                <span>Note section</span>
                <strong>{section.title}</strong>
              </div>

              {isEditing ? (
                <textarea
                  className="text-area review-note-textarea"
                  value={value}
                  onChange={(event) => onChangeSection?.(key, event.target.value)}
                />
              ) : (
                <p>{value ? stripMarkdown(value) : `No ${section.title} content was generated.`}</p>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}