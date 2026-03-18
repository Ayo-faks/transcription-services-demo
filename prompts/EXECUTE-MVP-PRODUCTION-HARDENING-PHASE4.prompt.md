# Execute MVP Production Hardening Plan — Phase 4

I am working in /home/ayoola/streaming_agents/transcription-services-demo.

## Task

Execute Phase 4 of the MVP production hardening plan.

Use the saved plan as the implementation source of truth:

- /home/ayoola/streaming_agents/transcription-services-demo/PLAN-MVP-PRODUCTION-HARDENING.md

Repo reality wins over assumptions. Read the actual files before editing them.

## Objective

Land the next hardening slice after Phase 0, Phase 1A, Phase 1B, Phase 2, and Phase 3.

This phase is strictly the remaining deployment/runtime hardening plus audit/compliance foundations:

1. audit events with user and tenant identity
2. data retention and deletion documentation
3. rollback procedure documentation
4. meaningful post-deploy smoke tests
5. production configuration validation
6. runtime safety checks for deployment defaults

This is not a redesign task.

Do not re-open authentication, tenant UX, request validation, or generic frontend redesign unless the live repo forces a narrow correction that is directly required for this phase.

## Current Execution Context

Treat the following as the expected baseline, but verify each point against the live repo before changing code:

1. Phase 0 is already complete: frontend deployment and local config paths were moved to frontend-react.
2. Phase 1A and 1B are already complete: Easy Auth groundwork, tenant context, role-aware backend access, tenant bootstrap flows, and authenticated voice-session exchange are already in the repo.
3. Phase 2 is already complete: UUID validation, payload/file size limits, and encounter transition guards are already in place.
4. Phase 3 is already complete: standardized safe error responses, correlation IDs, structured logging seams, and dependency-aware health checks are already in place.
5. The backend health contract is no longer a static OK payload; it now returns dependency-aware JSON and should be used by CI smoke checks.
6. Encounter event logging already exists inline on encounter records via append_encounter_event(...), but dedicated audit logging and retention documentation may still be incomplete.
7. RUNBOOK.md and DATA-POLICY.md may still be missing. Verify live repo state instead of assuming.
8. There may be unrelated in-progress work in the git worktree. Do not revert or overwrite unrelated changes.

If repo reality differs, adapt to the repo, not to this summary.

## Required Source Of Truth

Read and follow:

- /home/ayoola/streaming_agents/transcription-services-demo/PLAN-MVP-PRODUCTION-HARDENING.md

Focus specifically on:

1. Workstream 4: Deployment Pipeline And Runtime Hardening
2. Workstream 5: Audit And Compliance Foundations
3. Suggested Phase Breakdown
4. Verification Checklist
5. Remaining Risks

## Scope For This Execution

Only execute Phase 4 from the plan.

The target slice is:

1. extend audit logging so access and state changes are attributable to authenticated users and tenants
2. decide whether to keep audit events inline, add a dedicated platform_audit_log container, or do both in a narrowly scoped MVP-safe way
3. document retention and deletion policy for encounters, jobs, and audio blobs
4. document rollback procedure for function deploys, frontend deploys, and Cosmos recovery posture
5. strengthen deployment/runtime validation so production fails fast on placeholder or missing configuration
6. strengthen post-deploy smoke tests so they validate meaningful backend/frontend behavior against the current hardened contracts
7. remove or document unsafe deployment defaults that remain in workflows, templates, or runtime configuration

Do not begin Phase 5 or Phase 6 in this task.

## Primary Files

You should expect to inspect and update these files:

- /home/ayoola/streaming_agents/transcription-services-demo/function_app.py
- /home/ayoola/streaming_agents/transcription-services-demo/.github/workflows/deploy-function.yml
- /home/ayoola/streaming_agents/transcription-services-demo/.github/workflows/deploy-frontend.yml
- /home/ayoola/streaming_agents/transcription-services-demo/.github/workflows/deploy-all.yml
- /home/ayoola/streaming_agents/transcription-services-demo/infra/main.bicep
- /home/ayoola/streaming_agents/transcription-services-demo/infra/function-only.bicep
- /home/ayoola/streaming_agents/transcription-services-demo/local.settings.example.json
- /home/ayoola/streaming_agents/transcription-services-demo/README.md
- /home/ayoola/streaming_agents/transcription-services-demo/tests/clinician-flow-smoke.spec.cjs
- /home/ayoola/streaming_agents/transcription-services-demo/playwright.config.cjs
- /home/ayoola/streaming_agents/transcription-services-demo/requirements.txt

You may create narrowly scoped new files when justified, including:

1. /home/ayoola/streaming_agents/transcription-services-demo/RUNBOOK.md
2. /home/ayoola/streaming_agents/transcription-services-demo/DATA-POLICY.md

If a dedicated audit helper or audit document is needed, keep it minimal and consistent with the current backend style.

## Mandatory Constraints

