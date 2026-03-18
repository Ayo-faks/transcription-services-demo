# MVP Production Hardening Plan

> **Last reviewed:** 2026-03-16 against live repo state (post React MVP and retrieval-hardening changes).

## Objective

Take the current working HealthTranscribe application to a production-ready MVP without introducing the full A2A, MCP, Microsoft Agent Framework, or Foundry-based multi-agent redesign.

This plan is intentionally narrow.

It is limited to hardening the current product that already:

1. captures audio via live ambient scribe or file upload
2. processes jobs and encounters through transcription, medical analysis, and AI summary
3. generates structured clinical results with encounter-scoped search-backed context
4. renders results in the React frontend at `frontend-react/`

## Out Of Scope

The following are explicitly out of scope for this MVP plan:

1. multi-agent orchestration
2. Foundry orchestrator migration
3. A2A protocol integration
4. MCP tool registry rollout
5. patient-longitudinal platform design
6. live payer, scheme, prior-auth, or treatment integrations
7. full action execution workflows beyond current product-safe previews
8. refactoring `function_app.py` into multiple modules (deferred until after hardening)
9. migrating to a different hosting model (e.g., Container Apps)
10. backend rate limiting (post-MVP — will require WAF or API Management layer)

Those belong in the future architecture plans, not in the MVP production hardening track.

## Codebase State Summary

This section documents the actual state of the codebase as observed during the last review. All workstream details are grounded in these facts.

### Backend (`function_app.py`, ~5500 lines, single module)

1. **Authentication:** All routes use `func.AuthLevel.ANONYMOUS`. No auth middleware exists. No user identity is extracted or propagated.
2. **Ownership:** Neither `EncounterSession` nor `TranscriptionJob` carries a `user_id` or `owner_id` field. Any caller can read or modify any record.
3. **Input validation:** Route parameters (`encounter_id`, `job_id`) are still used directly without UUID format validation. `get_request_json()` only falls back to `{}` on invalid JSON; there is still no schema validation or JSON body size enforcement. The `upload` endpoint still reads the entire file into memory with `file.read()` and has no max-size gate.
4. **State transitions:** Some transitions are implicitly guarded (e.g., `upload` rejects encounters in `PROCESSING` or `COMPLETED` state). Most route handlers set status unconditionally without checking the current state first (e.g., `start_encounter_capture` sets `CAPTURING` regardless of current status).
5. **Error responses:** Inconsistent shape. Most routes return `{"error": str(e)}` which leaks internal exception detail. No correlation IDs. No machine-readable error codes.
6. **Health check:** `GET /api/health` returns `{"status": "healthy"}` unconditionally. It does not probe Cosmos DB, Storage, Speech, or any other dependency.
7. **Concurrency:** Partial progress exists. `draft_version` is now checked on `PUT /api/encounters/{encounter_id}/draft` and `POST /api/encounters/{encounter_id}/finalize`, and the repo has Playwright coverage for that path. The rest of the write surface still has no generalized optimistic concurrency or standardized `409` contract.
8. **Logging:** Uses basic `logger.error(f"...")` with inconsistent fields. No structured logging dimensions (user, encounter, job, stage).
9. **CORS:** `main.bicep` and `function-only.bicep` still set `allowedOrigins: ['*']`. `local.settings.example.json` still sets `CORS: "*"`.
10. **Encounter context endpoint:** `GET /api/encounters/{encounter_id}/context` already exists with query, category, assertion filtering, AI Search integration, and a `context_version` field. The field currently behaves more like freshness metadata than an explicit API contract version.
11. **Operational context endpoint:** `GET /api/encounters/{encounter_id}/operational-context` already exists (uses mock providers), and `POST /api/encounters/{encounter_id}/actions/preview` already exists for preview-only actions.
12. **Assistant query endpoint:** `POST /api/encounters/{encounter_id}/assistant/query` already exists with NDJSON streaming.
13. **Ambient ingest endpoints:** The backend already exposes `audio-session/start`, `audio-session/chunks`, `audio-session/finalize`, and `audio-session/abort` for staged browser capture, but there is still no authenticated `/api/voice-sessions` token exchange for VoiceLive websocket auth.
14. **Existing helper patterns:** `get_required_service_config()`, `get_encounter_or_response()`, `get_job_or_response()`, and `get_request_json()` provide reusable seams for auth, validation, and error-contract work.

### Frontend (`frontend-react/`)

1. **Router:** 4 routes — `/` (UploadPage), `/ambient-scribe` (AmbientScribePage), `/jobs/:jobId` (ResultsPage), `/encounters/:encounterId/review` (EncounterReviewPage).
2. **Auth:** No MSAL, no Entra ID, no login UI, and no tenant selector. All API calls are unauthenticated. The root `package-lock.json` contains stale MSAL packages, but the React app does not use them.
3. **Error handling:** Basic `error` state variables and `error-banner` divs exist in UploadPage, EncounterReviewPage, and AssistantShell. No structured retry affordances. No global error boundary.
4. **State management:** Zustand store (`AssistantSessionStore`) manages encounter and assistant state. Well-structured but has no auth-related fields.
5. **API layer:** `frontend-react/src/api/` has `client.ts`, `encountersApi.ts`, `jobsApi.ts`, `summaryApi.ts`. Shared types in `frontend-react/src/shared/types/api.ts`. No auth headers or `X-Clinical-Tenant-Id` header are attached anywhere.
6. **Context contracts:** The React app already has `EncounterContextProvider`, `OperationalContextProvider`, and typed context response models. Workstream 7 is therefore contract-hardening work, not greenfield UI wiring.
7. **Config surface drift:** The active runtime config entrypoint is `frontend-react/public/config.js`, but helper scripts and docs still reference the deleted `frontend/config.js` path.

### Infrastructure and Deployment

1. **Bicep:** `infra/main.bicep` provisions Storage, Cosmos DB (serverless, `disableLocalAuth: true`), Speech, Language, OpenAI, AI Search, Function App with managed identity, Application Insights, and a frontend static website storage account. RBAC roles are assigned. `authsettingsV2` is not present, only the `transcriptions` container is defined, and CORS is still wildcarded.
2. **GitHub Actions:** 4 workflows — `deploy-all.yml`, `deploy-infrastructure.yml`, `deploy-function.yml`, `deploy-frontend.yml`.
3. **Critical gap — frontend deploy targets deleted directory:** Both `deploy-all.yml` and `deploy-frontend.yml` reference the old `frontend/` directory which has been deleted. The primary React app at `frontend-react/` has never been deployed via CI/CD. This is a day-one production blocker.
4. **No build step for React app:** The `deploy-frontend.yml` workflow uploads static files directly. The React app at `frontend-react/` requires `npm run build` before deployment. No workflow step exists for this.
5. **`local.settings.json` is gitignored:** Verified. Secrets are not committed.
6. **Application Insights is provisioned** in `main.bicep` and the instrumentation key is passed to the Function App settings.
7. **Smoke test in CI:** The function deploy does a `/api/health` curl after deploy, but the health endpoint is trivial (always returns healthy).
8. **No rollback documentation** exists anywhere in the repository.
9. **Local helper drift:** `configure-frontend.sh`, `configure-frontend.ps1`, and parts of `README.md` still write or describe `frontend/config.js`, which no longer exists.
10. **Test harness drift:** The Playwright/API specs in `tests/` still assume anonymous backend access. Auth rollout will require a coordinated local-dev auth harness or authenticated end-to-end environment.

## Definition Of MVP Success

The MVP is successful when the current application can be deployed and operated in production with:

