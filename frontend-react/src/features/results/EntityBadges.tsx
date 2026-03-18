import { useMemo } from 'react'
import type { MedicalEntity } from '../../shared/types/api'

interface EntityBadgesProps {
  entities: MedicalEntity[]
}

const CATEGORY_ORDER = [
  'Symptom Or Sign',
  'Diagnosis',
  'Medication',
  'Body Structure',
  'Treatment',
  'Examination',
  'Direction',
  'Course',
  'Time',
  'Dosage',
  'Frequency',
  'MeasurementValue',
  'MeasurementUnit',
]

function categoryRank(cat: string): number {
  const idx = CATEGORY_ORDER.findIndex((c) => c.toLowerCase() === cat.toLowerCase())
  return idx >= 0 ? idx : CATEGORY_ORDER.length
}

export function EntityBadges({ entities }: EntityBadgesProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, MedicalEntity[]>()
    for (const e of entities) {
      const cat = e.category || 'Other'
      const list = map.get(cat) || []
      list.push(e)
      map.set(cat, list)
    }

    return Array.from(map.entries())
      .sort((a, b) => categoryRank(a[0]) - categoryRank(b[0]))
  }, [entities])

  if (entities.length === 0) return null

  return (
    <div className="entity-badges-panel">
      {grouped.map(([category, items]) => (
        <div key={category} className="entity-badge-group">
          <p className="entity-category-label">
            {category} <span className="entity-category-count">({items.length})</span>
          </p>
          <div className="entity-badge-row">
            {items.map((entity, i) => {
              const hasAssertion = entity.assertion?.certainty === 'negative' ||
                entity.assertion?.certainty === 'negated' ||
                entity.assertion?.conditionality === 'hypothetical'
              const assertionType = entity.assertion?.certainty === 'negative' || entity.assertion?.certainty === 'negated'
                ? 'negated'
                : entity.assertion?.conditionality === 'hypothetical'
                  ? 'hypothetical'
                  : null

              return (
                <span
                  key={`${entity.text}-${i}`}
                  className={`entity-badge ${hasAssertion ? `entity-badge-${assertionType}` : ''}`}
                >
                  <span className="entity-badge-text">{entity.text}</span>
                  {entity.confidenceScore != null ? (
                    <span className="entity-badge-confidence">{(entity.confidenceScore * 100).toFixed(0)}%</span>
                  ) : null}
                  {assertionType ? (
                    <span className={`entity-assertion-tag entity-assertion-${assertionType}`}>
                      {assertionType}
                    </span>
                  ) : null}
                </span>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
