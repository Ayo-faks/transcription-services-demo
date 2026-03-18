import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { encountersApi } from '../../api/encountersApi'
import { jobsApi } from '../../api/jobsApi'
import { useApiBaseUrl } from '../../api/client'
import { useRegisterCurrentView } from '../../assistant/tools/CurrentViewProvider'

const acceptedFormats = '.wav,.mp3,.m4a,.ogg,.flac,.wma,.aac'

function formatBytes(size: number) {
  if (size === 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1)
  const value = size / 1024 ** index
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

export function UploadPage() {
  const apiBaseUrl = useApiBaseUrl()
  const navigate = useNavigate()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const logUploadEvent = useCallback((message: string) => {
    if (import.meta.env.DEV) {
      console.info(`[UploadPage] ${message}`)
    }
  }, [])

  const viewContext = useMemo(
    () => ({
      route: '/',
      title: 'Visit Intake',
      summary: selectedFile
        ? `A visit recording is selected: ${selectedFile.name}, ${formatBytes(selectedFile.size)}. Automatic processing will prepare the final clinician review.`
        : 'Choose either live ambient capture or uploaded audio to begin the visit.',
      facts: [
        selectedFile ? `Selected recording: ${selectedFile.name}.` : 'No recording selected yet.',
        'Wulo Scribe captures the visit live.',
        'Upload a recording sends existing audio straight into automatic processing.',
        selectedFile ? 'The selected recording is ready to upload.' : 'No recording selected yet.',
        'Manual upload stays available as a secondary side path.',
      ],
      outcomes: [
        selectedFile ? 'Recording ready to start automatic processing.' : 'Both intake paths are available.',
      ],
      nextSteps: [
        selectedFile ? 'Upload the recording and open the final review route.' : 'Choose a path to start the visit.',
      ],
      raw: {
        hasFile: Boolean(selectedFile),
        fileName: selectedFile?.name,
        fileSize: selectedFile?.size,
      },
    }),
    [selectedFile],
  )

  useRegisterCurrentView(viewContext)

  async function startVisitFromFile(file: File) {
    if (isSubmitting) {
      logUploadEvent(`Start skipped for ${file.name} because a run is already active.`)
      return
    }

    if (!file) {
      logUploadEvent('Submit blocked because no file is selected.')
      return
    }

    logUploadEvent(`Starting upload for ${file.name}`)
    setError(null)
    setIsSubmitting(true)
    try {
      const createdEncounter = await encountersApi.create(apiBaseUrl, {
        source: 'uploaded_recording',
        language: 'en-US',
      })
      const uploadResponse = await jobsApi.upload(apiBaseUrl, file, createdEncounter.encounter_id)

      if (!('encounter_id' in uploadResponse)) {
        throw new Error('The upload did not return an encounter for final review.')
      }

      logUploadEvent(`Upload succeeded. Encounter id: ${uploadResponse.encounter_id}`)
      await new Promise((resolve) => window.setTimeout(resolve, 300))
      navigate(`/encounters/${uploadResponse.encounter_id}/review`)
    } catch (submissionError) {
      logUploadEvent('Upload request failed.')
      setError(submissionError instanceof Error ? submissionError.message : 'Upload failed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSubmit() {
    if (!selectedFile) {
      logUploadEvent('Submit blocked because no file is selected.')
      return
    }

    await startVisitFromFile(selectedFile)
  }

  async function handleRetryUpload() {
    if (!selectedFile || isSubmitting) {
      return
    }

    await startVisitFromFile(selectedFile)
  }

  return (
    <div className="page-grid upload-page-grid">
      <div className="intake-home-layout">
        <section className="hero-card intake-ambient-hero-card">
          <div className="intake-ambient-stage">
            <div className="intake-ambient-copy">
              <p className="shell-eyebrow">Visit Intake</p>
              <h3>Start Wulo Scribe</h3>
              <p>
                Capture the conversation, stop when it ends, and processing prepares your clinical note automatically.
              </p>

              <div className="assistant-action-row intake-ambient-actions">
                <button type="button" className="primary-button intake-ambient-primary" onClick={() => navigate('/ambient-scribe')} disabled={isSubmitting}>
                  Start Wulo Scribe
                </button>
              </div>

              <p className="intake-ambient-note">
                The upload path stays available on the right when the recording already exists.
              </p>
            </div>

            <div className="intake-ambient-visual">
              <div className="ambient-orb ambient-orb-home" aria-hidden="true" />
            </div>
          </div>
        </section>

        <aside className="surface-card upload-side-card" id="upload-side-card">
          <div className="upload-side-header">
            <p className="section-label">Manual upload</p>
            <h4>Upload a recording</h4>
            <p>
              Use this when the visit audio already exists. Automatic processing still prepares the same final clinician review.
            </p>
          </div>

          <label className="upload-dropzone upload-dropzone-compact upload-side-dropzone" htmlFor="audio-upload">
            <input
              id="audio-upload"
              type="file"
              accept={acceptedFormats}
              onChange={(event) => {
                const nextFile = event.target.files?.[0] || null
                setSelectedFile(nextFile)
                logUploadEvent(nextFile ? `Selected file ${nextFile.name}` : 'File selection cleared.')
              }}
            />
            <span className="upload-icon">+</span>
            <strong>{selectedFile ? selectedFile.name : 'Choose a recording'}</strong>
            <p>{selectedFile ? formatBytes(selectedFile.size) : 'Supported formats: WAV, MP3, M4A, OGG, FLAC, WMA, AAC.'}</p>
          </label>

          {error ? (
            <div className="retry-banner">
              <div className="error-banner">{error}</div>
              <button type="button" className="secondary-button retry-button" onClick={handleRetryUpload} disabled={!selectedFile || isSubmitting}>
                Try again
              </button>
            </div>
          ) : null}

          <div className="action-row upload-side-actions">
            <button type="button" className="primary-button" onClick={handleSubmit} disabled={!selectedFile || isSubmitting}>
              {isSubmitting ? 'Starting processing...' : 'Upload and process'}
            </button>
            <button type="button" className="secondary-button" onClick={() => setSelectedFile(null)} disabled={isSubmitting || !selectedFile}>
              Clear
            </button>
          </div>
        </aside>
      </div>

      <section className="surface-card">
        <div className="card-heading-row">
          <div>
            <p className="section-label">Next</p>
            <h4>What happens next</h4>
          </div>
        </div>

        <ul className="detail-list">
          <li>Choose live ambient capture or upload an existing recording.</li>
          <li>Automatic processing starts as soon as the capture or upload is complete.</li>
          <li>Open one shared final review page either way.</li>
          <li>Approve, edit, or regenerate from the clinician-ready review surface.</li>
          <li>Use Technical Results only when deeper inspection is needed.</li>
        </ul>
      </section>
    </div>
  )
}