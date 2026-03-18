import type { ReactNode } from 'react'
import type { AuthSessionResponse } from '../../shared/types/api'

interface AuthGateScreenProps {
  status: 'loading' | 'authenticated' | 'unauthenticated' | 'error'
  error: string | null
  session: AuthSessionResponse | null
  activeTenantId: string | null
  hasMultipleMemberships: boolean
  tenantName: string
  onTenantNameChange: (value: string) => void
  onRetry: () => void | Promise<void>
  onMicrosoftSignIn: () => void
  onGoogleSignIn: () => void
  onCreateTenant: () => void | Promise<void>
  onSelectTenant: (tenantId: string | null) => void
  isCreatingTenant: boolean
  tenantCreateError: string | null
}

function AuthGateCard({ children }: { children: ReactNode }) {
  return (
    <div className="auth-gate-shell">
      <div className="auth-gate-orb auth-gate-orb-left" aria-hidden="true" />
      <div className="auth-gate-orb auth-gate-orb-right" aria-hidden="true" />
      <section className="auth-gate-card">{children}</section>
    </div>
  )
}

function AuthTrustRow() {
  return (
    <div className="auth-trust-block">
      <div className="auth-divider">
        <span>Enterprise-grade security</span>
      </div>
      <div className="auth-trust-row">
        <span className="auth-trust-pill">SSO protected</span>
        <span className="auth-trust-pill">MFA enabled</span>
        <span className="auth-trust-pill">Tenant isolated</span>
      </div>
    </div>
  )
}

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M3 3h8v8H3V3Zm10 0h8v8h-8V3ZM3 13h8v8H3v-8Zm10 0h8v8h-8v-8Z" fill="currentColor" />
    </svg>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M21.8 12.23c0-.74-.06-1.45-.2-2.13H12v4.03h5.5a4.7 4.7 0 0 1-2.04 3.08v2.55h3.3c1.93-1.78 3.04-4.42 3.04-7.53Z" fill="#4285F4" />
      <path d="M12 22c2.76 0 5.08-.91 6.77-2.46l-3.3-2.55c-.92.61-2.08.97-3.47.97-2.67 0-4.93-1.8-5.74-4.22H2.86v2.63A10 10 0 0 0 12 22Z" fill="#34A853" />
      <path d="M6.26 13.74A5.98 5.98 0 0 1 5.94 12c0-.6.11-1.18.32-1.74V7.63H2.86A10 10 0 0 0 2 12c0 1.61.39 3.14 1.08 4.37l3.18-2.63Z" fill="#FBBC04" />
      <path d="M12 6.04c1.5 0 2.84.52 3.9 1.54l2.92-2.92C17.07 2.99 14.75 2 12 2A10 10 0 0 0 2.86 7.63l3.4 2.63C7.07 7.84 9.33 6.04 12 6.04Z" fill="#EA4335" />
    </svg>
  )
}

function isLocalAuthOrigin() {
  if (typeof window === 'undefined') {
    return false
  }

  return /^(127\.0\.0\.1|localhost)$/i.test(window.location.hostname)
}

