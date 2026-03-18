import { useState } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { buildApiUrl, fetchJson } from '../../api/client'
import { AgentSurfaceHost } from '../../assistant/shell/AgentSurfaceHost'
import { useAgentRuntime } from '../../assistant/runtime/AgentRuntimeProvider'
import { useAssistantSessionStore } from '../../assistant/state/AssistantSessionStore'
import { useAuthSession } from '../../app/providers/AuthSessionProvider'
import { usePlatformShell } from '../../app/providers/PlatformShellProvider'
import { useRuntimeConfig } from '../../app/providers/RuntimeConfigProvider'
import type { CreateTenantResponse } from '../../shared/types/api'
import { AuthGateScreen } from './AuthGateScreen'

export function AppShell() {
  const { theme, toggleTheme } = usePlatformShell()
  const { platform, apiBaseUrl } = useRuntimeConfig()
  const auth = useAuthSession()
  const { syncAgentToMode } = useAgentRuntime()
  const { isOpen, mode, open, close, lastProcessedJobId, encounterId } = useAssistantSessionStore(useShallow((state) => ({
    isOpen: state.isOpen,
    mode: state.mode,
    open: state.open,
    close: state.close,
    lastProcessedJobId: state.lastProcessedJobId,
    encounterId: state.encounterId,
  })))
  const [tenantName, setTenantName] = useState('')
  const [isCreatingTenant, setIsCreatingTenant] = useState(false)
  const [tenantCreateError, setTenantCreateError] = useState<string | null>(null)

  const isAuthenticated = auth.status === 'authenticated' && Boolean(auth.session)
  const membershipCount = auth.session?.memberships.length || 0
  const tenantSelectionRequired = isAuthenticated && auth.hasMultipleMemberships && !auth.activeTenantId
  const canUseProtectedRoutes = isAuthenticated && membershipCount > 0 && !tenantSelectionRequired
  const canOpenAssistant = canUseProtectedRoutes

  function handleOpenAssistant() {
    syncAgentToMode('docked')
    open('docked')
  }

  async function handleCreateTenant() {
    if (!tenantName.trim()) {
      setTenantCreateError('Tenant name is required.')
      return
    }

    setIsCreatingTenant(true)
    setTenantCreateError(null)

    try {
      const result = await fetchJson<CreateTenantResponse>(buildApiUrl(apiBaseUrl, '/platform-admin/tenants'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: tenantName.trim() }),
      })

      setTenantName('')
      await auth.refreshSession(result.membership.tenant_id)
    } catch (error) {
      setTenantCreateError(error instanceof Error ? error.message : 'Tenant bootstrap failed.')
    } finally {
      setIsCreatingTenant(false)
    }
  }

  function renderMainContent() {
    return <Outlet />
  }

  if (!canUseProtectedRoutes) {
    return (
      <AuthGateScreen
        status={auth.status}
        error={auth.error}
        session={auth.session}
        activeTenantId={auth.activeTenantId}
        hasMultipleMemberships={auth.hasMultipleMemberships}
        tenantName={tenantName}
        onTenantNameChange={setTenantName}
        onRetry={() => auth.refreshSession()}
        onMicrosoftSignIn={() => window.location.assign(auth.loginUrls.aad)}
        onGoogleSignIn={() => window.location.assign(auth.loginUrls.google)}
        onCreateTenant={handleCreateTenant}
        onSelectTenant={auth.setActiveTenantId}
        isCreatingTenant={isCreatingTenant}
        tenantCreateError={tenantCreateError}
      />
    )
  }

  return (
    <div className="app-shell">
      <aside className="shell-sidebar">
        <div className="shell-brand">
          <img src="/logo.png" alt="Wulo" className="shell-brand-logo" width="36" height="36" />
          <div>
            <p className="shell-eyebrow">Clinical Notes</p>
            <h1>{platform.appTitle}</h1>
          </div>
        </div>

        <nav className="shell-nav">
          <NavLink to="/" end className="shell-nav-link">
            1. Visit Intake
          </NavLink>
          {encounterId ? (
            <NavLink to={`/encounters/${encounterId}/review`} className="shell-nav-link">
              2. Final Review
            </NavLink>
          ) : null}
          {!encounterId ? <span className="shell-nav-link shell-nav-link-disabled">2. Final Review</span> : null}
          {lastProcessedJobId ? (
            <NavLink to={`/jobs/${lastProcessedJobId}`} className="shell-nav-link">
              3. Technical Results
            </NavLink>
          ) : null}
          {!lastProcessedJobId ? <span className="shell-nav-link shell-nav-link-disabled">3. Technical Results</span> : null}
        </nav>

      </aside>

      <div className="shell-content-area">
        <header className="shell-header">
          <div className="shell-header-copy">
            <p className="shell-eyebrow">Clinician workflow</p>
            <h2>Capture, let processing run, then finish the review</h2>
            <p className="shell-header-support">
              Record or upload a visit, review your clinical note, then approve.
            </p>
          </div>

          <div className="shell-header-actions">
            {isAuthenticated && auth.session ? (
              <div className="shell-header-auth">
                <span className="status-pill subtle">{auth.session.name || auth.session.email || 'Authenticated user'}</span>
                {auth.activeMembership ? (
                  <span className="status-pill subtle">{auth.activeMembership.tenant_name} ({auth.activeMembership.role})</span>
                ) : null}
                {auth.hasMultipleMemberships ? (
                  <select
                    className="text-input shell-tenant-select"
                    value={auth.activeTenantId || ''}
                    onChange={(event) => auth.setActiveTenantId(event.target.value || null)}
                    aria-label="Active tenant"
                  >
                    <option value="">Choose tenant</option>
                    {(auth.session.memberships || []).map((membership) => (
                      <option key={membership.tenant_id} value={membership.tenant_id}>
                        {membership.tenant_name} ({membership.role})
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              className="shell-icon-button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {theme === 'dark' ? (
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                  <path
                    d="M12 4.5a1 1 0 0 1 1 1V7a1 1 0 1 1-2 0V5.5a1 1 0 0 1 1-1Zm0 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0 2a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11Zm7-6.5a1 1 0 0 1 1 1 1 1 0 0 1-1 1h-1.5a1 1 0 1 1 0-2H19ZM6.5 12a1 1 0 0 1-1 1H4a1 1 0 1 1 0-2h1.5a1 1 0 0 1 1 1Zm9.096-5.596a1 1 0 0 1 1.414 0l1.06 1.06a1 1 0 0 1-1.414 1.415l-1.06-1.061a1 1 0 0 1 0-1.414Zm-8.192 8.192a1 1 0 0 1 1.414 0 1 1 0 0 1 0 1.414l-1.06 1.06a1 1 0 0 1-1.415-1.414ZM17.01 15.596a1 1 0 0 1 0 1.414l-1.06 1.06a1 1 0 0 1-1.414-1.414l1.06-1.06a1 1 0 0 1 1.414 0ZM8.818 8.818a1 1 0 0 1-1.414 0l-1.06-1.06A1 1 0 0 1 7.758 6.343l1.06 1.06a1 1 0 0 1 0 1.415Z"
                    fill="currentColor"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                  <path
                    d="M14.5 3.5a8.5 8.5 0 1 0 6 14.5 1 1 0 0 1 1.28 1.28A10.5 10.5 0 1 1 13.22 2.22a1 1 0 0 1 1.28 1.28Z"
                    fill="currentColor"
                  />
                </svg>
              )}
            </button>
            {isOpen && canOpenAssistant ? (
              <button
                type="button"
                className="secondary-button shell-ask-button"
                onClick={close}
                aria-label="Hide assistant"
                title="Hide assistant"
              >
                Hide helper
              </button>
            ) : null}
            {!isOpen && canOpenAssistant ? (
              <button type="button" className="secondary-button shell-ask-button" onClick={handleOpenAssistant}>
                Open helper
              </button>
            ) : null}
            {isAuthenticated ? (
              <button type="button" className="secondary-button shell-ask-button" onClick={() => window.location.assign(auth.loginUrls.logout)}>
                Sign out
              </button>
            ) : null}
          </div>
        </header>

        <main className="shell-main">
          {renderMainContent()}
        </main>
      </div>

      <AgentSurfaceHost isOpen={isOpen && canOpenAssistant} mode={mode} onClose={close} />
    </div>
  )
}