1. enterprise-grade multi-IdP authentication (Microsoft Entra ID + Google) via Easy Auth
2. multi-tenant data isolation with organisation-scoped encounters and jobs
3. role-based access control (owner, admin, editor, reviewer, viewer) within tenants
4. user upsert and tenant membership resolution on every request (adopted from `project-neo`)
5. encounter and job ownership enforcement with tenant boundary checks
6. validated and bounded inputs with safe error responses
7. reliable upload, ambient capture, processing, and results flows
8. dependency-aware health checks and structured logging
9. production deployment pipeline that targets the correct frontend
10. documented rollback procedure
11. audit trail for clinical data access and state changes with user and tenant identity
12. Google email login functional for developer testing

## Current Product Scope To Preserve

The current app has two workflow families and both must continue working:

1. **File upload flow:** UploadPage → create encounter → upload audio → automatic processing → EncounterReviewPage
2. **Ambient capture flow:** AmbientScribePage → create encounter → live capture → stop → processing → EncounterReviewPage

Additionally, the standalone job-based flow (ResultsPage at `/jobs/:jobId`) must continue to work for legacy jobs.

The backend source of truth remains:

1. `function_app.py` (single-module, ~5500 lines)

The primary frontend target remains:

1. `frontend-react/` (Vite + React 19 + Zustand + React Router)

## Non-Negotiable Constraints

1. Do not rewrite the app into a new agent architecture during this plan.
2. Do not break the existing working upload or encounter flows.
3. Do not introduce large backend refactors before the app is secured and observable.
4. Do not invent patient aggregation before a real patient key exists.
5. Keep the React app as the primary frontend.
6. Keep backend changes minimal and production-driven.
7. Prefer helper seams and typed contracts over broad architectural churn.
8. Do not leak internal exception messages to API callers.

## MVP Workstreams

### Workstream 1: Authentication, Multi-Tenancy, And Access Control

#### Goal

Implement enterprise-grade authentication with multi-identity-provider support, multi-tenant data isolation, and ownership enforcement — modelled on the proven auth architecture in the `project-neo` codebase and adapted for Azure Functions with Cosmos DB.

#### Current state

- `AuthLevel.ANONYMOUS` is configured at the app level in `function_app.py`
- No user identity extraction or propagation
- No `user_id` / `owner_id` on `EncounterSession` or `TranscriptionJob`
- CORS allows all origins in both bicep and local config
- Frontend has no MSAL or login flow
- No tenant model — all data lives in a single flat namespace
- No role-based access control
- Browser capture already uses backend audio-session endpoints, but no authenticated `/api/voice-sessions` exchange exists for websocket auth
- Existing API and Playwright tests assume anonymous access and will need to move with the auth rollout

#### Architecture decision: Easy Auth multi-IdP + multi-tenant (resolved)

Use **Azure App Service Authentication (Easy Auth)** configured with **multiple identity providers** as the edge authentication gateway. This is the Azure-native equivalent of the Dex + OAuth2 Proxy pattern used in `project-neo` (Kubernetes). Easy Auth natively supports Microsoft, Google, and any OIDC provider — eliminating the need for a self-hosted OIDC broker.

Adopt **`project-neo`'s multi-tenant logical architecture** (user upsert, membership resolution, role enforcement, tenant-scoped queries) translated from Fastify/PostgreSQL to Python/Cosmos DB.

**Why Easy Auth multi-IdP (not Dex + OAuth2 Proxy):**
- The app runs on Azure Functions, not Kubernetes. Easy Auth is the managed edge auth gateway — functionally equivalent to OAuth2 Proxy + Nginx `auth_request`.
- Easy Auth handles token validation at the platform level. The backend reads injected identity headers (`X-MS-CLIENT-PRINCIPAL`, `X-MS-CLIENT-PRINCIPAL-ID`, `X-MS-CLIENT-PRINCIPAL-NAME`). No JWT validation library in the 5500-line monolith.
- Easy Auth natively supports Microsoft + Google identity providers, matching `project-neo`'s Dex connector configuration (Microsoft `organizations` tenant + Google OAuth 2.0).
- `/api/health` is excluded from auth via `authsettingsV2` route-level rules in Bicep.

**Why multi-tenant from day one (adopted from `project-neo`):**
- Clinical data is inherently organisation-scoped. A GP practice, hospital trust, or clinic is a tenant.
- Retro-fitting tenancy (as `project-neo` did in migration `006_tenantize_projects.sql` with a legacy backfill tenant) is costly. It is cheaper to build the boundary now.
- The membership model (`owner`, `admin`, `editor`, `reviewer`, `viewer`) maps directly to clinical workflows (lead clinician, supervising consultant, transcriptionist, clinical coder, read-only auditor).

**Identity provider configuration:**

| Provider | Easy Auth config key | Use case | `project-neo` equivalent |
|---|---|---|---|
| Microsoft Entra ID | `identityProviders.azureActiveDirectory` | Enterprise SSO (NHS, trusts, practices) | Dex `microsoft` connector, `tenant: organizations` |
| Google | `identityProviders.google` | Developer testing, personal Google accounts | Dex `google` connector |

**Multi-tenant data model (Cosmos DB, adapted from `project-neo` `wulo` schema):**

```
Container: platform_users        (partition key: /issuer_subject)
─────────────────────────────────────────────────────────────────
{
  "id": "<uuid>",
  "issuer": "https://login.microsoftonline.com/...",  // or "https://accounts.google.com"
  "issuer_subject": "<sub claim>",
  "email": "clinician@nhs.net",
  "name": "Dr Jane Smith",
  "memberships": [                                    // embedded (denormalized for Cosmos DB)
    {
      "tenant_id": "<uuid>",
      "tenant_name": "City General Hospital",
      "tenant_slug": "city-general",
      "role": "editor"
    }
  ],
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-15T10:00:00Z"
}

Container: platform_tenants      (partition key: /id)
─────────────────────────────────────────────────────────────────
{
  "id": "<uuid>",
  "name": "City General Hospital",
  "slug": "city-general",
  "status": "active",                                 // active | suspended | deleted
  "isolation_mode": "shared",                         // shared | dedicated (future)
  "created_at": "2025-01-15T10:00:00Z"
}

Existing containers (encounters, jobs) — add fields:
─────────────────────────────────────────────────────────────────
+ "owner_id": "<user uuid>",
+ "tenant_id": "<tenant uuid>"
```

**Note:** Memberships are embedded in the user document (NoSQL denormalization). In `project-neo`, memberships are a separate PostgreSQL table with foreign keys — that pattern doesn't apply to Cosmos DB. A clinician will typically belong to 1–3 organisations, so the embedded array is bounded and efficient.

**Auth context pattern (adapted from `project-neo` `context.ts`):**

```python
@dataclass
class ClinicalRequestContext:
    """Equivalent of project-neo's RequestContext interface."""
    user_id: str           # platform_users document id
    tenant_id: str | None  # resolved active tenant (None if no memberships)
    role: str | None       # role within active tenant
    correlation_id: str    # generated per request (UUID)
    email: str | None      # from identity provider claims
    name: str | None       # from identity provider claims
    identity_provider: str # "aad" or "google"
```

**Tenant resolution logic (ported from `project-neo` `resolveActiveTenant()`):**

```
0 memberships → tenant_id = None, role = None (user exists but has no org)
1 membership  → auto-select that tenant (no header required)
2+ memberships → read X-Clinical-Tenant-Id header
                 → if missing or not in memberships → 400 TENANT_REQUIRED
                 → if valid → select that tenant and its role
```

**Role hierarchy (adapted from `project-neo` `wulo.memberships` CHECK constraint):**

| Role | Clinical mapping | Permissions |
|---|---|---|
| `owner` | Practice manager / Trust IT lead | Full admin, tenant settings, member management |
| `admin` | Clinical lead | Member management, all encounters |
| `editor` | Clinician (GP, consultant) | Create/edit own encounters, view team encounters |
| `reviewer` | Supervising consultant / Clinical coder | Read all encounters, approve, annotate |
| `viewer` | Auditor / Compliance officer | Read-only access to all encounters |

#### Required work

**1a. Enable Easy Auth multi-IdP in Bicep:**