export function AuthGateScreen({
  status,
  error,
  session,
  activeTenantId,
  hasMultipleMemberships,
  tenantName,
  onTenantNameChange,
  onRetry,
  onMicrosoftSignIn,
  onGoogleSignIn,
  onCreateTenant,
  onSelectTenant,
  isCreatingTenant,
  tenantCreateError,
}: AuthGateScreenProps) {
  const memberships = session?.memberships || []
  const localAuth = isLocalAuthOrigin()

  if (status === 'loading') {
    return (
      <AuthGateCard>
        <div className="auth-brand-lockup auth-brand-lockup-centered">
          <img src="/logo.png" alt="Wulo" className="auth-brand-logo" width="28" height="28" />
          <strong>Wulo</strong>
        </div>
        <p className="auth-gate-eyebrow">Authentication</p>
        <h1 className="auth-gate-title">Checking your secure workspace</h1>
        <p className="auth-gate-copy">HealthTranscribe is loading your session and protected workspace context.</p>
        <div className="auth-loading-pulse" aria-hidden="true" />
      </AuthGateCard>
    )
  }

  if (status === 'error') {
    return (
      <AuthGateCard>
        <div className="auth-brand-lockup auth-brand-lockup-centered">
          <img src="/logo.png" alt="Wulo" className="auth-brand-logo" width="28" height="28" />
          <strong>Wulo</strong>
        </div>
        <p className="auth-gate-eyebrow">Authentication</p>
        <h1 className="auth-gate-title">We could not load your session</h1>
        <p className="auth-gate-copy">{error || 'The authentication session could not be loaded.'}</p>
        <button type="button" className="auth-provider-button auth-provider-button-primary" onClick={() => void onRetry()}>
          Retry session
        </button>
      </AuthGateCard>
    )
  }

  if (status === 'unauthenticated') {
    return (
      <AuthGateCard>
        <div className="auth-brand-lockup auth-brand-lockup-centered">
          <img src="/logo.png" alt="Wulo" className="auth-brand-logo" width="28" height="28" />
          <strong>Wulo</strong>
        </div>
        <p className="auth-gate-eyebrow">Welcome back</p>
        <h1 className="auth-gate-title">Your clinical workspace is ready</h1>
        <p className="auth-gate-copy">Sign in with your work account to continue into the protected HealthTranscribe workspace.</p>
        {localAuth ? (
          <div className="auth-local-dev-panel">
            <p className="auth-local-dev-title">Local development detected</p>
            <p className="auth-local-dev-copy">
              Easy Auth is not available on the local Functions host. To enter the app locally, restart Azure Functions with `LOCAL_DEV_AUTH=true`, `CORS=http://127.0.0.1:4173`, and `CORSCredentials=true`, then retry the session check.
            </p>
            <button type="button" className="auth-provider-button auth-provider-button-primary" onClick={() => void onRetry()}>
              Recheck session after restart
            </button>
          </div>
        ) : (
          <div className="auth-provider-stack">
            <button type="button" className="auth-provider-button auth-provider-button-secondary" onClick={onGoogleSignIn}>
              <GoogleMark />
              <span>Continue with Google</span>
            </button>
            <button type="button" className="auth-provider-button auth-provider-button-primary" onClick={onMicrosoftSignIn}>
              <MicrosoftMark />
              <span>Continue with Microsoft</span>
            </button>
          </div>
        )}
        <AuthTrustRow />
      </AuthGateCard>
    )
  }

  if (memberships.length === 0) {
    return (
      <AuthGateCard>
        <div className="auth-brand-lockup auth-brand-lockup-centered">
          <img src="/logo.png" alt="Wulo" className="auth-brand-logo" width="28" height="28" />
          <strong>Wulo</strong>
        </div>
        <p className="auth-gate-eyebrow">Tenant access</p>
        <h1 className="auth-gate-title">Create your first secure workspace</h1>
        <p className="auth-gate-copy">This account does not have a tenant membership yet. Create the first workspace now or request access from an existing owner.</p>
        {session?.can_create_tenant ? (
          <div className="auth-create-tenant-form">
            <input
              className="auth-text-input"
              value={tenantName}
              onChange={(event) => onTenantNameChange(event.target.value)}
              placeholder="Workspace name"
            />
            <button type="button" className="auth-provider-button auth-provider-button-primary" onClick={() => void onCreateTenant()} disabled={isCreatingTenant}>
              {isCreatingTenant ? 'Creating workspace...' : 'Create workspace'}
            </button>
          </div>
        ) : null}
        {tenantCreateError ? <p className="auth-inline-error">{tenantCreateError}</p> : null}
      </AuthGateCard>
    )
  }

  if (hasMultipleMemberships && !activeTenantId) {
    return (
      <AuthGateCard>
        <div className="auth-brand-lockup auth-brand-lockup-centered">
          <img src="/logo.png" alt="Wulo" className="auth-brand-logo" width="28" height="28" />
          <strong>Wulo</strong>
        </div>
        <p className="auth-gate-eyebrow">Tenant selection</p>
        <h1 className="auth-gate-title">Choose the workspace for this session</h1>
        <p className="auth-gate-copy">Your account belongs to multiple clinical workspaces. Select the active tenant before the protected workflows open.</p>
        <select className="auth-text-input" value={activeTenantId || ''} onChange={(event) => onSelectTenant(event.target.value || null)}>
          <option value="">Choose workspace</option>
          {memberships.map((membership) => (
            <option key={membership.tenant_id} value={membership.tenant_id}>
              {membership.tenant_name} ({membership.role})
            </option>
          ))}
        </select>
      </AuthGateCard>
    )
  }

  return null
}