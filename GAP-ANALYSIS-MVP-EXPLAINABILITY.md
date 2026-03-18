# Repo Gap Analysis: MVP Hardening + Encounter-Local Explainability Graph

> **Generated:** 2026-03-17 — evidence-based analysis against current repo state.

---

## Phase 0: Target State Confirmation

### Two target outcomes

1. **Finish MVP production hardening** of the current encounter-centric application.
2. **Add an encounter-local explainability graph layer** (SQLite + JSON1 + FTS5) as an additive substrate.

### Explicitly out of scope

- A2A protocol integration
- MCP rollout
- Foundry orchestrator migration
- Multi-agent composition beyond current chat-agent + voice-agent
- Patient-longitudinal modeling
- Live payer, scheme, prior-auth, or treatment integrations

---

## Phase 1: Backend Inventory

**File:** `function_app.py` (7163 lines, 34 endpoints)

| Surface | Status | Evidence | Notes |
|---|---|---|---|
| Auth/session handling | **Done** | `get_authenticated_context()` L1194, `require_authenticated_request` decorator L1267, `ClinicalRequestContext` dataclass L603, `_normalize_claims()` with AAD+Google mapping, `LOCAL_DEV_AUTH` fail-closed guard L29-32 | Full Easy Auth multi-IdP + multi-tenant. `GET /api/auth/session` L4941 returns session payload. |
| Encounter routes | **Done** | 22 encounter-scoped endpoints (L4964-L6362): CRUD, capture, segments, audio-session, draft, finalize, process, context, operational-context, actions/preview, assistant/query, results, review, approve, regenerate | Complete encounter lifecycle. |
| Audio-session ingest | **Done** | `audio-session/start` L5248, `chunks` L5320, `finalize` L5396, `abort` L5503 | Staged chunked upload with session tracking, WAV assembly, transcription, cleanup. 100MB max. |
| Draft/finalize/process | **Done** | `PUT draft` L5572 with `expected_draft_version` optimistic concurrency, `POST finalize` L5707 with version check, `POST process` L5760 with status guards | Draft versioning and conflict detection implemented. |
| Results and review | **Done** | `GET results` L6131, `PUT review` L6179, `POST approve` L6240, `POST regenerate` L6295 | Full review lifecycle with status transitions. |
| Context and assistant | **Done** | `GET context` L5900 (AI Search integration, provenance, contract_version v1), `POST assistant/query` L6058 (NDJSON streaming with citations), `GET operational-context` L5960 (mock providers) | Context items carry `provenance[]` with `source_type` + `source_id`. |
| Operational context/actions | **Partial** | `GET operational-context` L5960, `POST actions/preview` L5998 | Operational context uses mock providers. Action preview is preview-only, no execution. |
| Health and diagnostics | **Done** | `GET health` L6603, `build_health_status()` L4843 probes Cosmos, Storage, Search, Speech. Returns 503 on degraded. Config validation included. | Not behind auth (correctly excluded). |
| Platform admin | **Done** | `POST platform-admin/tenants` L6363, `POST platform-admin/tenants/{id}/members` L6458 | Tenant creation and membership management. |
| Voice sessions | **Done** | `POST voice-sessions` L6544 | Pre-flight session token with 15-min TTL for WebSocket auth. |
| Ownership enforcement | **Done** | `enforce_record_access()` L3973, `owner_id`/`tenant_id` on `EncounterSession` L665 and `TranscriptionJob` L615 | Tenant isolation + role-based access (owner/admin/editor/reviewer/viewer). |
| Audit logging | **Done** | `write_platform_audit_event()` L3426 to `platform_audit_log` container, `append_encounter_event()` L3468 inline (capped 50), `sanitize_audit_value()` L3377 | Audit on encounter access, context reads, assistant queries, admin actions. |
| Error contracts | **Done** | `error_response()` L864 returns `{error, code, correlationId, details?}`, `conflict_response()` L881, `internal_server_error()` L885 logs internally, returns safe message | Consistent envelope across all handlers. |
| State transitions | **Done** | `require_encounter_status()` L4765 with `INVALID_TRANSITION` code and detailed `details` payload | Guards on all write endpoints with allowed-status sets. |
| Request validation | **Done** | `validate_uuid_value()`, `validate_request_body_size()`, `validate_payload_size()`, `validate_segments_payload()` | UUID format, body size, payload size, segment schema validation. |

