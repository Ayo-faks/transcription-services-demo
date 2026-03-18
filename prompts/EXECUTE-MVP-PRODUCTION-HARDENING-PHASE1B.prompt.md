# Execute MVP Production Hardening Plan — Phase 1B

I am working in `/home/ayoola/streaming_agents/transcription-services-demo`.

## Task

Execute **Phase 1B** of the MVP production hardening plan.

You must use the saved plan as the implementation source of truth for this task:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-MVP-PRODUCTION-HARDENING.md`

Repo reality still wins over assumptions. Read the actual files before editing them.

## Objective

Land the next hardening slice after Phase 0 and Phase 1A:

1. tenant-scoped and role-aware backend access enforcement
2. frontend authentication UX and identity visibility
3. tenant selection support for multi-membership users
4. authenticated VoiceLive pre-flight session exchange
5. tenant bootstrap and membership management admin endpoints

This is not a redesign task.

This phase assumes the following are already in place from earlier slices and must be treated as baseline, not reimplemented from scratch:

1. `frontend-react/` is the only supported frontend path
2. `authsettingsV2` and multi-IdP Easy Auth scaffolding exist in Bicep
3. `platform_users`, `platform_tenants`, and `platform_voice_sessions` containers exist in the infra model
4. `_normalize_claims()` and `get_authenticated_context()` already exist in `function_app.py`
5. local-dev auth simulation and auth-aware backend test fixtures already exist
6. ownership fields already exist on encounter and job records

## Required Source Of Truth

Read and follow:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-MVP-PRODUCTION-HARDENING.md`

Focus specifically on:

1. `Codebase State Summary`
2. `Workstream 1: Authentication, Multi-Tenancy, And Access Control`
3. `Strict Execution Order`
4. `Suggested Phase Breakdown`
5. `Verification Checklist`
6. `Remaining Risks`

## Scope For This Execution

Only execute the **Phase 1B** slice from the plan.

The target slice is:

1. tenant- and role-aware read/write enforcement in shared backend access seams
2. frontend auth UX for Easy Auth-backed sign-in and user identity display
3. tenant selector UI and request header propagation for users with multiple memberships
4. pre-flight VoiceLive session token exchange via `POST /api/voice-sessions`
5. admin tenant bootstrap endpoints for tenant creation and membership assignment
6. `DEFAULT_TENANT_ID` bootstrap behavior completed end to end where still missing

Do not begin Workstream 2 or later hardening phases in this task.

## Current Repo Reality You Must Respect

Validate this against the live code before making changes:

1. `function_app.py` already contains `ClinicalRequestContext`, `_normalize_claims()`, local-dev auth simulation, default-tenant membership resolution, and `require_authenticated_request()`.
2. `EncounterSession` and `TranscriptionJob` already have `owner_id` and `tenant_id` fields.
3. Ownership is already stamped on at least some record-creation paths.
4. `get_encounter_or_response()` and `get_job_or_response()` are still the critical seams for tenant and role enforcement.
5. `frontend-react/src/api/client.ts` currently sends plain fetch requests and does not attach `X-Clinical-Tenant-Id`.
6. The React app currently has no login route, no `/.auth/me` bootstrap, no user display, and no tenant selector.
7. `frontend-react/src/assistant/transport/voiceLiveSession.ts` still constructs raw websocket URLs directly and does not do a pre-flight authenticated session exchange.
8. There is no frontend auth state provider yet; extend the existing provider stack instead of replacing it.

If repo reality differs from any of the above, adjust implementation to the repo, not to the assumption.

## Primary Files

You should expect to inspect and update these files:

