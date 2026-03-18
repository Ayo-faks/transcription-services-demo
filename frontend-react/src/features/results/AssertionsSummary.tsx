import { useMemo } from 'react'
import type { ClinicalAssertionItem } from '../../shared/types/api'

interface AssertionsSummaryProps {
  assertions: ClinicalAssertionItem[]
}

interface AssertionGroup {
  label: string
  className: string
  count: number
}

export function AssertionsSummary({ assertions }: AssertionsSummaryProps) {
  const groups = useMemo(() => {
    const counts = { negated: 0, hypothetical: 0, conditional: 0, uncertain: 0, positive: 0 }

    for (const a of assertions) {
      const cert = (a.certainty || 'positive').toLowerCase()
      const cond = (a.conditionality || '').toLowerCase()

      if (cert === 'negative' || cert === 'negated') counts.negated++
      else if (cond === 'hypothetical' || cert === 'hypothetical') counts.hypothetical++
      else if (cond === 'conditional' || cert === 'conditional') counts.conditional++
      else if (cert === 'uncertain') counts.uncertain++
      else counts.positive++
    }

    const result: AssertionGroup[] = []
    if (counts.positive > 0) result.push({ label: 'Positive', className: 'assertion-chip-positive', count: counts.positive })
    if (counts.negated > 0) result.push({ label: 'Negated', className: 'assertion-chip-negated', count: counts.negated })
    if (counts.hypothetical > 0) result.push({ label: 'Hypothetical', className: 'assertion-chip-hypothetical', count: counts.hypothetical })
    if (counts.conditional > 0) result.push({ label: 'Conditional', className: 'assertion-chip-conditional', count: counts.conditional })
    if (counts.uncertain > 0) result.push({ label: 'Uncertain', className: 'assertion-chip-uncertain', count: counts.uncertain })

    return result
  }, [assertions])

  if (assertions.length === 0) return null

  return (
    <div className="assertions-summary-bar">
      <span className="assertions-label">Assertion Detection</span>
      {groups.map((g) => (
        <span key={g.label} className={`assertion-chip ${g.className}`}>
          <span className="assertion-chip-icon">{chipIcon(g.label)}</span>
          <strong>{g.count}</strong> {g.label}
        </span>
      ))}
    </div>
  )
}

function chipIcon(label: string): string {
  switch (label.toLowerCase()) {
    case 'negated': return '✕'
    case 'hypothetical': return '↓'
    case 'conditional': return '↔'
    case 'uncertain': return '?'
    default: return '◇'
  }
}