---

## Phase 2: Frontend Inventory

**Directory:** `frontend-react/src/`

| Surface | Status | Evidence | Notes |
|---|---|---|---|
| App/router composition | **Done** | `App.tsx`: 10-deep provider nesting (ErrorBoundary→RuntimeConfig→PlatformShell→GlobalKnowledge→CurrentView→AuthSession→AssistantWorkspace→EncounterContext→OperationalContext→AgentRuntime→Router). 4 routes. | Clean composition. |
| Upload workflow | **Done** | `UploadPage.tsx`: create encounter → upload audio → navigate to review. Error banner + retry. `useRegisterCurrentView()` context contract. | |
| Ambient scribe workflow | **Done** | `AmbientScribePage.tsx`: voice capture via `useAssistantController({variant:'ambient'})`, WebSocket session, auto-start support. | |
| Encounter review | **Done** | `EncounterReviewPage.tsx`: Zustand store, polling with exponential backoff, auto-recovery for orphaned reviews, inline section editing, approve/edit/regenerate action rail. | |
| Results workflow | **Done** | `ResultsPage.tsx`: polling, results + summary fetch, `AdvancedDataSection` for technical payload. | |
| Assistant UX | **Done** | `AssistantShell.tsx`: query input, scope toggle (local/global), suggested questions, evidence context stats, citation rendering with provenance label (`source_type: source_id`), truncated excerpts. | Citations show provenance. |
| Auth and tenant | **Done** | `AuthSessionProvider.tsx`: Easy Auth detection (`.auth/me`), session fetch (`/api/auth/session`), multi-tenant membership selection, localStorage-persisted `activeTenantId`, `X-Clinical-Tenant-Id` header via `setApiClientTenantId()`. `AuthGateScreen.tsx`: SSO buttons, no-membership handling, tenant creation form, local dev detection. | No MSAL - all cookie-based. |
| Error handling | **Done** | `AppErrorBoundary.tsx`: class-based root boundary with recovery card. Per-page error banners + retry buttons. `ApiError` class in `client.ts`. | |
| API layer | **Done** | `client.ts`: `credentials: 'include'`, `X-Clinical-Tenant-Id` header, `fetchNdjsonStream()` for streaming. `encountersApi.ts`, `jobsApi.ts`, `summaryApi.ts`. | |
| Context providers | **Done** | `EncounterContextProvider.tsx`: auto-loads context on encounter change, search/refresh methods. `OperationalContextProvider.tsx`: provides operational context + action previews. | |
| Shared types | **Done** | `api.ts` (~550 lines): full contract types including `EncounterContextProvenance`, `evidence?: string[]` on all clinical outputs, auth types, streaming envelopes. | |
| State management | **Done** | `AssistantSessionStore.ts` (Zustand): encounter, review, draft, transcript, messages. `AssistantTurnsStore.ts`: thread/turn model for NDJSON streaming. | |

---

## Phase 3: MVP Hardening Assessment

