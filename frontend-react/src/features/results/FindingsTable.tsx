import { useMemo } from 'react'
import type { ClinicalAssertionItem, MedicalEntity, StructuredFindingItem } from '../../shared/types/api'

interface FindingsTableProps {
  findings: StructuredFindingItem[]
  entities: MedicalEntity[]
  assertions: ClinicalAssertionItem[]
}

interface FindingsRow {
  category: string
  term: string
  confidence: number | null
  qualifiers: string[]
}

function buildRows(findings: StructuredFindingItem[], entities: MedicalEntity[], assertions: ClinicalAssertionItem[]): FindingsRow[] {
  const assertionMap = new Map<string, ClinicalAssertionItem>()
  for (const a of assertions) {
    assertionMap.set(a.entity_text.toLowerCase(), a)
  }

  const rows: FindingsRow[] = []
  const seen = new Set<string>()

  for (const f of findings) {
    const key = `${f.category || ''}::${f.label}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const qualifiers: string[] = []
    const assertion = assertionMap.get(f.label.toLowerCase())
    if (assertion?.certainty && assertion.certainty !== 'positive') qualifiers.push(`${assertion.certainty}`)
    if (assertion?.conditionality && assertion.conditionality !== 'none') qualifiers.push(`${assertion.conditionality}`)
    if (assertion?.temporal) qualifiers.push(`${assertion.temporal}`)

    rows.push({
      category: f.category || 'Finding',
      term: f.label,
      confidence: f.confidence_score ?? null,
      qualifiers,
    })
  }

  for (const e of entities) {
    const key = `${e.category || ''}::${e.text || ''}`.toLowerCase()
    if (seen.has(key) || !e.text) continue
    seen.add(key)

    const qualifiers: string[] = []
    const assertion = assertionMap.get(e.text.toLowerCase()) || (e.assertion ? {
      certainty: e.assertion.certainty,
      conditionality: e.assertion.conditionality,
      temporal: e.assertion.temporal,
    } : null)

    if (assertion?.certainty && assertion.certainty !== 'positive') qualifiers.push(`${assertion.certainty}`)
    if (assertion?.conditionality && assertion.conditionality !== 'none') qualifiers.push(`${assertion.conditionality}`)
    if (assertion?.temporal) qualifiers.push(`${assertion.temporal}`)

    rows.push({
      category: e.category || 'Entity',
      term: e.text,
      confidence: e.confidenceScore ?? null,
      qualifiers,
    })
  }

  return rows
}

function qualifierClass(q: string): string {
  const lower = q.toLowerCase()
  if (lower === 'negated' || lower === 'negative') return 'qualifier-negated'
  if (lower === 'hypothetical') return 'qualifier-hypothetical'
  if (lower === 'conditional') return 'qualifier-conditional'
  if (lower === 'uncertain') return 'qualifier-uncertain'
  return 'qualifier-default'
}

export function FindingsTable({ findings, entities, assertions }: FindingsTableProps) {
  const rows = useMemo(() => buildRows(findings, entities, assertions), [findings, entities, assertions])

  const grouped = useMemo(() => {
    const map = new Map<string, FindingsRow[]>()
    for (const row of rows) {
      const list = map.get(row.category) || []
      list.push(row)
      map.set(row.category, list)
    }
    return Array.from(map.entries())
  }, [rows])

  if (rows.length === 0) return null

  return (
    <div className="findings-table-wrapper">
      <table className="findings-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Clinical Term</th>
            <th>Confidence</th>
            <th>Qualifiers</th>
          </tr>
        </thead>
        <tbody>
          {grouped.map(([category, categoryRows]) =>
            categoryRows.map((row, i) => (
              <tr key={`${category}-${row.term}-${i}`}>
                {i === 0 ? (
                  <td className="findings-category-cell" rowSpan={categoryRows.length}>
                    <span className="findings-category-label">{category}</span>
                  </td>
                ) : null}
                <td>{row.term}</td>
                <td className="findings-confidence-cell">
                  {row.confidence != null ? (
                    <span className="confidence-score">{(row.confidence * 100).toFixed(0)}%</span>
                  ) : (
                    <span className="confidence-none">—</span>
                  )}
                </td>
                <td>
                  {row.qualifiers.length > 0 ? (
                    <div className="qualifier-badges">
                      {row.qualifiers.map((q) => (
                        <span key={q} className={`qualifier-badge ${qualifierClass(q)}`}>{q}</span>
                      ))}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
