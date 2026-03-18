# Reflect On And Improve MVP Production Hardening Plan

I am working in `/home/ayoola/streaming_agents/transcription-services-demo`.

## Task

Review the MVP production hardening plan against the current repository state. Identify drift, gaps, completed items, or improvements. Update the plan in-place if changes are needed.

## Plan Location

`/home/ayoola/streaming_agents/transcription-services-demo/PLAN-MVP-PRODUCTION-HARDENING.md`

## Context You Need To Know

This plan has been through multiple review cycles. Here is the architectural context so you do not re-derive it from scratch:

### Architecture Decisions Already Made

1. **Auth: Easy Auth multi-IdP** — Azure App Service Authentication configured with Microsoft Entra ID (`organizations` multi-tenant) and Google identity providers. This is the Azure-native equivalent of the Dex + OAuth2 Proxy pattern used in `project-neo`.
2. **Multi-tenancy from day one** — User/tenant/membership data model in Cosmos DB, adopted from `project-neo`'s `wulo` schema (PostgreSQL). Memberships embedded in user documents (NoSQL denormalization). Containers: `platform_users`, `platform_tenants`, `platform_voice_sessions`.
3. **Tenant resolution** — 0 memberships → null, 1 → auto-select, 2+ → require `X-Clinical-Tenant-Id` header. Ported from `project-neo`'s `resolveActiveTenant()`.
4. **Role model** — owner, admin, editor, reviewer, viewer. Maps to clinical workflows.
5. **No in-code JWT** — Easy Auth validates tokens at platform level. Backend reads `X-MS-CLIENT-PRINCIPAL` headers only.
6. **VoiceLive WS auth** — Pre-flight session token exchange via `POST /api/voice-sessions`, Cosmos TTL container.
7. **Local dev auth** — `LOCAL_DEV_AUTH=true` gated by `AZURE_FUNCTIONS_ENVIRONMENT != "Production"`, fail-closed startup assertion.

### Reference Repo (Auth Pattern Source)

The multi-tenant auth pattern was adopted from `/home/ayoola/project-neo/cbam-ui/apps/api/src/auth/`. Key files if you need to cross-reference:
- `context.ts` — `buildContext()`, `upsertUser()`, `resolveActiveTenant()`, `RequestContext` interface
- `verifyJwt.ts` — JWT verification via `jose` (not needed in our case — Easy Auth handles this)
- `../env.ts` — Zod-validated OIDC env vars
- `../../packages/db/migrations/005_wulo_control_plane.sql` — tenants, users, memberships, sessions, audit_log schema

### Current Repo State (key facts)

- **Backend:** `function_app.py` (~5500 lines), `func.AuthLevel.ANONYMOUS` on all routes, no auth, no ownership, no tenant isolation
- **Frontend:** `frontend-react/` (Vite + React 19 + Zustand + React Router), no MSAL, no login flow
- **Infra:** `infra/main.bicep` (Cosmos DB serverless, Storage, Speech, Language, OpenAI, AI Search, managed identity RBAC, App Insights)
- **CI/CD:** 4 GitHub Actions workflows — frontend workflows still reference deleted `frontend/` directory (broken)
- **Old `frontend/` directory:** Deleted. Only `frontend-react/` exists.

## Mandatory Audit Steps

Do NOT skip these. Read the actual code before making judgments.

### Step 1 — Check for codebase drift

Read and compare the plan's "Codebase State Summary" section against the real files:

1. `function_app.py` — Has auth been added since the plan was written? Check line ~26 for `AuthLevel`, check for any `get_authenticated_context`, `owner_id`, `tenant_id` references.
2. `frontend-react/src/App.tsx` — Has an auth provider been added? Is there a login page or tenant selector?
3. `frontend-react/src/api/client.ts` — Are auth headers or `X-Clinical-Tenant-Id` being attached?
4. `frontend-react/src/assistant/transport/voiceLiveSession.ts` — Has the WS URL been updated to include session tokens?
5. `infra/main.bicep` — Has `authsettingsV2` been added? Are `platform_users`/`platform_tenants` containers defined? Is CORS restricted?
6. `.github/workflows/deploy-frontend.yml` and `.github/workflows/deploy-all.yml` — Do they target `frontend-react/` now?
7. `requirements.txt` — Has `azure-monitor-opentelemetry` been added?