| Domain | Status | Evidence | Risk / Impact | Next Action |
|---|---|---|---|---|
| **Authentication and tenancy** | **Done** | Easy Auth in `main.bicep` (`authsettingsV2` with Microsoft+Google), `get_authenticated_context()`, `ClinicalRequestContext`, `platform_users`/`platform_tenants`/`platform_voice_sessions` containers, `DEFAULT_TENANT_ID` bootstrap, `LOCAL_DEV_AUTH` fail-closed. Frontend `AuthSessionProvider` + `AuthGateScreen`. | Low. Core auth is implemented. | Verify Google login in deployed environment. Confirm claim normalization with real provider payloads. |
| **Authorization and ownership** | **Done** | `enforce_record_access()` checks `tenant_id` match + role hierarchy. `owner_id`/`tenant_id` on both data models. Tenant-scoped listing queries with composite index. | Low. | Verify cross-tenant denial is tested end-to-end in Playwright. |
| **Request validation and write safety** | **Done** | `validate_uuid_value()`, `validate_request_body_size()`, `validate_payload_size()`, `validate_segments_payload()`, `require_encounter_status()` with `INVALID_TRANSITION`, `expected_draft_version` concurrency on draft/finalize. | Low. All blocked paths have unit tests. | None critical. |
| **Error contracts and observability** | **Done** | `error_response()` with `{error, code, correlationId, details?}`. `internal_server_error()` logs internally. Per-request correlation IDs via `_request_context_local`. Health endpoint probes all dependencies (Cosmos, Storage, Search, Speech) and returns 503 on degradation. Config validation in health. | Low. | Verify Application Insights structured telemetry integration (may need `azure-monitor-opentelemetry` in requirements.txt — **check this**). |
| **Deployment and runtime hardening** | **Done** | `deploy-frontend.yml` targets `frontend-react/`, runs `npm ci && npm run build`, auto-configures API URL, deploys to `$web` container. `deploy-function.yml` packages and deploys. `deploy-all.yml` orchestrates infrastructure → function → frontend. CORS parameterized (`allowedOrigin` in `main.bicep`). | Low. Pipeline is correct. | Verify post-deploy smoke test checks authenticated access (expect 401 on protected routes). |
| **Clinician UX reliability** | **Done** | `AppErrorBoundary` at root. Error banners + retry on all pages. Exponential backoff polling (`getNextPollDelayMs()`). Double-submission prevention (`isSubmitting`). Auto-recovery for orphaned reviews. | Low. | None critical. |
| **Encounter-context contract stability** | **Done** | `contract_version: "v1"` on context and operational-context. `normalize_context_item()` and `normalize_operational_context()` enforce shape. Empty encounters return valid zero-item responses. Frontend types match backend. Unit tests in `test_context_contract.py`. | Low. | None critical. |

### MVP Hardening Summary

The repository has materially completed all seven MVP hardening workstreams documented in `PLAN-MVP-PRODUCTION-HARDENING.md`. The evidence shows:

- All 34 backend endpoints exist and are protected by `@require_authenticated_request` (except health)
- Multi-tenant auth with Microsoft + Google Easy Auth is configured in Bicep
- Ownership enforcement, role-based access, audit logging, and error contracts are implemented
- State transition guards, input validation, and concurrency checks are in place
- Frontend has full auth gate, tenant selector, error boundary, and retry affordances
- Deployment pipeline correctly targets `frontend-react/` with build step
- RUNBOOK.md exists with function/frontend rollback and post-rollback verification

---

## Phase 4: Infra and Delivery Assessment

### Can the current repo be deployed safely?

**Yes.** `main.bicep` provisions all required resources (Storage, Cosmos with 5 containers, Speech, Language, OpenAI, AI Search, Function App with managed identity, App Insights, frontend storage) with RBAC assignments. `authsettingsV2` is present with Easy Auth configured. CORS is parameterized (not wildcarded). Lifecycle policy for audio blobs is defined.

### Is the frontend delivery path correct?

**Yes.** `deploy-frontend.yml` (lines 1-100): triggers on `frontend-react/**`, runs `npm ci && npm run build` in `frontend-react/`, auto-configures `config.js` with API URL, deploys `frontend-react/dist/` to `$web` container. No references to deleted `frontend/` directory.

### Are health, smoke, and rollback paths credible?

| Check | Status | Evidence |
|---|---|---|
| Health endpoint | **Done** | Dependency-aware (4 probes), 503 on degraded, config validation |
| Post-deploy smoke | **Partial** | Function deploy does `/api/health` curl + restart. No authenticated endpoint check or frontend verification in CI. |
| Rollback documentation | **Done** | `RUNBOOK.md` covers function rollback (GitHub Actions + Azure CLI), frontend rollback (blob delete/upload), Cosmos recovery posture, post-rollback checks (health, auth rejection, session bootstrap, config.js). |

**Remaining gap:** Post-deploy smoke should verify `POST /api/encounters` returns `401` (proving auth is active) and frontend landing page returns `200`. This is documented but not automated in CI.

---

## Phase 5: Test-Backed Validation

