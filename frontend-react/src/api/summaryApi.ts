import type { ClinicalSummaryResponse } from '../shared/types/api'
import { buildApiUrl, fetchJson } from './client'

export const summaryApi = {
  get(apiBaseUrl: string, jobId: string, signal?: AbortSignal) {
    return fetchJson<ClinicalSummaryResponse>(buildApiUrl(apiBaseUrl, `/summary/${jobId}`), { signal })
  },
}