If any workstream tasks have been completed in code, mark them as done in the plan and update the "Codebase State Summary" accordingly.

### Step 2 — Validate workstream accuracy

For each of the 7 workstreams, check:

1. Are the "Primary targets" (file paths, line numbers) still correct? Line numbers shift as the file is edited.
2. Are the code snippets in the plan still valid Python/TypeScript/Bicep? Check for syntax issues or deprecated patterns.
3. Are the exit criteria testable and specific?
4. Is anything missing that you discovered in Step 1?

### Step 3 — Validate resolved risks

The plan has a "Remaining Risks" section formatted as a resolved reference table. For each of the 6 risks:

1. Has the mitigation been implemented in code? If yes, move from "mitigated" to "resolved" and note what was done.
2. Is the mitigation still the right approach given any changes to the codebase?
3. Are there any NEW risks that have emerged from code changes since the last review?

### Step 4 — Check execution order

Review the "Strict Execution Order" and "Suggested Phase Breakdown" sections:

1. Is the order still correct given any completed work?
2. Should any phases be collapsed or reordered?
3. Is the Phase 1 deliverables list still accurate and achievable as a single phase, or should it be split?

### Step 5 — Cross-reference project-neo

If the auth implementation has started, check whether the patterns faithfully follow the project-neo source:

1. Does `get_authenticated_context()` follow `buildContext()` logic?
2. Does `_normalize_claims()` handle both Microsoft and Google correctly?
3. Does tenant resolution match `resolveActiveTenant()` behavior?
4. Does the data model match the `wulo` schema intent (adapted for Cosmos DB)?

## Review Questions

Answer internally before making changes:

1. Does the plan still accurately describe the current repo state, or has the code moved ahead of the plan?
2. Are there completed items that should be checked off?
3. Are there new gaps or blockers that emerged from recent code changes?
4. Is the plan too large for MVP? Should anything be deferred?
5. Are the Bicep/IaC changes feasible with the current `main.bicep` structure?
6. Is the 20-item verification checklist still the right set of criteria?
7. Has the file grown so large that Workstream 1 should be broken into sub-phases?

## What To Improve

If changes are needed, edit the plan directly. Possible improvements:

1. Update "Codebase State Summary" to reflect current reality
2. Mark completed tasks within workstreams
3. Fix stale line numbers or file references
4. Add newly discovered gaps or blockers
5. Remove items that have been overtaken by events
6. Simplify or split oversized phases
7. Tighten exit criteria that are too vague
8. Update the "Remaining Risks" table if risks are resolved or new ones appear

## Non-Negotiable Constraints

1. Keep the review focused on productionizing the current working app.
2. Do not expand scope into A2A, MCP, Foundry, or multi-agent architecture.
3. Do not remove the multi-tenant or multi-IdP auth architecture — it is a confirmed decision.
4. Do not replace Easy Auth with in-code JWT — that decision is resolved.
5. Keep `frontend-react/` as the primary frontend.
6. Keep `function_app.py` as the backend unless a specific split is needed and justified.
7. Do not create new plan documents. Update the existing plan in-place.

## Expected Output

When finished, provide a concise summary:

1. **Drift found:** What changed in the repo since the plan was last updated?
2. **Items completed:** Which workstream tasks are now done in code?
3. **Plan changes made:** What did you update in the plan?
4. **New risks or gaps:** Anything new that needs attention?
5. **Next recommended action:** What should be implemented next based on the execution order?

## Execution Instruction

1. Read the plan first: `PLAN-MVP-PRODUCTION-HARDENING.md`
2. Audit the codebase per the 5 mandatory steps above
3. Update the plan in-place if needed
4. Report your findings

If the plan is not optimized enough for the current repo state, improve it directly.

Do not stop at analysis alone unless no justified improvement is needed.