| Test File | What It Covers | Critical Requirements Verified |
|---|---|---|
| `test_request_hardening.py` | UUID validation, request body size rejection (413), payload size rejection (413), error response correlation IDs, encounter status transition rejection (409), conflict response code, segments payload validation, health check contract (200/503), dependency degradation | Input validation, error contracts, health check, concurrency |
| `test_auth_context.py` | AAD claim normalization, Google claim normalization (from JSON fixtures) | Multi-IdP claim mapping correctness |
| `test_context_contract.py` | Context payload shape stability (v1 contract), context item normalization (category/assertion/confidence/provenance), operational context array-field non-null guarantee, freshness metadata | Encounter context contract stability |
| `retrieval-hardening.spec.cjs` | End-to-end: create encounter → draft → finalize → process → wait → results. Verifies clinical summary structure, Search-backed context kinds, gold-question grounded answers with citations, paraphrase grounding, React UI citation rendering. Uses `LOCAL_DEV_AUTH` headers + stubbed browser auth sessions. | Retrieval quality, citation provenance, grounding regression |
| `clinician-flow-smoke.spec.cjs` | Anonymous access rejection (`401`), full browser smoke: intake → ambient scribe entry → encounter review (mock-stubbed) → approve → technical results navigation. Stubbed auth sessions. | Auth gate, clinician workflow completeness, review lifecycle |

### Requirements covered by tests
- Input validation (UUID, body size, payload size, segments) ✅
- Error contract shape (correlationId, code, details) ✅
- Auth claim normalization (AAD + Google) ✅
- Health check contract (200/503, dependency probing) ✅
- Encounter context v1 contract stability ✅
- State transition rejection ✅
- Concurrency conflict detection ✅
- Retrieval grounding and citation quality ✅
- Clinician workflow completion (via mock-stubbed Playwright) ✅

### Requirements relying on assumptions (not yet test-covered)
- **Real Easy Auth in deployed environment** — tests use `LOCAL_DEV_AUTH` headers and stubbed `.auth/me` routes. No test proves Easy Auth claim injection works with real Microsoft/Google tokens in Azure.
- **Cross-tenant denial end-to-end** — `enforce_record_access()` exists but no test creates two tenants and proves one cannot access the other's encounters.
- **VoiceLive WebSocket auth with real session token** — `POST /api/voice-sessions` endpoint exists, but no test verifies the token is consumed during an actual WebSocket upgrade.
- **Application Insights telemetry arrival** — structured logging and App Insights key are configured, but no test verifies traces appear in the telemetry pipeline.
- **Blob lifecycle policy execution** — Bicep deploys the policy, but no test verifies blobs actually tier and delete.
- **Post-deploy smoke in CI** — only `/api/health` is checked after function deploy. No automated CI check for `401` on protected routes or frontend `200`.

---

## Phase 6: Explainability Substrate Assessment

### Current explainability-adjacent artifacts

| Artifact | Location | Maturity | Relevance to Graph Layer |
|---|---|---|---|
| **Encounter context items** | `build_encounter_context_items()` L4033, `build_encounter_context_payload()` | Done | Each item has `id`, `category`, `kind`, `title`, `text`, `source`, `assertion`, `confidence_score`, `provenance[]`, `metadata`. **This is the primary node schema candidate.** |
| **Provenance chain** | `EncounterContextProvenance` type: `{source_type, source_id, excerpt?}` | Done | Directly maps to graph edges (context_item → source_record). Provenance already carries the source trail. |
| **Structured findings** | `build_structured_findings_items()` L~300 | Done | Each finding has `id`, `label`, `detail`, `category`, `confidence_score`, `evidence[]`. Natural graph nodes with evidence edges. |
| **Medication changes** | `build_medication_change_items()` | Done | `id`, `medication`, `change_type`, `detail`, `dosage`, `frequency`, `evidence[]`. Typed relation candidates (medication → finding, medication → follow-up). |
| **Tests and referrals** | `build_test_items()`, `build_referral_items()` | Done | Same evidence-linked structure. |
| **Assertions** | `build_assertion_items()` | Done | `certainty`, `conditionality`, `association`, `temporal` — directly map to graph edge properties for confidence/temporality. |
| **Timeline** | `build_timeline_items()` | Done | `source` field (`summary` vs `encounter_event`) + `evidence[]` + `timeframe`. Temporal ordering substrate. |
| **Relationships** | Health Text Analytics entities with `relations` | Done | Medical entity relationships from Azure Language service. Pre-extracted relation triples. |
| **AI Search index** | `clinical-context` index, `search_encounter_context()` L2193 | Done | Vector + semantic search over encounter artifacts. Already serves as a retrieval layer. |
| **Citation rendering** | `AssistantShell.tsx` citations with `source_type: source_id` provenance labels | Done | Frontend already renders provenance. Graph layer would supply richer citation metadata. |
| **Evidence panels** | `EvidencePanel.tsx`: transcript, entities, relationships, assertions groups | Done | Collapsible evidence groups. Graph layer would add lineage/contradiction views here. |

