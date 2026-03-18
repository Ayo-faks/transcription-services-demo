import { useState } from 'react'
import type { DiarizationPhrase, EncounterSegment } from '../../shared/types/api'

interface SpeakerTranscriptProps {
  diarizedPhrases: DiarizationPhrase[]
  segments: EncounterSegment[]
  plainText: string
}

const SPEAKER_COLORS = [
  'speaker-color-1',
  'speaker-color-2',
  'speaker-color-3',
  'speaker-color-4',
]

export function SpeakerTranscript({ diarizedPhrases, segments, plainText }: SpeakerTranscriptProps) {
  const [view, setView] = useState<'speaker' | 'plain'>('speaker')

  const hasSpeakerData = diarizedPhrases.length > 0 || segments.length > 0

  if (!hasSpeakerData && !plainText) return null

  const phrases = diarizedPhrases.length > 0
    ? diarizedPhrases.map((p, i) => ({ speaker: p.speaker || `Speaker ${i + 1}`, text: p.text || '' }))
    : segments.map((s) => ({ speaker: s.role || 'Speaker', text: s.text || '' }))

  const speakerSet = Array.from(new Set(phrases.map((p) => p.speaker)))

  return (
    <div className="speaker-transcript-panel">
      <div className="transcript-view-toggle">
        <button
          type="button"
          className={`transcript-toggle-btn ${view === 'speaker' ? 'active' : ''}`}
          onClick={() => setView('speaker')}
          disabled={!hasSpeakerData}
        >
          Speaker View
        </button>
        <button
          type="button"
          className={`transcript-toggle-btn ${view === 'plain' ? 'active' : ''}`}
          onClick={() => setView('plain')}
        >
          Plain Text
        </button>
      </div>

      {view === 'speaker' && hasSpeakerData ? (
        <div className="speaker-blocks">
          {phrases.map((p, i) => {
            const speakerIdx = speakerSet.indexOf(p.speaker)
            const colorClass = SPEAKER_COLORS[speakerIdx % SPEAKER_COLORS.length]

            return (
              <div key={i} className={`speaker-block ${colorClass}`}>
                <span className="speaker-tag">{p.speaker}</span>
                <p className="speaker-text">{p.text}</p>
              </div>
            )
          })}
        </div>
      ) : (
        <pre className="transcript-plain-text">{plainText || 'No transcript available.'}</pre>
      )}
    </div>
  )
}
