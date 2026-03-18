interface OutputActionRailProps {
  isBusy: boolean
  isEditing: boolean
  canApprove: boolean
  onApprove: () => void
  onToggleEdit: () => void
  onRegenerate: () => void
  onOpenTechnicalView?: () => void
}

export function OutputActionRail({
  isBusy,
  isEditing,
  canApprove,
  onApprove,
  onToggleEdit,
  onRegenerate,
  onOpenTechnicalView,
}: OutputActionRailProps) {
  return (
    <section className="surface-card review-action-card">
      <div className="action-rail-grid">
        <article className="status-block">
          <button type="button" className="primary-button" onClick={onApprove} disabled={isBusy || !canApprove}>
            {isBusy ? 'Saving...' : 'Approve final note'}
          </button>
        </article>

        <article className="status-block">
          <button type="button" className="secondary-button" onClick={onToggleEdit}>
            {isEditing ? 'Stop editing' : 'Edit note'}
          </button>
        </article>

        <article className="status-block">
          <p className="review-action-hint">Regenerate the clinician-facing outputs from the existing transcript and extracted evidence.</p>
          <button type="button" className="secondary-button" onClick={onRegenerate} disabled={isBusy}>
            Regenerate outputs
          </button>
        </article>

        {onOpenTechnicalView ? (
          <article className="status-block">
            <button type="button" className="secondary-button" onClick={onOpenTechnicalView}>
              Open technical results
            </button>
          </article>
        ) : null}
      </div>
    </section>
  )
}