### Readiness verdict

**The current repo has sufficient stable encounter artifacts to support a SQLite + JSON1 + FTS5 local graph layer without creating a conflicting second truth model.**

Rationale:
1. The encounter context items already carry deterministic IDs, typed categories, provenance chains, and evidence links. These map directly to graph nodes and edges.
2. The context contract is frozen at v1 with unit tests — the graph layer can consume this as its input.
3. Provenance is already first-class (`source_type` + `source_id` + `excerpt`). The graph layer would formalize existing provenance into queryable relationships rather than inventing new trails.
4. The structured findings, medications, tests, referrals, assertions, and timeline items all carry `evidence[]` arrays that are natural edge sources.
5. The AI Search index is the retrieval backend; the graph layer would be a complementary local reasoning substrate (deterministic traversal vs. probabilistic search), not a replacement.

### Key risk

The graph layer must consume from the existing context builders, not duplicate their logic. If it rebuilds findings/medications/timeline independently from raw transcript, it will create a conflicting second truth. The architecture must ensure the graph is materialized *from* the existing encounter context payload, not *beside* it.

---

## Phase 7: Integration Seam Assessment

### Where the explainability graph can be added additively

| Seam | Current Code | Graph Integration Point | Effort |
|---|---|---|---|
| **Graph materialization step** | After `process_encounter()` L5760 completes (transcription + analysis + summary + AI Search indexing), the encounter reaches `READY_FOR_REVIEW`. | Add a `materialize_encounter_graph()` call after the existing `index_encounter_for_search()` step. This consumes the same `build_encounter_context_items()` output and writes nodes/edges to a SQLite file at `encounter_graphs/{encounter_id}.db`. | Medium — new function, no existing code changes. |
| **Schema and deterministic IDs** | Context items already have stable `id` patterns: `finding-{n}`, `medication-{n}`, `test-{n}`, `timeline-summary-{n}`, `assertion-{n}`, `context-{kind}-{hash}`. | Graph nodes use these same IDs. Edges use `(source_id, target_id, relation_type)` triples. JSON1 stores full item payloads. FTS5 enables text search within the graph. | Low — schema follows existing ID patterns. |
| **Ingestion from context builders** | `build_encounter_context_items()` L4033 produces the full encounter context payload. `build_structured_findings_items()`, `build_medication_change_items()`, `build_test_items()`, `build_referral_items()`, `build_assertion_items()`, `build_timeline_items()` produce the structured artifacts. | The graph materializer takes these outputs as input. Each structured item becomes a node; each `evidence[]` entry and `provenance[]` entry becomes an edge. Cross-item relationships (e.g., medication → finding based on shared evidence text) become relation edges. | Low — existing builders are the single source. |
| **Retrieval adapter / endpoint seam** | `GET /api/encounters/{encounter_id}/context` L5900 currently serves from Cosmos + AI Search. | Add `GET /api/encounters/{encounter_id}/graph` endpoint that reads the SQLite graph and returns: nodes, edges, traversal results, and contradiction reports. The context endpoint continues to serve the current flat payload; the graph endpoint adds structured traversal. | Medium — new endpoint, no existing endpoint changes. |
| **Evidence and citation rendering** | `EvidencePanel.tsx` renders flat groups. `AssistantShell.tsx` renders provenance labels on citations. | Add a `GraphEvidencePanel` component alongside existing panels. This shows: lineage chains (finding → evidence → transcript), confidence paths, and contradiction flags. Assistant citations can optionally link to graph traversal paths. | Medium — additive UI components. |
| **Contradiction and unsupported-claim logic** | Not currently present. Assertions have `certainty` and `conditionality` but no cross-item contradiction detection. | The graph layer enables: (1) traverse all evidence for a finding → check if any conflicting assertion exists, (2) identify medication changes without supporting evidence edges, (3) detect findings with only `certainty: "negative"` evidence paths. This logic runs as graph queries, not as changes to existing builders. | Medium-High — new logic, but self-contained in graph layer. |

