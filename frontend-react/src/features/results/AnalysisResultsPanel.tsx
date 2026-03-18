import { useMemo, useState } from 'react'
import type { ClinicianReviewResult } from '../../shared/types/api'
import { AssertionsSummary } from './AssertionsSummary'
import { EntityBadges } from './EntityBadges'
import { FindingsTable } from './FindingsTable'
import { RelationshipsPanel } from './RelationshipsPanel'
import { SpeakerTranscript } from './SpeakerTranscript'

interface AnalysisResultsPanelProps {
  reviewResult: ClinicianReviewResult
}

type TabKey = 'transcription' | 'entities' | 'relationships' | 'summary'

interface Tab {
  key: TabKey
  label: string
  count?: number
}

export function AnalysisResultsPanel({ reviewResult }: AnalysisResultsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('transcription')

  const entities = reviewResult.medical_analysis.entities
  const relations = reviewResult.medical_analysis.relationships
  const assertions = reviewResult.medical_analysis.assertions
  const findings = reviewResult.structured_findings
  const speakerCount = reviewResult.transcript.speaker_count

  const tabs: Tab[] = useMemo(() => [
    { key: 'transcription', label: 'Transcription' },
    { key: 'entities', label: 'Medical Entities', count: entities.length },
    { key: 'relationships', label: 'Relationships', count: relations.length },
    { key: 'summary', label: 'Findings' },
  ], [entities.length, relations.length])

  const hasData = entities.length > 0 || relations.length > 0 || reviewResult.transcript.text

  if (!hasData) return null

  return (
    <section className="surface-card analysis-results-card">
      <div className="card-heading-row">
        <div>
          <p className="section-label">Analysis Results</p>
          <h4>Clinical evidence and structured data</h4>
        </div>
      </div>

      <div className="analysis-stats-bar">
        <div className="analysis-stat">
          <span className="analysis-stat-icon">⏱</span>
          <strong>{reviewResult.job_status === 'completed' ? 'Completed' : reviewResult.job_status || '—'}</strong>
          <span>Processing</span>
        </div>
        <div className="analysis-stat">
          <span className="analysis-stat-icon">👥</span>
          <strong>{speakerCount}</strong>
          <span>Speakers</span>
        </div>
        <div className="analysis-stat">
          <span className="analysis-stat-icon">🏥</span>
          <strong>{entities.length}</strong>
          <span>Medical Entities</span>
        </div>
        <div className="analysis-stat">
          <span className="analysis-stat-icon">🔗</span>
          <strong>{relations.length}</strong>
          <span>Relationships</span>
        </div>
      </div>

      <AssertionsSummary assertions={assertions} />

      <div className="analysis-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`analysis-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {tab.count != null ? <span className="analysis-tab-count">{tab.count}</span> : null}
          </button>
        ))}
      </div>

      <div className="analysis-tab-content">
        {activeTab === 'transcription' ? (
          <SpeakerTranscript
            diarizedPhrases={reviewResult.transcript.diarized_phrases}
            segments={reviewResult.transcript.segments}
            plainText={reviewResult.transcript.text}
          />
        ) : null}

        {activeTab === 'entities' ? (
          <EntityBadges entities={entities} />
        ) : null}

        {activeTab === 'relationships' ? (
          <RelationshipsPanel relations={relations} />
        ) : null}

        {activeTab === 'summary' ? (
          <div className="findings-summary-tab">
            <FindingsTable
              findings={findings}
              entities={entities}
              assertions={assertions}
            />
          </div>
        ) : null}
      </div>
    </section>
  )
}