- `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/api/client.ts`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/App.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/app/router/index.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/shell/layout/AppShell.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/transport/voiceLiveSession.ts`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/transport/AssistantTransport.ts`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/app/providers/AssistantWorkspaceProvider.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/shared/types/api.ts`
- `/home/ayoola/streaming_agents/transcription-services-demo/local.settings.example.json`
- `/home/ayoola/streaming_agents/transcription-services-demo/README.md`
- `/home/ayoola/streaming_agents/transcription-services-demo/tests/retrieval-hardening.spec.cjs`
- `/home/ayoola/streaming_agents/transcription-services-demo/tests/clinician-flow-smoke.spec.cjs`
- `/home/ayoola/streaming_agents/transcription-services-demo/playwright.config.cjs`

You may create narrowly scoped new frontend files when justified, for example:

1. auth state provider
2. login route or login panel component
3. tenant selector component

## Mandatory Constraints

1. Keep the work focused on productionizing the current app, not redesigning it.
2. Do not expand into A2A, MCP, Foundry, or multi-agent architecture.
3. Do not replace Easy Auth with in-code JWT validation.
4. Do not undo or rework the Phase 1A foundations unless the live repo forces a narrow correction.
5. Keep `frontend-react/` as the only supported frontend target.
6. Keep `function_app.py` as the backend source of truth unless a very small helper extraction is necessary.
7. Keep auth token handling cookie-based for HTTP. Do not introduce MSAL token acquisition for API calls.
8. Extend the existing React provider stack. Do not replace it with a monolithic new global store.
9. Do not start request-validation, error-contract, or observability work that belongs to later phases.
10. Preserve `/api/health` as unauthenticated.

## Required Execution Order

Execute in this order unless the repo forces a narrow adjustment:

1. Read the saved plan section for Workstream 1B and the Phase 1B breakdown.
2. Inspect the current backend auth context, record-access helpers, frontend API client, router, shell, and VoiceLive transport.
3. Confirm exactly which 1A elements are already landed so you do not duplicate them.
4. Implement backend tenant and role enforcement in the shared access helpers and any route-level admin guards.
5. Add tenant bootstrap and membership management admin endpoints.
6. Add the authenticated `POST /api/voice-sessions` endpoint and wire the VoiceLive transport to use it.
7. Add frontend auth UX: login entry, identity display, `/.auth/me` bootstrap, and tenant selector for multi-membership users.
8. Attach `X-Clinical-Tenant-Id` through the shared frontend API client layer.
9. Update tests and local/dev auth harness expectations for the new protected flow.
10. Validate the entire slice before stopping.

## Detailed Expectations

### Backend Enforcement

In `function_app.py`:

1. Update `get_encounter_or_response()` and `get_job_or_response()` to enforce tenant and role-aware access.
2. Enforce at minimum the policy described in the saved plan:
   - tenant mismatch returns `403 ACCESS_DENIED`
   - `viewer` and `reviewer` can read any record inside the active tenant
   - `editor` can read tenant records but may only mutate their own records
   - `admin` and `owner` have full tenant-local access
3. Reuse the existing request-context machinery instead of inventing new auth parsing.
4. Keep failure responses on the standardized safe shape already introduced in the repo.
5. Do not leak raw Cosmos or internal exceptions.

### Tenant Bootstrap And Membership Admin APIs

In `function_app.py`:

1. Add `POST /api/admin/tenants`.
2. Add `POST /api/admin/tenants/{tenant_id}/members`.
3. Guard them with active authenticated context and role checks.
4. Support the bootstrap case where a user has no memberships yet and creates the first tenant.
5. Ensure creator auto-assignment to `owner` on tenant creation.
6. If placeholder user creation is required for member assignment by email, keep it narrow and explicit.
7. Use the existing `platform_users` and `platform_tenants` containers.

### VoiceLive Session Exchange

In `function_app.py` and `frontend-react/src/assistant/transport/voiceLiveSession.ts`:

1. Add authenticated `POST /api/voice-sessions`.
2. Store short-lived session documents in `platform_voice_sessions` with TTL-backed expiry.
3. Return a session token and expiry timestamp.
4. Change websocket startup so the browser obtains the token first, then appends it to the websocket URL.
5. Preserve the existing live-audio capture flow and state model.
6. Do not redesign the VoiceLive protocol; this phase only hardens authentication at connection time.

### Frontend Auth UX

In the React app:

1. Add a product-safe login entry that uses Easy Auth endpoints:
   - `/.auth/login/aad`
   - `/.auth/login/google`
2. Call `/.auth/me` on app bootstrap or equivalent entry seam to discover the current session.
3. Surface signed-in user identity in a modest, non-disruptive way.
4. Add logout support via Easy Auth logout route if it fits the current shell cleanly.
5. If the user has multiple memberships, require and expose tenant selection.
6. Keep the app usable when the user has exactly one membership by auto-selecting it.
7. If the user has zero memberships, present a clear bootstrap or access-needed state rather than a broken app shell.

### Shared Frontend Header Propagation

In `frontend-react/src/api/client.ts` and any shared fetch seam:

1. Attach `X-Clinical-Tenant-Id` automatically when an active tenant is selected.
2. Keep request plumbing centralized. Do not hand-code the header in every API module.
3. Preserve same-origin cookie-based auth for HTTP requests.
4. Ensure NDJSON streaming requests and regular JSON requests both use the same tenant header logic.

### Router And Shell Integration

In the router and shell:

1. Integrate auth UX without breaking the current clinician workflow routes.
2. Keep the existing `Visit Intake -> Final Review -> Technical Results` route structure unless a very small auth-only route is justified.
3. Do not turn the app into a dedicated account-management product.
4. Keep assistant controls working after auth bootstrap.

### Test And Local-Dev Updates

Update the local/dev auth-compatible test path so the Phase 1B behavior is verifiable.

At minimum:

1. existing smoke tests still run under `LOCAL_DEV_AUTH=true`
2. tests can inject tenant selection when required
3. protected route expectations match the authenticated flow
4. the new `voice-sessions` path is covered at least at syntax or targeted-flow level if full gateway integration is not locally available

## Verification Requirements

Before finishing, verify all of the following:

1. `get_encounter_or_response()` enforces tenant-local access correctly.
2. `get_job_or_response()` enforces tenant-local access correctly.
3. admin tenant creation works for the bootstrap case.
4. tenant membership assignment works for an existing or placeholder user path.
5. `POST /api/voice-sessions` returns a short-lived token in authenticated local-dev mode.
6. `voiceLiveSession.ts` uses the pre-flight token exchange before opening the websocket.
7. the React app can detect signed-in state via `/.auth/me` or equivalent local-dev-compatible stub path.
8. the React app attaches `X-Clinical-Tenant-Id` through the shared client layer.
9. the React app presents a tenant selector when 2+ memberships exist.
10. the React app builds successfully from `frontend-react/`.
11. updated backend tests and targeted frontend/test harness checks pass.

If full local websocket gateway validation is not possible in this repo environment, explicitly verify the pre-flight token creation path and URL construction path and state what remains external to the repo.

## Validation Loop

For each meaningful change set:

1. inspect the actual file before editing
2. make the smallest coherent update
3. run the relevant validation
4. fix any issues before moving on

## Output Expectations

When complete, report:

1. what Phase 1B changes were implemented
2. which files were changed
3. what validation was run
4. any remaining blockers before Phase 2
5. any external dependencies still needed for full production rollout, such as real Easy Auth provider secrets or gateway-side websocket token validation

## Critical Instruction

Do not execute from summary alone.

Read and follow:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-MVP-PRODUCTION-HARDENING.md`

Then execute only the Phase 1B slice.

Do not stop at analysis unless a genuine blocker prevents implementation.