### Storage strategy

SQLite + JSON1 + FTS5 per encounter, stored as a blob in Azure Storage at `encounter_graphs/{encounter_id}.db`. The graph is:
- Materialized once after processing (deterministic from encounter context)
- Re-materialized on `regenerate` (existing regeneration flow triggers re-indexing; add graph re-materialization)
- Read-only during review (no concurrent writes)
- Small (typically < 1MB for a single encounter)
- Downloadable to browser for client-side graph queries (future)

This avoids any Cosmos DB schema changes or AI Search index modifications.

---

## Section 1: MVP Hardening Gaps

| # | Area | Status | File Evidence | Risk | Next Action |
|---|---|---|---|---|---|
| H1 | Application Insights structured telemetry | **Partial** | `APPINSIGHTS_INSTRUMENTATIONKEY` set in `main.bicep`. **Confirmed:** `requirements.txt` does NOT include `azure-monitor-opentelemetry` — only has `azure-functions`, `azure-storage-blob`, `azure-cosmos`, `azure-identity`, `azure-search-documents`, `azure-core`, `requests`, `python-dotenv`, `fpdf2`, `markdown`. | Medium — logs may not flow to App Insights as structured traces | Add `azure-monitor-opentelemetry` to `requirements.txt` and configure auto-instrumentation in `function_app.py`. |
| H2 | Post-deploy CI smoke for auth | **Done** | `deploy-function.yml` L130-140: curls `POST /api/encounters`, expects 401, fails deployment if not. Also validates `/api/health` dependencies. | None | No action required — already implemented. |
| H3 | Cross-tenant isolation E2E test | **Missing** | `enforce_record_access()` L3973 exists, no test creates two tenants and verifies denial | Medium — tenant isolation is implemented but not regression-tested end-to-end | Add a Playwright or API spec that creates encounters in two tenants and proves cross-access returns 403. |
| H4 | Real Easy Auth claim verification | **Missing** | Tests use `LOCAL_DEV_AUTH` headers. No test with real Azure-injected `X-MS-CLIENT-PRINCIPAL` | Low — claim normalization is unit-tested with fixtures, but real provider behavior is assumed | Manual verification during first deployed auth test. Capture real payloads and add as fixtures. |
| H5 | VoiceLive WebSocket auth E2E | **Missing** | `POST /api/voice-sessions` L6544 exists. No test verifies token consumption during WebSocket upgrade. | Low — endpoint exists, but gateway-side validation is untested | Test after VoiceLive gateway is configured. |
| H6 | `function-only.bicep` CORS | **Done** | `infra/function-only.bicep` L121: `allowedOrigins: [allowedOrigin]` — already parameterized, matching `main.bicep` | None | No action required. |

---

## Section 2: Explainability-Layer Gaps

