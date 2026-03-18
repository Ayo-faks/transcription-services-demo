import type {
  ClinicianReviewResult,
  FollowUpInstructionItem,
  MedicationChangeItem,
  ReferralItem,
  TestRecommendationItem,
} from '../../shared/types/api'
import { stripMarkdown } from '../../shared/utils/stripMarkdown'

interface OutputsReadyPanelProps {
  reviewResult: ClinicianReviewResult | null
}

function FollowUpCard({ items }: { items: FollowUpInstructionItem[] }) {
  if (items.length === 0) {
    return (
      <article className="clinician-card clinician-card-empty">
        <p className="section-label">Follow-up instructions</p>
        <p>No follow-up instructions were identified.</p>
      </article>
    )
  }

  return (
    <article className="clinician-card">
      <p className="section-label">Follow-up instructions</p>
      <ul className="clinician-card-list">
        {items.map((item) => (
          <li key={item.id}>
            <span>{stripMarkdown(item.instruction)}</span>
            {item.timeframe ? <span className="clinician-card-meta">{stripMarkdown(item.timeframe)}</span> : null}
            {item.priority ? <span className="clinician-card-meta">{stripMarkdown(item.priority)}</span> : null}
          </li>
        ))}
      </ul>
    </article>
  )
}

function MedicationCard({ items }: { items: MedicationChangeItem[] }) {
  if (items.length === 0) {
    return (
      <article className="clinician-card clinician-card-empty">
        <p className="section-label">Medication changes</p>
        <p>No medication changes were identified.</p>
      </article>
    )
  }

  return (
    <article className="clinician-card">
      <p className="section-label">Medication changes</p>
      <ul className="clinician-card-list">
        {items.map((item) => (
          <li key={item.id}>
            <strong>{stripMarkdown(item.medication)}</strong>
            <span className="clinician-card-badge">{item.change_type}</span>
            <span>{stripMarkdown(item.detail)}</span>
            {item.dosage ? <span className="clinician-card-meta">Dosage: {stripMarkdown(item.dosage)}</span> : null}
          </li>
        ))}
      </ul>
    </article>
  )
}

function TestsCard({ items }: { items: TestRecommendationItem[] }) {
  if (items.length === 0) {
    return (
      <article className="clinician-card clinician-card-empty">
        <p className="section-label">Tests ordered</p>
        <p>No tests were identified.</p>
      </article>
    )
  }

  return (
    <article className="clinician-card">
      <p className="section-label">Tests ordered</p>
      <ul className="clinician-card-list">
        {items.map((item) => (
          <li key={item.id}>
            <strong>{stripMarkdown(item.name)}</strong>
            <span>{stripMarkdown(item.detail)}</span>
            {item.timing ? <span className="clinician-card-meta">Timing: {stripMarkdown(item.timing)}</span> : null}
          </li>
        ))}
      </ul>
    </article>
  )
}

function ReferralsCard({ items }: { items: ReferralItem[] }) {
  if (items.length === 0) {
    return (
      <article className="clinician-card clinician-card-empty">
        <p className="section-label">Referrals</p>
        <p>No referrals were identified.</p>
      </article>
    )
  }

  return (
    <article className="clinician-card">
      <p className="section-label">Referrals</p>
      <ul className="clinician-card-list">
        {items.map((item) => (
          <li key={item.id}>
            <strong>{stripMarkdown(item.specialty)}</strong>
            <span>{stripMarkdown(item.detail)}</span>
            {item.urgency ? <span className="clinician-card-badge">{stripMarkdown(item.urgency)}</span> : null}
          </li>
        ))}
      </ul>
    </article>
  )
}

export function OutputsReadyPanel({ reviewResult }: OutputsReadyPanelProps) {
  if (!reviewResult) {
    return (
      <section className="surface-card">
        <div className="card-heading-row">
          <div>
            <p className="section-label">Clinician cards</p>
            <h4>Preparing structured outputs</h4>
          </div>
        </div>
        <p>Follow-up, medication, test, and referral cards will appear once processing is complete.</p>
      </section>
    )
  }

  const followUp = reviewResult.follow_up_instructions
  const meds = reviewResult.medication_changes
  const tests = reviewResult.tests_and_referrals.tests
  const referrals = reviewResult.tests_and_referrals.referrals

  return (
    <section className="surface-card">
      <div className="card-heading-row">
        <div>
          <p className="section-label">Clinician cards</p>
          <h4>Action items for this visit</h4>
        </div>
      </div>

      <div className="clinician-cards-grid">
        <FollowUpCard items={followUp} />
        <MedicationCard items={meds} />
        <TestsCard items={tests} />
        <ReferralsCard items={referrals} />
      </div>
    </section>
  )
}