1. Keep the work focused on productionizing the current app, not redesigning it.
2. Do not expand into A2A, MCP, Foundry, or multi-agent architecture.
3. Keep frontend-react as the only supported frontend target.
4. Keep function_app.py as the backend source of truth unless a very small helper extraction is necessary.
5. Do not weaken the existing auth, tenant, validation, or error-contract hardening.
6. Do not leak PHI or raw exception detail in new audit or smoke-test output.
7. Do not revert unrelated user changes in a dirty worktree.
8. Prefer the smallest coherent implementation that satisfies Phase 4 exit criteria.
9. If you add deployment validation, fail fast with safe, explicit diagnostics instead of vague startup crashes.
10. Keep /api/health unauthenticated.

## Required Execution Order

Execute in this order unless the repo forces a narrow adjustment:

1. Read the saved plan section for Workstream 4, Workstream 5, and Phase 4.
2. Inspect the current live repo to confirm what Phase 0 to Phase 3 actually landed.
3. Audit current workflow smoke checks, runtime config validation, audit event usage, and documentation gaps.
4. Implement production config validation and remove remaining unsafe runtime defaults.
5. Implement or extend audit logging so reads and key state changes capture user_id, tenant_id, action, target, and timestamp.
6. Add or document audio blob lifecycle / retention posture in infrastructure and policy docs.
7. Add rollback documentation and data policy documentation.
8. Update deploy workflows and smoke tests so they validate the hardened health contract and at least one meaningful protected or semi-protected path.
9. Validate the changed backend, docs, and workflow-facing test logic before stopping.

## Detailed Expectations

### Audit And Compliance

In function_app.py and related persistence seams:

1. Review existing append_encounter_event(...) usage and extend it where Phase 4 requires stronger coverage.
2. Ensure audit-relevant events capture authenticated identity fields where available:
   - user_id
   - tenant_id
   - role when relevant
   - action
   - target_type
   - target_id
   - timestamp
3. Ensure at minimum that important reads are auditable. This can be either:
   - structured logs with sufficient dimensions, or
   - persistence to a dedicated audit container, or
   - a narrow hybrid approach
4. If you introduce a dedicated platform_audit_log persistence path, keep it MVP-safe and do not sprawl the data model.
5. Do not bloat encounter documents unnecessarily if high-volume access events are better handled as structured logs or a dedicated container.
6. Keep audit payloads safe. Do not dump full transcripts or PHI-heavy blobs into logs unless the repo already does so intentionally and safely.

### Data Policy

Create or update documentation to cover:

1. retention expectations for encounters and jobs
2. where audio blobs are stored
3. how audio blobs expire or should expire
4. deletion handling expectations
5. UK data residency posture
6. the fact that disableLocalAuth should remain enabled on supported Azure resources

If lifecycle management for blobs is missing from Bicep and the repo is ready for a narrow infra update, add it. If not, document the exact gap and implement the safest feasible portion in this phase.

### Rollback Procedure

In RUNBOOK.md or equivalent:

1. document how to redeploy a previous function artifact
2. document how to roll back frontend static assets
3. document what recovery posture exists for Cosmos DB
4. document operational checks after rollback
5. keep it actionable, short, and environment-aware

### Production Config Validation

In function_app.py and related config seams:

1. verify required production settings are present and not placeholder values
2. fail fast or expose a deep validation path when production config is unsafe
3. keep validation aligned with the current hardened health and error contract
4. do not break local development or LOCAL_DEV_AUTH paths unnecessarily

### Deployment Smoke Tests

In the GitHub Actions workflows:

1. consume the real /api/health JSON contract instead of only checking HTTP 200
2. verify degraded health fails the deploy smoke step
3. verify at least one meaningful route beyond health where appropriate
4. after auth rollout, make sure smoke expectations are aligned with protected routes instead of assuming anonymous access
5. verify frontend deployment returns a real page successfully

### Unsafe Defaults

Verify and fix where appropriate:

1. wildcard CORS in infra templates or runtime settings
2. placeholder secret defaults in production-facing paths
3. documentation that implies insecure production setup
4. workflow behavior that would silently pass while the app is misconfigured

## Verification Requirements

Before finishing, verify all of the following:

1. audit-relevant actions now capture user and tenant identity in a consistent way
2. the audit approach chosen is coherent with repo scale and current architecture
3. data retention and deletion expectations are documented
4. rollback procedure is documented and actionable
5. production config validation exists and does not silently accept placeholder values
6. post-deploy smoke tests parse and validate the real health payload
7. frontend deployment smoke still validates the landing page successfully
8. no new backend errors or diagnostics regressions were introduced by this phase

## Validation Loop

For each meaningful change set:

1. inspect the actual file before editing
2. make the smallest coherent update
3. run the relevant validation
4. fix any issues before moving on

At minimum, run the relevant subset of:

1. Python compile validation for function_app.py
2. focused backend unit tests if Phase 4 changes touch backend helpers
3. targeted workflow or script sanity checks where feasible
4. frontend build only if frontend-facing workflow or config changes require it
5. editor diagnostics on modified files

## Output Expectations

When complete, report:

1. what Phase 4 changes were implemented
2. which files were changed
3. what validation was run
4. any remaining blockers before Phase 5
5. any external dependencies still needed for full production rollout

## Critical Instruction

Do not execute from summary alone.

Read and follow:

- /home/ayoola/streaming_agents/transcription-services-demo/PLAN-MVP-PRODUCTION-HARDENING.md

Then execute only the Phase 4 slice.

Do not stop at analysis unless a genuine blocker prevents implementation.