| # | Area | Status | File Evidence | Risk | Next Action |
|---|---|---|---|---|---|
| E1 | Graph materialization function | **Missing** | No `materialize_encounter_graph()` or SQLite generation exists | Required for explainability | Implement graph materializer that consumes `build_encounter_context_items()` + structured builders output and writes SQLite + JSON1 + FTS5 per encounter. |
| E2 | Graph schema definition | **Missing** | No schema exists, but IDs and categories are stable in existing builders | Low — schema can be derived from existing item shapes | Define SQLite schema: `nodes(id, kind, category, title, text, payload_json)`, `edges(source_id, target_id, relation_type, evidence_text, confidence)`, FTS5 virtual table on `nodes.text`. |
| E3 | Graph storage backend | **Missing** | No `encounter_graphs/` blob container or local file path | Low | Add blob container prefix or local storage path. SQLite files < 1MB per encounter. |
| E4 | Graph API endpoint | **Missing** | No `/api/encounters/{encounter_id}/graph` route | Required for frontend consumption | Add endpoint returning nodes, edges, and optional traversal/query results (subgraph, paths, contradictions). |
| E5 | Graph re-materialization on regenerate | **Missing** | `regenerate_encounter_review()` L6295 triggers re-processing but no graph rebuild | Medium — stale graph after regeneration | Hook graph materialization into the regeneration flow alongside AI Search re-indexing. |
| E6 | Contradiction detection logic | **Missing** | Assertions carry `certainty`/`conditionality` but no cross-item conflict detection | Medium — core explainability value | Implement graph-query-based contradiction detection: conflicting assertions on same entity, unsupported findings, evidence conflicts. |
| E7 | Evidence lineage traversal | **Missing** | Provenance chains exist per item but no multi-hop traversal | Medium | Implement graph traversal queries: finding → evidence → transcript segment → raw audio timestamp. |
| E8 | Graph evidence UI panel | **Missing** | `EvidencePanel.tsx` shows flat groups, no graph view | Required for UX | Add `GraphEvidencePanel` component showing lineage chains, confidence paths, contradiction flags. Can render alongside existing panels. |
| E9 | Assistant graph-grounded answers | **Missing** | Assistant uses AI Search retrieval. No graph-backed reasoning. | Low priority — additive | Add optional graph retrieval adapter so assistant can cite graph traversal paths alongside search results. |
| E10 | SQLite + JSON1 + FTS5 dependency | **Missing** | Not in `requirements.txt` | Blocker for implementation | Add `pysqlite3` or use stdlib `sqlite3` (confirm FTS5 support in Azure Functions Python runtime). |

---

## Section 3: Release Blockers vs Non-Blockers

### Release blockers (must fix for production MVP)

| # | Item | Why it blocks | Effort |
|---|---|---|---|
| H1 | App Insights structured telemetry | Production observability gap — `azure-monitor-opentelemetry` not in `requirements.txt`, no `configure_azure_monitor()` call in `function_app.py` | Small — add SDK + 3-line init |
| ~~H2~~ | ~~Post-deploy auth smoke in CI~~ | **Already done** — `deploy-function.yml` already checks `POST /api/encounters` returns 401 | None |

### Non-blockers for MVP (should fix, don't gate release)

| # | Item | Why it matters | Effort |
|---|---|---|---|
| H3 | Cross-tenant isolation E2E test | Regression safety net | Medium — new test spec |
| H4 | Real Easy Auth claim verification | Production confidence | Small — manual + fixture capture |
| H5 | VoiceLive WebSocket auth E2E | Voice capture auth proof | Small — after gateway config |
| H6 | `function-only.bicep` CORS alignment | Dev environment safety | Small — one-line fix |

### Explainability prerequisites (must complete before graph layer)

| # | Item | Why it's prerequisite |
|---|---|---|
| MVP release | The application must be production-hardened before adding the explainability layer |
| E10 | SQLite + FTS5 runtime availability confirmation | Technical viability of the approach |
| E2 | Graph schema definition | Design foundation |

---

## Section 4: Execution-Ready Backlog (Priority Ordered)

### Tier 1: Release-critical now

| # | Task | Files | Effort |
|---|---|---|---|
| 1 | Add `azure-monitor-opentelemetry` to `requirements.txt` (confirmed missing) and call `configure_azure_monitor()` early in `function_app.py` | `requirements.txt`, `function_app.py` | Small |
| ~~2~~ | ~~Post-deploy auth smoke~~ — **already implemented** in `deploy-function.yml` L130-140 | — | None |

### Tier 2: Required before explainability work

