import type { EncounterUploadResponse, JobResult, JobStatusResponse, UploadResponse } from '../shared/types/api'
import { buildApiUrl, fetchJson } from './client'

export const jobsApi = {
  async upload(apiBaseUrl: string, file: File, encounterId?: string) {
    const formData = new FormData()
    formData.append('file', file)

    const url = new URL(buildApiUrl(apiBaseUrl, '/upload'), window.location.origin)
    if (encounterId) {
      url.searchParams.set('encounter_id', encounterId)
    }

    return fetchJson<UploadResponse | EncounterUploadResponse>(url.toString(), {
      method: 'POST',
      body: formData,
    })
  },

  async process(apiBaseUrl: string, jobId: string) {
    return fetchJson<JobStatusResponse>(buildApiUrl(apiBaseUrl, `/process/${jobId}`), {
      method: 'POST',
    })
  },

  async getStatus(apiBaseUrl: string, jobId: string, signal?: AbortSignal) {
    return fetchJson<JobStatusResponse>(buildApiUrl(apiBaseUrl, `/status/${jobId}`), { signal })
  },

  async getResults(apiBaseUrl: string, jobId: string, signal?: AbortSignal) {
    return fetchJson<JobResult>(buildApiUrl(apiBaseUrl, `/results/${jobId}`), { signal })
  },
}