Add `authsettingsV2` to `main.bicep` with:
- Microsoft identity provider: `clientId` from parameter, `openIdIssuer` set to `https://login.microsoftonline.com/organizations/v2.0` (multi-tenant, matching `project-neo`'s `tenant: organizations`), `requireAuthentication: true`, `unauthenticatedClientAction: 'Return401'`
- Google identity provider: `clientId` and `clientSecret` from Key Vault references (matching `project-neo`'s `google-client-id` and `google-client-secret` in `dex-secrets`)
- Exclude `/api/health` from authentication via `excludedPaths`
- Set `defaultAuthorizationPolicy.defaultProvider` to `azureactivedirectory`

**1b. Create `platform_users`, `platform_tenants`, and `platform_voice_sessions` containers in Bicep:**

Add to `main.bicep` alongside existing Cosmos DB containers. `platform_users` uses `/issuer_subject` partition key. `platform_tenants` uses `/id` partition key. `platform_voice_sessions` uses `/id` partition key with `defaultTtl: 900`.

**1b-i. Mitigate cross-partition query impact on existing containers (fixes Risk 2):**

The existing `transcriptions` container uses `/id` as partition key. After adding `tenant_id` to encounters and jobs, listing "all encounters for tenant X" requires a cross-partition query. At MVP scale (single-digit tenants, <10k documents) this is acceptable with Cosmos serverless, but the following guardrails prevent it from becoming a production problem:

1. **Add a composite index** to the `transcriptions` container for `(tenant_id, created_at DESC)` to optimize the most common tenant-scoped listing query:

```bicep
resource cosmosContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-11-15' = {
  parent: cosmosDatabase
  name: 'transcriptions'
  properties: {
    resource: {
      id: 'transcriptions'
      partitionKey: { paths: ['/id'], kind: 'Hash' }
      indexingPolicy: {
        compositeIndexes: [
          [
            { path: '/tenant_id', order: 'ascending' }
            { path: '/created_at', order: 'descending' }
          ]
        ]
      }
    }
  }
}
```

2. **Always pass `tenant_id` in WHERE clauses** for listing queries. Never query without a tenant filter. This bounds the cross-partition scan to documents matching the tenant.

3. **Set `MaxItemCount` on listing queries** (page size = 50) to prevent unbounded responses. The frontend already receives paged results.

4. **Add a monitoring alert** (Workstream 3): if Cosmos RU consumption per query exceeds 50 RU on any list endpoint, log a warning with the query shape. This provides early warning before scale becomes painful.

5. **Post-MVP migration path** (documented but not executed now): if any single tenant exceeds 50k encounters, create a `tenant_encounters` container partitioned by `/tenant_id` and migrate listing queries to it. The Cosmos DB change feed can sync records between containers. This is the same approach `project-neo` used with `tenantize_projects` migration — cheaper to have the escape hatch designed now than to scramble later.

**1c. Add `get_authenticated_context(req)` helper (the core auth middleware):**

This is the Python equivalent of `project-neo`'s `buildContext()` function in `context.ts`. It:
1. Reads `X-MS-CLIENT-PRINCIPAL-ID` and `X-MS-CLIENT-PRINCIPAL-NAME` from Easy Auth injected headers. Returns 401 if missing.
2. Decodes `X-MS-CLIENT-PRINCIPAL` base64 header to extract `identity_provider`, `user_claims` (email, name, sub, iss).
3. **Normalizes identity provider claims** (see 1c-i below).
4. Upserts user into `platform_users` container (equivalent of `project-neo`'s `upsertUser()` — INSERT with ON CONFLICT on `issuer` + `issuer_subject`, mapped to Cosmos DB upsert on `issuer_subject` partition).
5. Reads user memberships from the embedded array.
6. Resolves active tenant using the same 0/1/2+ logic as `project-neo`'s `resolveActiveTenant()`.
7. Returns a `ClinicalRequestContext` dataclass.

**1c-i. Identity provider claim normalization (fixes Risk 5):**

Microsoft and Google return different claim schemas in the `X-MS-CLIENT-PRINCIPAL` base64 JSON payload. The helper must normalize both into a common shape before user upsert.

```python
# Microsoft Entra ID claims in X-MS-CLIENT-PRINCIPAL:
#   identity_provider: "aad"
#   claims: [
#     { "typ": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier", "val": "<oid>" },
#     { "typ": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress", "val": "user@org.com" },
#     { "typ": "name", "val": "Jane Smith" },
#     { "typ": "http://schemas.microsoft.com/identity/claims/identityprovider", "val": "https://login.microsoftonline.com/..." }
#   ]
#
# Google claims in X-MS-CLIENT-PRINCIPAL:
#   identity_provider: "google"
#   claims: [
#     { "typ": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier", "val": "<google-sub>" },
#     { "typ": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress", "val": "user@gmail.com" },
#     { "typ": "name", "val": "Jane Smith" }
#   ]

CLAIM_TYPE_MAP = {
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier": "sub",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress": "email",
    "name": "name",
}

ISSUER_MAP = {
    "aad": "https://login.microsoftonline.com",
    "google": "https://accounts.google.com",
}

def _normalize_claims(principal: dict) -> dict:
    """Normalize Microsoft and Google claims into a common {sub, email, name, issuer} shape."""
    idp = principal.get("identity_provider", principal.get("identityProvider", ""))
    claims_list = principal.get("claims", principal.get("user_claims", []))

    normalized = {}
    for claim in claims_list:
        typ = claim.get("typ", claim.get("type", ""))
        val = claim.get("val", claim.get("value", ""))
        key = CLAIM_TYPE_MAP.get(typ)
        if key:
            normalized[key] = val

    normalized["issuer"] = ISSUER_MAP.get(idp, idp)
    normalized["identity_provider"] = idp
    return normalized
```

This must be unit-tested with fixtures from both providers. Capture real `X-MS-CLIENT-PRINCIPAL` payloads from Microsoft and Google during initial testing and commit sanitized versions as test fixtures.

**1c-ii. Local development auth simulation (fixes Risk 6):**

Easy Auth does not run locally with Azure Functions Core Tools. The `get_authenticated_context()` helper must support local development without compromising production security.

```python
LOCAL_DEV_AUTH = os.environ.get("LOCAL_DEV_AUTH", "").lower() == "true"
AZURE_FUNCTIONS_ENVIRONMENT = os.environ.get("AZURE_FUNCTIONS_ENVIRONMENT", "Production")

def get_authenticated_context(req: func.HttpRequest) -> ClinicalRequestContext | func.HttpResponse:
    principal_header = req.headers.get("X-MS-CLIENT-PRINCIPAL")

    if principal_header:
        # Production path — Easy Auth injected the header
        principal = json.loads(base64.b64decode(principal_header))
        claims = _normalize_claims(principal)
        # ... upsert user, resolve tenant, return context

    elif LOCAL_DEV_AUTH and AZURE_FUNCTIONS_ENVIRONMENT != "Production":
        # Local dev path — accept manually injected test headers
        # SAFETY: both conditions must be true — env var set AND not Production
        user_id = req.headers.get("X-MS-CLIENT-PRINCIPAL-ID")
        user_name = req.headers.get("X-MS-CLIENT-PRINCIPAL-NAME", "Local Developer")
        if not user_id:
            return func.HttpResponse(
                json.dumps({"error": "Missing X-MS-CLIENT-PRINCIPAL-ID header", "code": "AUTH_REQUIRED"}),
                status_code=401, mimetype="application/json"
            )
        # Build a synthetic context for local dev
        return ClinicalRequestContext(
            user_id=user_id,
            tenant_id=os.environ.get("DEFAULT_TENANT_ID"),
            role="admin",  # local dev gets admin for convenience
            correlation_id=str(uuid.uuid4()),
            email=f"{user_name.lower().replace(' ', '.')}@localhost",
            name=user_name,
            identity_provider="local-dev",
        )

    else:
        return func.HttpResponse(
            json.dumps({"error": "Authentication required", "code": "AUTH_REQUIRED"}),
            status_code=401, mimetype="application/json"
        )
```

**Fail-closed guarantee:** The `LOCAL_DEV_AUTH` path is only reachable when BOTH `LOCAL_DEV_AUTH=true` AND `AZURE_FUNCTIONS_ENVIRONMENT != "Production"`. In Azure, `AZURE_FUNCTIONS_ENVIRONMENT` is always `"Production"` by default for production slots. The Bicep template must NOT set `LOCAL_DEV_AUTH` in any deployed environment. Add a startup assertion:

```python
if LOCAL_DEV_AUTH and AZURE_FUNCTIONS_ENVIRONMENT == "Production":
    raise RuntimeError("FATAL: LOCAL_DEV_AUTH=true is forbidden in Production. Remove from app settings.")
```

`local.settings.json` (gitignored) should include:
```json
{
  "Values": {
    "LOCAL_DEV_AUTH": "true",
    "DEFAULT_TENANT_ID": "00000000-0000-0000-0000-000000000001",
    "AZURE_FUNCTIONS_ENVIRONMENT": "Development"
  }
}
```

**1d. Add `owner_id` and `tenant_id` fields to data models:**

Add `owner_id` and `tenant_id` to both `EncounterSession` and `TranscriptionJob` dataclasses and their `to_dict()`/`from_dict()` methods.

**1e. Set ownership and tenancy on record creation:**

In `create_encounter()` and `upload_audio()`, set `owner_id = ctx.user_id` and `tenant_id = ctx.tenant_id` from the `ClinicalRequestContext`.

**1f. Add ownership and tenant-scoped access checks:**

Modify `get_encounter_or_response()` and `get_job_or_response()` to:
- Verify `tenant_id` matches the caller's active tenant (403 if mismatch)
- For `viewer` and `reviewer` roles: allow read access to any encounter within the tenant
- For `editor` role: allow read access to all tenant encounters, write access only to own encounters
- For `admin` and `owner` roles: full access within the tenant

**1g. Restrict CORS:**

Replace `allowedOrigins: ['*']` in both bicep files with the actual frontend origin URL (parameterized by environment).

**1h. Frontend auth integration:**

- Add login page with Microsoft and Google sign-in buttons (redirects to `/.auth/login/aad` and `/.auth/login/google` respectively)
- Call `/.auth/me` after login to get user claims and display user identity
- Add tenant selector UI if user has 2+ memberships (sends `X-Clinical-Tenant-Id` header)
- Attach auth cookies automatically (same-origin — no explicit token management needed for HTTP)

**1h-i. VoiceLive WebSocket authentication (fixes Risk 1):**

The `AmbientVoiceSession` in `frontend-react/src/assistant/transport/voiceLiveSession.ts` opens a raw WebSocket via `new WebSocket(wsUrl)`. The browser WebSocket API cannot send `Authorization` headers or Easy Auth cookies to a different-origin gateway.

**Implementation — pre-flight session token exchange:**

Backend — add `POST /api/voice-sessions` (authenticated):
```python
@app.function_name("create_voice_session")
@app.route(route="voice-sessions", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
async def create_voice_session(req: func.HttpRequest) -> func.HttpResponse:
    ctx = get_authenticated_context(req)
    if isinstance(ctx, func.HttpResponse):
        return ctx

    # Generate a short-lived session token (15 min TTL)
    session_token = str(uuid.uuid4())
    expires_at = datetime.utcnow() + timedelta(minutes=15)

    # Store in Cosmos DB (platform_voice_sessions container, TTL-enabled)
    session_doc = {
        "id": session_token,
        "user_id": ctx.user_id,
        "tenant_id": ctx.tenant_id,
        "expires_at": expires_at.isoformat(),
        "ttl": 900,  # Cosmos DB TTL in seconds — auto-deletes after 15 min
    }
    container = cosmos_client.get_database_client(db_name).get_container_client("platform_voice_sessions")
    container.upsert_item(session_doc)

    return func.HttpResponse(
        json.dumps({"session_token": session_token, "expires_at": expires_at.isoformat()}),
        status_code=201, mimetype="application/json"
    )
```

Frontend — modify `buildAssistantWsUrl()` in `voiceLiveSession.ts`:
```typescript
// Before opening WebSocket, call the authenticated endpoint
const resp = await fetch('/api/voice-sessions', { method: 'POST', credentials: 'include' })
const { session_token } = await resp.json()

// Append token as query parameter
function buildAssistantWsUrl(config: VoiceLiveRuntimeConfig, clientId: string, sessionToken: string) {
  const baseUrl = /* ...existing URL construction... */
  const url = new URL(baseUrl)
  url.searchParams.set('session_token', sessionToken)
  return url.toString()
}
```

Gateway validation — the VoiceLive gateway must validate the `session_token` query parameter against the Cosmos DB `platform_voice_sessions` container on WebSocket upgrade. If the gateway is a third-party service that cannot query Cosmos DB, the session token should be a signed JWT with embedded user_id/tenant_id/expiry that the gateway can validate with a shared secret.

Bicep — add `platform_voice_sessions` container with `defaultTtl: 900` (15 min auto-cleanup):
```bicep
resource voiceSessionsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-11-15' = {
  parent: cosmosDatabase
  name: 'platform_voice_sessions'
  properties: {
    resource: {
      id: 'platform_voice_sessions'
      partitionKey: { paths: ['/id'], kind: 'Hash' }
      defaultTtl: 900
    }
  }
}
```

**1i. Keep `/api/health` unauthenticated for probes.**

**1j. Add tenant management seed endpoint (admin-only, fixes Risk 4):**

`POST /api/admin/tenants` and `POST /api/admin/tenants/{tenant_id}/members` — protected by `owner` or `admin` role — to create tenants and assign memberships. For MVP, this can be a simple admin API; a full tenant management UI is post-MVP.

**Implementation — tenant seeding API:**

```python
@app.function_name("create_tenant")
@app.route(route="admin/tenants", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
async def create_tenant(req: func.HttpRequest) -> func.HttpResponse:
    ctx = get_authenticated_context(req)
    if isinstance(ctx, func.HttpResponse):
        return ctx
    # Only platform-level admins (users with 'owner' role on any existing tenant)
    # or users with no memberships yet (bootstrapping first tenant) can create tenants
    if ctx.role not in ("owner", "admin") and len(user_memberships) > 0:
        return error_response(403, "Only owners/admins can create tenants", "ACCESS_DENIED", ctx.correlation_id)

    body = get_request_json(req)
    tenant = {
        "id": str(uuid.uuid4()),
        "name": body["name"],
        "slug": body["slug"],
        "status": "active",
        "isolation_mode": "shared",
        "created_at": datetime.utcnow().isoformat(),
    }
    container = cosmos_client.get_database_client(db_name).get_container_client("platform_tenants")
    container.create_item(tenant)

    # Auto-add the creator as 'owner' of the new tenant
    # Update the user's memberships array in platform_users
    # ...

    return func.HttpResponse(json.dumps(tenant), status_code=201, mimetype="application/json")
```

```python
@app.function_name("add_tenant_member")
@app.route(route="admin/tenants/{tenant_id}/members", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
async def add_tenant_member(req: func.HttpRequest) -> func.HttpResponse:
    ctx = get_authenticated_context(req)
    if isinstance(ctx, func.HttpResponse):
        return ctx
    tenant_id = req.route_params["tenant_id"]
    # Must be owner or admin of the target tenant
    if ctx.tenant_id != tenant_id or ctx.role not in ("owner", "admin"):
        return error_response(403, "Only tenant owners/admins can manage members", "ACCESS_DENIED", ctx.correlation_id)

    body = get_request_json(req)
    # body: { "email": "clinician@nhs.net", "role": "editor" }
    # Look up user by email in platform_users, add membership to their document
    # If user doesn't exist yet, create a placeholder (they'll be fully populated on first login)
    # ...
```

**Bootstrap sequence for initial deployment:**

1. Deploy with Easy Auth enabled. First user to log in gets a `platform_users` document with empty memberships.
2. Use `DEFAULT_TENANT_ID` env var: if set and the user has 0 memberships, auto-assign them to that tenant with `editor` role on first login. This bootstraps the initial org without needing seed scripts.
3. The first user then calls `POST /api/admin/tenants` to create the real tenant, becoming its `owner`.
4. Subsequent users are added via `POST /api/admin/tenants/{id}/members` with their email.

**`local.settings.example.json` update:**
```json
{
  "Values": {
    "DEFAULT_TENANT_ID": "00000000-0000-0000-0000-000000000001"
  }
}
```

This auto-assignment must log an audit event: `{ action: "auto_membership_assigned", tenant_id, user_id, role: "editor", reason: "DEFAULT_TENANT_ID" }`.

**1k. Update local tooling and tests for auth-enabled development:**

- Update `configure-frontend.sh`, `configure-frontend.ps1`, and `README.md` to treat `frontend-react/public/config.js` as the only supported runtime config entrypoint.
- Introduce an auth-compatible local/dev test path using `LOCAL_DEV_AUTH=true` plus injected `X-MS-CLIENT-PRINCIPAL-*` headers, or an equivalent authenticated fixture strategy.
- Update `tests/retrieval-hardening.spec.cjs` and `tests/clinician-flow-smoke.spec.cjs` so they can run after anonymous access is removed.
- Update deploy smoke tests to expect `401` for protected routes once Easy Auth is active.

#### Environment variables (new, adapted from `project-neo` `env.ts`)

| Variable | Description | `project-neo` equivalent |
|---|---|---|
| `MICROSOFT_PROVIDER_CLIENT_ID` | Entra ID app registration client ID | `OIDC_AUDIENCE` (Dex client) |
| `MICROSOFT_PROVIDER_CLIENT_SECRET` | Entra ID app registration secret | `microsoft-client-secret` in `dex-secrets` |
| `GOOGLE_PROVIDER_CLIENT_ID` | Google OAuth 2.0 client ID | `google-client-id` in `dex-secrets` |
| `GOOGLE_PROVIDER_CLIENT_SECRET` | Google OAuth 2.0 client secret | `google-client-secret` in `dex-secrets` |
| `ALLOWED_ORIGIN` | Frontend origin for CORS | N/A (was `*`) |
| `DEFAULT_TENANT_ID` | Optional — auto-assign new users to a default tenant for testing | N/A |

All secrets stored in Azure Key Vault and referenced via `@Microsoft.KeyVault(...)` syntax in Function App settings (matching `project-neo`'s Kubernetes `wulo-auth-secrets` and `dex-secrets` pattern but using Azure-native secret management).

#### Primary targets

- `function_app.py`: app auth level, request-context helpers, encounter/job dataclasses, access helpers, route handlers
- `infra/main.bicep`: `authsettingsV2`, CORS config, new Cosmos DB containers, Key Vault secret references
- `infra/function-only.bicep`: CORS config
- `frontend-react/src/api/client.ts`: attach `X-Clinical-Tenant-Id` header
- `frontend-react/src/App.tsx`: add auth check and tenant selector
- `configure-frontend.sh`, `configure-frontend.ps1`, `README.md`: remove legacy `frontend/config.js` assumptions
- `tests/retrieval-hardening.spec.cjs`, `tests/clinician-flow-smoke.spec.cjs`: move to auth-aware execution
- New: login page component, tenant selector component

#### Exit criteria

1. Anonymous access is rejected on all routes except `/api/health`
2. Both Microsoft and Google identity providers are configured and functional
3. First-time login upserts a user record in `platform_users` (matching `project-neo`'s user upsert)
4. Tenant resolution follows the 0/1/2+ membership logic from `project-neo`
5. Encounter and job reads return 403 if caller is not in the owning tenant
6. Role-based write restrictions are enforced (`viewer` cannot create encounters, `editor` cannot modify others' encounters)
7. Auth failures return `{"error": "...", "code": "AUTH_REQUIRED"}`, `{"error": "...", "code": "ACCESS_DENIED"}`, or `{"error": "...", "code": "TENANT_REQUIRED"}` consistently
8. CORS rejects requests from unauthorized origins
9. Google login works for developer testing with personal email accounts
10. `_normalize_claims()` passes unit tests with both Microsoft and Google `X-MS-CLIENT-PRINCIPAL` fixture payloads
11. Local dev auth works with `LOCAL_DEV_AUTH=true` and manual header injection
12. Local dev auth is fail-closed: startup assertion crashes if `LOCAL_DEV_AUTH=true` and `AZURE_FUNCTIONS_ENVIRONMENT=Production`
13. VoiceLive WebSocket connects successfully with a pre-flight session token
14. `platform_voice_sessions` container auto-deletes expired tokens (TTL=900s verified)
15. Tenant creation via admin API works; creator is auto-assigned `owner` role
16. `DEFAULT_TENANT_ID` auto-assigns first-time users with 0 memberships for bootstrap scenarios
17. Composite index on `(tenant_id, created_at DESC)` is deployed on the `transcriptions` container

### Workstream 2: Request Validation And Data Integrity

#### Goal

Ensure backend contracts are validated and state transitions are safe.

#### Current state

- Route params (`encounter_id`, `job_id`) are used without UUID format validation
- `get_request_json()` parses the body but does no schema validation
- `file.read()` in `upload_audio()` reads the entire body with no size limit (memory DoS vector)
- `start_encounter_capture()` sets `CAPTURING` without checking current status
- `draft_version` is already used for optimistic concurrency in `save_encounter_draft()` and `finalize_encounter_draft()`, but conflict responses are ad hoc and other write flows remain unguarded
- Some routes check encounter status (e.g., `upload_audio` rejects PROCESSING/COMPLETED), but most do not

#### Required work

1. Add a `validate_uuid(value, label)` helper that returns a 400 response for malformed IDs. Apply to all route handlers that accept `encounter_id` or `job_id`.
2. Add a `validate_encounter_transition(encounter, target_status)` helper that defines a valid-transitions map and returns a 409 response for invalid transitions. Apply to `start_capture`, `stop_capture`, `finalize`, `process`, `approve`.
3. Add a max file size check in `upload_audio()` before calling `file.read()`. Reject with 413 if exceeded (suggested limit: 100MB).
4. Add `Content-Length` header check before reading JSON bodies. Reject bodies over 1MB with 413.
5. Standardize optimistic concurrency: keep the existing `expected_draft_version` checks on `PUT /api/encounters/{encounter_id}/draft` and `POST /api/encounters/{encounter_id}/finalize`, return a stable `CONFLICT` error code, and extend version checks to any other write flows that can race.
6. Add required-field validation for `POST /api/encounters/{encounter_id}/segments` (segments must be non-empty, each segment must have `text`).

#### Primary targets

- `function_app.py`: `get_request_json()`, `upload_audio()`, `start_encounter_capture()`, `save_encounter_draft()`, `finalize_encounter_draft()`, `append_encounter_segments()`
- `tests/retrieval-hardening.spec.cjs`: preserve and extend concurrency coverage
- `frontend-react/src/shared/types/api.ts`: add encounter-status type guards if needed

#### Exit criteria

1. Malformed UUIDs are rejected with 400 and a stable error code
2. Audio uploads over the size limit are rejected with 413 before reading the body
3. JSON bodies over 1MB are rejected with 413
4. Invalid status transitions return 409 with `INVALID_TRANSITION` error code
5. Concurrent draft/finalize edits are detected and return 409 with `CONFLICT` error code, and other racing writes are guarded where needed

### Workstream 3: Error Contracts And Observability

#### Goal

Make failures diagnosable and production operation measurable.

#### Current state

- Error responses are inconsistent: `{"error": str(e)}` in most handlers, which leaks internal detail
- No correlation IDs on any request or response
- Logging uses `logger.error(f"...")` with inconsistent fields — no structured dimensions
- `/api/health` always returns healthy regardless of dependency state
- Application Insights is provisioned in Bicep and the instrumentation key is set, but the backend does not use structured telemetry (no `opencensus` or `azure-monitor-opentelemetry` integration)

#### Required work

1. Create a standard `error_response(status_code, message, code, correlation_id, details=None)` helper. Use it in all route handlers. Never return raw `str(e)` to callers — log the full exception internally, return a safe message externally.
2. Generate a `correlation_id` (UUID) at the start of every request. Include it in the error response and in every log line for that request.
3. Add structured log fields: `correlation_id`, `encounter_id`, `job_id`, `user_id`, `route`, `processing_stage`. Use `logger.info(msg, extra={...})` or Python dict-style structured logging.
4. Expand `/api/health` to probe: Cosmos DB connectivity (read a sentinel doc or list with limit 1), Storage Account reachability (list containers), and return degraded status per dependency.
5. Integrate `azure-monitor-opentelemetry` or `opencensus-ext-azure` so structured logs and request traces flow to Application Insights automatically.
6. Define baseline alert rules: error rate > 5% over 5 minutes, p95 latency > 10s, health check failure.

#### Suggested error contract

```json
{
  "error": "Human-readable message (safe for UI display)",
  "code": "MACHINE_READABLE_CODE",
  "correlationId": "uuid",
  "details": {}
}
```

#### Primary targets

- `function_app.py`: every route handler's `except` block, the health check function, logging setup
- `requirements.txt`: add `azure-monitor-opentelemetry` or `opencensus-ext-azure`
- `host.json`: logging configuration

#### Exit criteria

1. Every backend error response includes a `correlationId` and a safe `error` message
2. Internal exception details are logged but never returned to callers
3. All structured logs include `correlation_id`, `encounter_id` (when applicable), and `user_id`
4. `/api/health` returns degraded status when Cosmos DB or Storage is unreachable
5. Request traces and structured logs appear in Application Insights

### Workstream 4: Deployment Pipeline And Runtime Hardening

#### Goal

Ensure the app can be deployed safely with the correct artifacts and operated predictably.

#### Current state

- `deploy-frontend.yml` and `deploy-all.yml` reference the deleted `frontend/` directory — deployment is completely broken
- No `npm ci && npm run build` step exists for the React app in any workflow
- The function deploy workflow does a trivial health check (always passes because `/api/health` always returns healthy)
- No rollback documentation exists
- `main.bicep` is comprehensive (managed identity, RBAC, all services, App Insights)
- `function-only.bicep` has `cors: { allowedOrigins: ['*'] }` which must be tightened
- `configure-frontend.sh`, `configure-frontend.ps1`, and `README.md` still reference `frontend/config.js` even though `frontend-react/public/config.js` is the active runtime config file

#### Required work

1. **Fix frontend deployment pipeline:** Update `deploy-frontend.yml` and `deploy-all.yml` to:
   - Target `frontend-react/` (the old `frontend/` directory has been deleted)
   - Run `npm ci && npm run build` to produce the Vite build output
  - Deploy the `frontend-react/dist/` directory to the static website container
  - Inject `config.js` with the correct `apiBaseUrl` into `frontend-react/public/config.js` before build, or into the built output in a controlled post-build step
   - Update workflow trigger paths from `frontend/**` to `frontend-react/**`
  - Remove all remaining writes to `frontend/config.js`
2. **Tighten CORS:** Replace `allowedOrigins: ['*']` in both bicep files with the actual frontend origin URL (parameterized by environment).
3. **Add production config validation:** Create a startup check in `function_app.py` (or a dedicated `/api/health/deep` endpoint) that fails fast if required environment variables are missing or contain placeholder values.
4. **Document rollback procedure:** Write a RUNBOOK.md covering: how to redeploy a previous function zip, how to swap frontend versions, how to restore Cosmos DB from backup.
5. **Add meaningful post-deploy smoke tests:** After the function deploy, test at least `POST /api/encounters` (expect 401 after auth is added) and `GET /api/health` (expect deep dependency check). After the frontend deploy, verify the landing page returns 200.
6. **Remove unsafe defaults:** Verify that no workflow or bicep template falls back to `*` for CORS or uses placeholder secret values in production.

#### Primary targets

- `.github/workflows/deploy-frontend.yml`: full rewrite of build/deploy steps
- `.github/workflows/deploy-all.yml`: frontend step rewrite
- `infra/main.bicep`: CORS parameter
- `infra/function-only.bicep`: CORS parameter
- `configure-frontend.sh`, `configure-frontend.ps1`, `README.md`: remove legacy frontend path references
- New file: `RUNBOOK.md`

#### Exit criteria

1. CI/CD builds and deploys `frontend-react/` (not `frontend/`)
2. Production CORS only allows the actual frontend origin
3. Deployment fails fast on missing required config
4. Rollback procedure is documented
5. Post-deploy smoke tests cover at least health and one functional endpoint

### Workstream 5: Audit And Compliance Foundations

#### Goal

Introduce the minimum audit and compliance controls required for production use of clinical data.

#### Current state

- `EncounterSession` has an `events` list and `append_encounter_event()` is called on major state transitions (created, capture_started, capture_stopped, processing_started, review_approved, etc.)
- These events are stored inline in the Cosmos DB encounter document
- There is no separate audit log, no tamper-evident storage, and no retention policy
- No data deletion or export capability exists

#### Required work

1. Review and extend `append_encounter_event()` usage — ensure every read (GET encounter, GET results, GET context) also logs an access event (can be a structured log line rather than an inline event, to avoid bloating the encounter document).
2. Add `user_id` and `tenant_id` to all audit events (depends on Workstream 1). This mirrors `project-neo`'s `wulo.audit_log` table which includes `tenant_id`, `user_id`, `action`, `target`, and `payload_json`.
3. Consider a dedicated `platform_audit_log` Cosmos DB container (partitioned by `/tenant_id`) for high-volume audit events that should not bloat encounter documents. Structure: `{ tenant_id, user_id, action, target_type, target_id, payload, created_at }`.
4. Document data retention and deletion expectations in a DATA-POLICY.md. This must cover: how long encounters and jobs are retained, how deletion requests are handled, where audio blobs are stored and how they are expired.
5. Confirm UK data residency posture: all Bicep resources use `uksouth` as the default location parameter. Document this explicitly.
6. Ensure `disableLocalAuth: true` remains on Cosmos DB, Speech, and Language resources in the Bicep template (already true — verify and document).

**5-i. Audio blob lifecycle management (fixes Risk 3):**

Audio blobs are uploaded to Azure Storage via `get_blob_client()` with `upload_blob(overwrite=True)` and no TTL. Blobs accumulate indefinitely under `encounters/{encounter_id}/captured-audio.wav` and `encounters/{encounter_id}/chunks/*.wav` and job uploads. This is a compliance and cost risk.

**Implementation — Storage lifecycle management policy in Bicep:**

```bicep
resource storageLifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'audio-tier-to-cool'
          enabled: true
          type: 'Lifecycle'
          definition: {
            actions: {
              baseBlob: {
                tierToCool: { daysAfterModificationGreaterThan: 30 }
              }
            }
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['encounters/']
            }
          }
        }
        {
          name: 'audio-tier-to-archive'
          enabled: true
          type: 'Lifecycle'
          definition: {
            actions: {
              baseBlob: {
                tierToArchive: { daysAfterModificationGreaterThan: 90 }
              }
            }
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['encounters/']
            }
          }
        }
        {
          name: 'audio-delete-expired'
          enabled: true
          type: 'Lifecycle'
          definition: {
            actions: {
              baseBlob: {
                delete: { daysAfterModificationGreaterThan: 365 }
              }
            }
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['encounters/']
            }
          }
        }
      ]
    }
  }
}
```

**Policy summary:**
- 0–30 days: Hot tier (active encounters)
- 30–90 days: Cool tier (recent archive)
- 90–365 days: Archive tier (compliance retention)
- 365+ days: Auto-deleted

These thresholds must be confirmed against UK clinical data retention requirements in DATA-POLICY.md. NHS guidance typically requires 8 years for adult records — if that applies, change the delete threshold to `2920` (8 years) and add a disclaimer that blob-level deletion does not remove Cosmos DB metadata (separate cleanup needed).

**Primary target:** `infra/main.bicep` — add `managementPolicies` resource linked to the existing storage account.

#### Exit criteria

1. Every encounter access and state change produces an auditable event (either in-document or structured log)
2. All audit events include `user_id`, `tenant_id`, `encounter_id`, `timestamp`, and `action`
3. Data retention and deletion expectations are documented
4. UK data residency posture is documented and verified in the Bicep template
5. Audio blob lifecycle policy is deployed and verified (blobs tier and delete per policy)

### Workstream 6: Frontend Reliability And UX Hardening

#### Goal

Make the current React app safe and understandable for production users.

#### Current state

- `UploadPage` has basic error display (`error-banner`) but no retry button on failure
- `EncounterReviewPage` loads encounter data with error/loading states but has no retry on load failure
- `ResultsPage` has polling for status updates but no explicit error recovery
- `AssistantShell` shows an error banner but the assistant query has no retry affordance
- No global error boundary exists — an unhandled render error crashes the entire app
- Processing poll intervals are hardcoded and do not back off

#### Required work

1. Add a React Error Boundary at the `App` or `AppShell` level to catch unhandled render errors and show a recoverable error screen.
2. Add retry buttons on `UploadPage` (upload failure), `EncounterReviewPage` (load failure), and `ResultsPage` (load failure).
3. Add exponential backoff to processing status polling in `EncounterReviewPage` and `ResultsPage`.
4. Ensure the assistant query in `AssistantShell` has a visible "Try again" button on `turn.failed` responses.
5. Prevent double-submission: disable submit buttons immediately on click and re-enable only on completion or failure (already partially done in `UploadPage` with `isSubmitting` — verify and extend to all mutation actions).

#### Primary targets

- `frontend-react/src/App.tsx` or `frontend-react/src/shell/layout/AppShell.tsx`: error boundary
- `frontend-react/src/features/upload/UploadPage.tsx`: retry on failure
- `frontend-react/src/features/encounters/EncounterReviewPage.tsx`: retry on load, backoff on poll
- `frontend-react/src/features/results/ResultsPage.tsx`: retry on load, backoff on poll
- `frontend-react/src/assistant/shell/AssistantShell.tsx`: retry on query failure

#### Exit criteria

1. Unhandled render errors show a recoverable error screen instead of a white page
2. All critical backend failures surface clearly in the UI with a retry option
3. Processing polls use exponential backoff
4. All mutation buttons prevent double-submission

### Workstream 7: Stabilize Encounter Context Contract

#### Goal

Ensure the existing encounter context endpoint is stable, typed, and ready for production assistant use.

#### Current state

- `GET /api/encounters/{encounter_id}/context` already exists with query, category, assertion, and limit parameters
- It integrates with AI Search and returns structured context items with provenance
- `GET /api/encounters/{encounter_id}/operational-context` exists and returns mock operational context
- The frontend already calls both endpoints via `AssistantTransport` and `EncounterContextProvider`
- The frontend already has shared TypeScript types for the context payloads
- The backend already returns `context_version`, but it currently tracks data freshness rather than an explicit API contract version

#### Required work

1. Freeze and document the current response schema for `GET /api/encounters/{encounter_id}/context` as the v1 contract. Clarify whether `context_version` is retained as freshness metadata and add an explicit semantic contract version if needed.
2. Add response validation: ensure the endpoint always returns the documented shape even when the encounter has no processed job or no indexed context.
3. Ensure the operational context endpoint returns a stable shape even with empty data (no null fields where arrays are expected).
4. Keep `frontend-react/src/shared/types/api.ts` aligned with the documented v1 contract and remove any mismatch between backend field names and frontend assumptions.
5. Do not introduce streaming chat or multi-agent runtime in this workstream.

#### Primary targets

- `function_app.py`: `get_encounter_context()`, `get_operational_context()`
- `frontend-react/src/shared/types/api.ts`: response types
- New file: `docs/encounter-context-v1-contract.md` (optional but recommended)

#### Exit criteria

1. The context endpoint exposes a documented, explicit contract versioning scheme without breaking the current frontend
2. Empty encounters return a valid response with zero items (not an error)
3. Frontend types match the backend response shape
4. No breaking changes occur without a version bump

## Strict Execution Order

The execution order should be:

1. **Workstream 4 (deployment pipeline) — partial, frontend-only:** Fix the frontend deploy pipeline first so that all subsequent changes can actually be deployed. Do CORS tightening in this step too.
2. **Workstream 1A (authentication foundations):** Land Easy Auth, request context, local-dev auth, and auth-aware test harness updates before deeper backend hardening.
3. **Workstream 1B (tenant enforcement and frontend auth):** Add ownership, tenant scoping, role checks, tenant selector, admin bootstrap, and VoiceLive token exchange.
4. **Workstream 2 (request validation and data integrity):** Harden inputs once the boundary is secure.
5. **Workstream 3 (error contracts and observability):** Make failures diagnosable.
6. **Workstream 5 (audit and compliance):** Add audit trail (depends on user identity from Workstream 1).
7. **Workstream 4 (deployment pipeline) — remainder:** Add smoke tests, rollback docs, and production validation now that backend hardening is in place.
8. **Workstream 6 (frontend reliability):** Harden the UI.
9. **Workstream 7 (encounter context contract):** Stabilize the contract last, after all backend behavior is settled.

Do not jump ahead to future architecture work before the earlier workstreams are complete.

## Suggested Phase Breakdown

### Phase 0 — Unblock deployment (Workstream 4, partial)

Deliver:

1. Frontend CI/CD targets `frontend-react/` with `npm run build`
2. CORS tightened in bicep templates
3. Helper scripts and docs stop referencing `frontend/config.js`

This phase unblocks all subsequent phases.

### Phase 1A — Auth foundations (Workstream 1A)

Deliver:

1. Easy Auth with Microsoft + Google identity providers via `authsettingsV2` in Bicep
2. `platform_users`, `platform_tenants`, `platform_voice_sessions` Cosmos DB containers provisioned
3. Composite index `(tenant_id, created_at DESC)` on existing `transcriptions` container
4. `_normalize_claims()` helper with Microsoft/Google claim mapping + unit test fixtures
5. User upsert and `ClinicalRequestContext` via `get_authenticated_context()`
6. Tenant membership resolution (0/1/2+ rule from `project-neo`)
7. `LOCAL_DEV_AUTH` simulation with fail-closed production assertion
8. Auth-aware local/dev test harness for existing Playwright/API specs
9. Key Vault references for all auth secrets

### Phase 1B — Tenant enforcement and auth UX (Workstream 1B)

Deliver:

1. Ownership and `tenant_id` fields on encounters and jobs
2. Tenant-scoped, role-based access enforcement in route helpers
3. Frontend login page (Microsoft + Google buttons), tenant selector, auth headers
4. VoiceLive pre-flight session token exchange (`POST /api/voice-sessions`)
5. Admin endpoints for tenant creation and membership management
6. `DEFAULT_TENANT_ID` auto-assignment for first-user bootstrap

### Phase 2 — Harden backend contracts (Workstream 2)

Deliver:

1. UUID validation on all route params
2. Payload and file size limits
3. Encounter state transition guards
4. Optimistic concurrency on draft updates

### Phase 3 — Harden diagnostics (Workstream 3)

Deliver:

1. Standardized error responses (no internal detail leaks)
2. Correlation IDs on all requests
3. Structured logging with encounter/job/user dimensions
4. Dependency-aware health check
5. Azure Monitor telemetry integration

### Phase 4 — Audit, compliance, and deploy hardening (Workstreams 4 remainder + 5)

Deliver:

1. Audit events with user identity
2. Data retention documentation
3. Rollback procedure documentation
4. Post-deploy smoke tests
5. Production config validation

### Phase 5 — Frontend reliability (Workstream 6)

Deliver:

1. Global error boundary
2. Retry affordances on all critical flows
3. Exponential backoff on polls
4. Double-submission prevention

### Phase 6 — Contract stabilization (Workstream 7)

Deliver:

1. Versioned encounter context endpoint
2. Stable response shapes for empty data
3. Frontend types matching backend contract

## Verification Checklist

Before declaring MVP production-ready, verify:

1. All protected routes require authentication via Easy Auth (Microsoft or Google)
2. Google login works — a developer can sign in with a personal Google email and access the app
3. Microsoft Entra ID login works — an enterprise user can sign in with their org account
4. First-time login creates a user record in `platform_users` with correct issuer/subject/email/name
5. Users with 2+ tenant memberships see a tenant selector and must choose before proceeding
6. User ownership and tenant isolation are enforced on encounters and jobs
7. Role-based access is enforced: `viewer` cannot create encounters, `editor` cannot modify others' encounters
8. All POST and PUT routes reject invalid payloads with stable error codes
9. Malformed UUIDs and oversize payloads are rejected before processing
10. Draft or encounter concurrency conflicts are handled with 409 responses
11. All backend errors return correlation IDs and safe messages (no `str(e)`)
12. Health check returns degraded status when a required dependency is unavailable
13. Structured logs appear in Application Insights with encounter, job, user, and tenant dimensions
14. Audit events exist for encounter access and state changes with user identity
15. CI/CD builds and deploys `frontend-react/` correctly, and local tooling only writes `frontend-react/public/config.js`
16. Production CORS only allows the actual frontend origin
17. Deployment can be rolled back using documented procedure
18. Critical frontend flows show clear errors with retry options
19. The encounter context endpoint returns a stable, versioned response shape
20. All secrets (Microsoft client secret, Google client secret) are stored in Key Vault, not in app settings directly, and auth-enabled tests still have a supported execution path

## Resolved Decisions

1. **Easy Auth multi-IdP + multi-tenant (resolved):** Use Azure App Service Authentication (Easy Auth) configured with **Microsoft Entra ID** (multi-tenant: `organizations`) and **Google** identity providers. This is the Azure-native equivalent of the Dex + OAuth2 Proxy pattern proven in `project-neo`. Easy Auth handles token validation at the platform level; the backend reads injected identity headers. Multi-tenancy data model (`platform_users`, `platform_tenants`, embedded memberships) and tenant resolution logic (0/1/2+ membership rule) are adopted from `project-neo`'s `wulo` schema and `context.ts`. See Workstream 1 for full implementation details.
2. **Old `frontend/` directory (resolved):** Deleted. All deployment workflows must be updated to target `frontend-react/` exclusively.
3. **Rate limiting (deferred to post-MVP):** No rate limiting exists. Will require a WAF or API Management layer. Explicitly out of scope.
4. **5500-line monolith (deferred to post-MVP):** Splitting `function_app.py` into modules is deferred. Hardening will add ~300-500 lines of helper code (auth context, tenant resolution, audit); the file remains manageable at ~6000 lines for MVP but should be split promptly after.
5. **In-code JWT vs platform auth (resolved):** No in-code JWT validation library. `project-neo` uses `jose` for JWT verification because Kubernetes has no managed auth gateway. Azure Functions has Easy Auth which handles this at the platform level. The backend reads `X-MS-CLIENT-PRINCIPAL` headers — never touches raw JWTs.
6. **Google testing capability (resolved):** Easy Auth Google identity provider configured alongside Microsoft. Developers and testers can sign in with personal Google accounts. No B2C or External ID needed — Easy Auth multi-IdP is sufficient.

## Remaining Risks (open until implemented)

| # | Risk | Current status | Planned mitigation | Workstream |
|---|---|---|---|---|
| 1 | **VoiceLive WebSocket auth** — browser WS API cannot send auth headers or cookies cross-origin | Open | Pre-flight session token exchange via `POST /api/voice-sessions`; token appended as WS query param; Cosmos `platform_voice_sessions` container with 15-min TTL auto-cleanup | WS 1B, task 1h-i |
| 2 | **Cosmos DB partition strategy** — `/id` partition key means cross-partition queries for tenant-scoped listings | Open, acceptable at MVP scale only after index + query guardrails land | Composite index on `(tenant_id, created_at DESC)`; always filter by `tenant_id`; page size capped at 50; RU monitoring alert; documented post-MVP escape hatch (dedicated container if >50k encounters per tenant) | WS 1A, task 1b-i |
| 3 | **Audio blob lifecycle** — blobs accumulate with no TTL or tier transitions | Open | Storage lifecycle management policy: Hot→Cool at 30d, Cool→Archive at 90d, delete at 365d (confirm against NHS retention guidance); Bicep `managementPolicies` resource | WS 5, task 5-i |
| 4 | **Tenant provisioning** — no self-service signup or invitation flow | Open | Admin API (`POST /api/admin/tenants`, `POST /api/admin/tenants/{id}/members`); `DEFAULT_TENANT_ID` auto-assignment for bootstrapping; creator auto-added as `owner`; audit logged | WS 1B, task 1j |
| 5 | **Identity provider claim normalization** — Microsoft and Google return different claim schemas in `X-MS-CLIENT-PRINCIPAL` | Open | `_normalize_claims()` with `CLAIM_TYPE_MAP` and `ISSUER_MAP` dicts; unit-tested with captured fixtures from both providers | WS 1A, task 1c-i |
| 6 | **Local dev auth simulation** — Easy Auth does not run with Functions Core Tools | Open | `LOCAL_DEV_AUTH=true` env var gated by `AZURE_FUNCTIONS_ENVIRONMENT != "Production"`; fail-closed startup assertion crashes if both are true; synthetic `ClinicalRequestContext` for local dev | WS 1A, task 1c-ii |
| 7 | **Auth rollout will break current local tests and smoke paths** — current Playwright/API specs assume anonymous access | New | Land auth-aware local/dev fixtures and update smoke expectations in the same phase as Easy Auth rollout | WS 1A, task 1k |
| 8 | **Legacy frontend path drift** — workflows, scripts, and docs still reference deleted `frontend/` assets | New | Remove all references to `frontend/` and converge on `frontend-react/public/config.js` + `frontend-react/dist/` everywhere | WS 4, Phase 0 |

These risks are intentionally pulled forward into implementation tasks. None of them is resolved in the live code yet.

## Deliverables

The deliverables of this MVP plan are:

1. A secure, multi-tenant, multi-IdP authenticated production app (Microsoft + Google via Easy Auth)
2. Multi-tenant data model with user upsert, membership resolution, and role-based access (architecture adopted from `project-neo`)
3. Validated and hardened backend contracts with safe error responses
4. Structured logging, correlation IDs, and dependency-aware health checks in Application Insights
5. A working CI/CD pipeline that builds and deploys the React frontend
6. Documented rollback procedure and data retention policy
7. Reliable frontend error handling with retry affordances and tenant selector UI
8. A versioned encounter context contract ready for production assistant use
9. Admin API for tenant and membership management
10. Auth-compatible local/dev test and smoke-test path

## Final Guidance

Do not confuse the MVP plan with the future architecture plan.

For MVP, the objective is not to build the final agent platform.

For MVP, the objective is to make the current working product safe, supportable, and production-ready.

Only after that should the app move into the broader A2A + MCP + Agent Framework + Foundry evolution.