| # | Task | Files | Effort |
|---|---|---|---|
| 3 | Add cross-tenant isolation E2E test (two tenants, prove 403 on cross-access) | `tests/` — new spec | Medium |
| ~~4~~ | ~~`function-only.bicep` CORS~~ — **already done** (L121: `allowedOrigins: [allowedOrigin]`) | `infra/function-only.bicep` | None |
| 5 | Capture real Microsoft + Google `X-MS-CLIENT-PRINCIPAL` payloads and add as test fixtures | `tests/fixtures/` | Small |
| 6 | Confirm FTS5 availability in Azure Functions Python 3.11 runtime (stdlib sqlite3) | Terminal verification | Small |

### Tier 3: Explainability implementation prerequisites

| # | Task | Files | Effort |
|---|---|---|---|
| 7 | Define SQLite graph schema: `nodes`, `edges`, FTS5 virtual table | New: `docs/encounter-graph-schema.md` | Small |
| 8 | Implement `materialize_encounter_graph()` consuming existing context builder outputs | `function_app.py` (new helper) | Medium |
| 9 | Add `encounter_graphs/` blob storage path, write materializer output | `function_app.py` | Small |
| 10 | Hook graph materialization into `process_encounter()` after AI Search indexing | `function_app.py` ~L5760 | Small |
| 11 | Hook graph re-materialization into `regenerate_encounter_review()` | `function_app.py` ~L6295 | Small |
| 12 | Add `GET /api/encounters/{encounter_id}/graph` endpoint | `function_app.py` (new route) | Medium |

### Tier 4: Explainability UX features

| # | Task | Files | Effort |
|---|---|---|---|
| 13 | Implement contradiction detection via graph queries (conflicting assertions, unsupported findings) | `function_app.py` (graph query helpers) | Medium-High |
| 14 | Implement evidence lineage traversal (finding → evidence → transcript → timestamp) | `function_app.py` (graph traversal) | Medium |
| 15 | Add `GraphEvidencePanel` component to frontend (lineage chains, confidence paths, contradiction flags) | `frontend-react/src/features/results/GraphEvidencePanel.tsx` | Medium |
| 16 | Add graph-backed citation enrichment to assistant answers (optional traversal paths) | `function_app.py` (assistant query), `AssistantShell.tsx` | Medium |
| 17 | Add graph summary to encounter review page (node/edge counts, contradiction alerts) | `EncounterReviewPage.tsx` | Small |

---

## Appendix: Files Inspected

| File | Lines | Key Findings |
|---|---|---|
| `function_app.py` | 7163 | 34 endpoints, full auth+tenant+audit, all hardening workstreams implemented |
| `PLAN-MVP-PRODUCTION-HARDENING.md` | 1128 | 7 workstreams, comprehensive plan with resolved decisions |
| `infra/main.bicep` | ~700 | Full resource provisioning, authsettingsV2, 5 Cosmos containers, RBAC, lifecycle policy |
| `RUNBOOK.md` | ~100 | Function/frontend rollback, Cosmos recovery, post-rollback checks |
| `tests/test_request_hardening.py` | ~150 | UUID, size, error contract, health, transition tests |
| `tests/test_auth_context.py` | ~30 | AAD/Google claim normalization from fixtures |
| `tests/test_context_contract.py` | ~80 | Context v1 contract, item normalization, operational context arrays |
| `tests/retrieval-hardening.spec.cjs` | ~400+ | E2E retrieval, citation grounding, gold questions, UI citations |
| `tests/clinician-flow-smoke.spec.cjs` | ~500+ | Auth rejection, full browser smoke, review lifecycle |
| `.github/workflows/deploy-frontend.yml` | ~100 | Correct: targets frontend-react/, npm build, $web deploy |
| `.github/workflows/deploy-function.yml` | ~100 | Packages and deploys, health curl, restart |
| `.github/workflows/deploy-all.yml` | ~100 | Orchestrates infra → function → frontend |
| `frontend-react/src/App.tsx` | — | 10-deep provider nesting including auth, context, error boundary |
| `frontend-react/src/shared/types/api.ts` | ~550 | Full type contract including provenance, evidence, auth |
| `GAP-ANALYSIS.md` | ~50 | Previous gap analysis — encounter-local retrieval strong, operational context mocked |
