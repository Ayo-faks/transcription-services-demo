import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { buildApiUrl, fetchJson, setApiClientTenantId } from '../../api/client'
import type { AuthSessionResponse, TenantMembership } from '../../shared/types/api'
import { useRuntimeConfig } from './RuntimeConfigProvider'

type AuthSessionStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error'

interface AuthSessionContextValue {
  status: AuthSessionStatus
  session: AuthSessionResponse | null
  error: string | null
  activeTenantId: string | null
  activeMembership: TenantMembership | null
  hasMultipleMemberships: boolean
  authBaseUrl: string
  loginUrls: {
    aad: string
    google: string
    logout: string
  }
  setActiveTenantId: (tenantId: string | null) => void
  refreshSession: (preferredTenantId?: string | null) => Promise<void>
}

const ACTIVE_TENANT_STORAGE_KEY = 'clinical-active-tenant-id'

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null)

function readStoredTenantId() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage.getItem(ACTIVE_TENANT_STORAGE_KEY)
}

function getAuthBaseUrl(apiBaseUrl: string) {
  try {
    return new URL(apiBaseUrl, window.location.origin).origin
  } catch {
    return window.location.origin
  }
}

function buildLoginUrl(authBaseUrl: string, provider: 'aad' | 'google') {
  const loginUrl = new URL(`/.auth/login/${provider}`, authBaseUrl)
  loginUrl.searchParams.set('post_login_redirect_uri', window.location.href)
  return loginUrl.toString()
}

function buildLogoutUrl(authBaseUrl: string) {
  const logoutUrl = new URL('/.auth/logout', authBaseUrl)
  logoutUrl.searchParams.set('post_logout_redirect_uri', window.location.origin)
  return logoutUrl.toString()
}

async function hasEasyAuthSession(authBaseUrl: string) {
  try {
    const response = await fetch(new URL('/.auth/me', authBaseUrl).toString(), {
      credentials: 'include',
    })
    if (!response.ok) {
      return false
    }

    const payload = await response.json().catch(() => [])
    return Array.isArray(payload) && payload.length > 0
  } catch {
    return false
  }
}

function resolveActiveTenantId(session: AuthSessionResponse, preferredTenantId: string | null) {
  const memberships = session.memberships || []
  if (memberships.length === 1) {
    return memberships[0]?.tenant_id || null
  }

  if (preferredTenantId && memberships.some((membership) => membership.tenant_id === preferredTenantId)) {
    return preferredTenantId
  }

  if (session.tenant_id && memberships.some((membership) => membership.tenant_id === session.tenant_id)) {
    return session.tenant_id
  }

  return null
}

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const { apiBaseUrl } = useRuntimeConfig()
  const authBaseUrl = useMemo(() => getAuthBaseUrl(apiBaseUrl), [apiBaseUrl])
  const [status, setStatus] = useState<AuthSessionStatus>('loading')
  const [session, setSession] = useState<AuthSessionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(() => readStoredTenantId())
  const activeTenantIdRef = useRef<string | null>(activeTenantId)

  useEffect(() => {
    activeTenantIdRef.current = activeTenantId
    setApiClientTenantId(activeTenantId)

    if (!activeTenantId) {
      window.localStorage.removeItem(ACTIVE_TENANT_STORAGE_KEY)
      return
    }

    window.localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, activeTenantId)
  }, [activeTenantId])

  const refreshSession = useCallback(async (preferredTenantId?: string | null) => {
    setStatus('loading')
    setError(null)
    const selectedTenantId = preferredTenantId === undefined ? activeTenantIdRef.current : preferredTenantId
    setApiClientTenantId(selectedTenantId)

    const easyAuthDetected = await hasEasyAuthSession(authBaseUrl)

    try {
      const nextSession = await fetchJson<AuthSessionResponse>(buildApiUrl(apiBaseUrl, '/auth/session'))
      const nextActiveTenantId = resolveActiveTenantId(nextSession, selectedTenantId)

      setSession(nextSession)
      setActiveTenantIdState(nextActiveTenantId)
      setStatus('authenticated')
      return
    } catch (sessionError) {
      if (!easyAuthDetected) {
        setSession(null)
        setActiveTenantIdState(null)
        setStatus('unauthenticated')
        return
      }

      setSession(null)
      setActiveTenantIdState(null)
      setStatus('error')
      setError(sessionError instanceof Error ? sessionError.message : 'Authentication state could not be loaded.')
    }
  }, [apiBaseUrl, authBaseUrl])

  useEffect(() => {
    queueMicrotask(() => {
      void refreshSession()
    })
  }, [refreshSession])

  const activeMembership = useMemo(() => {
    if (!session || !activeTenantId) {
      return null
    }

    return session.memberships.find((membership) => membership.tenant_id === activeTenantId) || null
  }, [activeTenantId, session])

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      status,
      session,
      error,
      activeTenantId,
      activeMembership,
      hasMultipleMemberships: (session?.memberships || []).length > 1,
      authBaseUrl,
      loginUrls: {
        aad: buildLoginUrl(authBaseUrl, 'aad'),
        google: buildLoginUrl(authBaseUrl, 'google'),
        logout: buildLogoutUrl(authBaseUrl),
      },
      setActiveTenantId: (tenantId) => setActiveTenantIdState(tenantId),
      refreshSession,
    }),
    [activeMembership, activeTenantId, authBaseUrl, error, refreshSession, session, status],
  )

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>
}

export function useAuthSession() {
  const context = useContext(AuthSessionContext)
  if (!context) {
    throw new Error('useAuthSession must be used inside AuthSessionProvider')
  }

  return context
}