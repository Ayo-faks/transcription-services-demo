import { useRuntimeConfig } from '../app/providers/RuntimeConfigProvider'

interface ApiClientRuntimeState {
  tenantId: string | null
}

const apiClientRuntimeState: ApiClientRuntimeState = {
  tenantId: null,
}

export class ApiError extends Error {
  status: number
  payload: unknown

  constructor(message: string, status: number, payload: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

export function setApiClientTenantId(tenantId: string | null | undefined) {
  apiClientRuntimeState.tenantId = tenantId || null
}

function withApiRequestInit(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers)
  if (apiClientRuntimeState.tenantId) {
    headers.set('X-Clinical-Tenant-Id', apiClientRuntimeState.tenantId)
  } else {
    headers.delete('X-Clinical-Tenant-Id')
  }

  return {
    ...init,
    headers,
    credentials: init?.credentials ?? 'include',
  }
}

export async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, withApiRequestInit(init))
  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json') ? await response.json() : await response.text()

  if (!response.ok) {
    const message = typeof payload === 'string' ? payload : extractErrorMessage(payload)
    throw new ApiError(message, response.status, payload)
  }

  return payload as T
}

export async function fetchNdjsonStream<T>(
  input: string,
  onMessage: (message: T) => void,
  init?: RequestInit,
): Promise<void> {
  const response = await fetch(input, withApiRequestInit(init))

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || ''
    const payload = contentType.includes('application/json') ? await response.json() : await response.text()
    const message = typeof payload === 'string' ? payload : extractErrorMessage(payload)
    throw new ApiError(message, response.status, payload)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    parseNdjsonText(text, onMessage)
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (line) {
        onMessage(JSON.parse(line) as T)
      }
      newlineIndex = buffer.indexOf('\n')
    }

    if (done) {
      break
    }
  }

  const trailing = buffer.trim()
  if (trailing) {
    onMessage(JSON.parse(trailing) as T)
  }
}

function parseNdjsonText<T>(text: string, onMessage: (message: T) => void) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    onMessage(JSON.parse(line) as T)
  }
}

function extractErrorMessage(payload: unknown): string {
  if (typeof payload === 'object' && payload && 'error' in payload && typeof payload.error === 'string') {
    return payload.error
  }

  return 'The request failed.'
}

export function useApiBaseUrl() {
  return useRuntimeConfig().apiBaseUrl
}

export function buildApiUrl(apiBaseUrl: string, path: string): string {
  return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`
}