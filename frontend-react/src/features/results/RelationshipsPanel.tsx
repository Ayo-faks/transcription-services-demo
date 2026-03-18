import { useMemo } from 'react'
import type { MedicalRelation } from '../../shared/types/api'

interface RelationshipsPanelProps {
  relations: MedicalRelation[]
}

interface GroupedRelation {
  type: string
  description: string
  relations: MedicalRelation[]
}

const RELATION_DESCRIPTIONS: Record<string, string> = {
  BodySiteOfCondition: 'Where in the body a condition occurs',
  CourseOfCondition: 'How a condition progresses over time',
  DirectionOfCondition: 'Directional aspect of a condition',
  DirectionOfBodyStructure: 'Directional aspect of a body structure',
  DosageOfMedication: 'Dosage prescribed for a medication',
  FormOfMedication: 'Form of a medication',
  FrequencyOfMedication: 'How often a medication is taken',
  RouteOfMedication: 'Route of medication administration',
  TimeOfCondition: 'When a condition occurred or was observed',
  TimeOfTreatment: 'When a treatment was given',
  TimeOfExamination: 'When an examination occurred',
  QualifierOfCondition: 'Qualifying aspect of a condition',
  RelationOfExamination: 'Relationship between exam and finding',
  ValueOfExamination: 'Measured value from an examination',
  UnitOfExamination: 'Unit of measurement for an examination',
  ExaminationFindsCondition: 'An examination reveals a condition',
  TreatmentIsAdministered: 'A treatment that was provided',
  TimeOfEvent: 'When a clinical event occurred',
}

function describeType(type: string): string {
  return RELATION_DESCRIPTIONS[type] || type.replace(/([A-Z])/g, ' $1').trim()
}

export function RelationshipsPanel({ relations }: RelationshipsPanelProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, MedicalRelation[]>()
    for (const r of relations) {
      const type = r.relationType || 'Unknown'
      const list = map.get(type) || []
      list.push(r)
      map.set(type, list)
    }

    return Array.from(map.entries()).map(([type, rels]): GroupedRelation => ({
      type,
      description: describeType(type),
      relations: rels,
    }))
  }, [relations])

  if (relations.length === 0) return null

  return (
    <div className="relationships-panel">
      <div className="relationships-stats-bar">
        <div className="rel-stat">
          <strong>{relations.length}</strong>
          <span>Total Relationships</span>
        </div>
        <div className="rel-stat">
          <strong>{grouped.length}</strong>
          <span>Relationship Types</span>
        </div>
        <div className="rel-stat">
          <strong>{relations.filter((r) => r.roles?.some((ro) => ro.category === 'ClinicalAssertionItem')).length || grouped.filter((g) => g.relations.some((r) => r.confidenceScore != null && r.confidenceScore < 0.85)).length}</strong>
          <span>With Qualifiers</span>
        </div>
      </div>

      {grouped.map((group) => (
        <div key={group.type} className="relationship-group">
          <div className="relationship-group-header">
            <span className="relationship-type-badge">{group.type.replace(/([A-Z])/g, ' $1').trim()}</span>
            <span className="relationship-count">{group.relations.length} relationship{group.relations.length === 1 ? '' : 's'}</span>
          </div>
          <p className="relationship-description">{group.description}</p>

          {group.relations.map((rel, i) => (
            <div key={i} className="relationship-card">
              <div className="relationship-roles">
                {(rel.roles || []).map((role, ri) => (
                  <div key={ri} className="relationship-role-box">
                    <span className="role-category">{role.category || 'Role'}</span>
                    <strong className="role-text">{role.text || 'Unknown'}</strong>
                    {role.category ? (
                      <span className="role-tag">{role.category}</span>
                    ) : null}
                  </div>
                )).reduce<React.ReactNode[]>((acc, el, idx) => {
                  if (idx > 0) acc.push(<span key={`arrow-${idx}`} className="role-arrow">→</span>)
                  acc.push(el)
                  return acc
                }, [])}
              </div>
              {rel.confidenceScore != null ? (
                <div className="relationship-confidence">
                  <span className="confidence-label">{(rel.confidenceScore * 100).toFixed(0)}% confidence</span>
                  <div className="confidence-bar">
                    <div className="confidence-fill" style={{ width: `${rel.confidenceScore * 100}%` }} />
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
