# Execute MVP Production Hardening Plan

I am working in `/home/ayoola/streaming_agents/transcription-services-demo`.

## Task

Execute the MVP production hardening plan described in:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-MVP-PRODUCTION-HARDENING.md`

Treat that saved markdown plan as the implementation source of truth for this task.

Do not execute from memory, summary, or assumption.

Read the actual codebase before editing files. Repo reality wins over plan assumptions when they differ.

## Objective

Take the current working HealthTranscribe application to a production-ready MVP without expanding scope into future architecture.

The goal is to productionize the existing app that already supports:

1. file upload to transcription and review
2. ambient capture to transcription and review
3. encounter-scoped retrieval and assistant support
4. the current React frontend in `frontend-react/`

This is a hardening and execution task, not a redesign task.

## Next Recommended Action

> **Start Phase 0 first:** fix `deploy-frontend.yml`, `deploy-all.yml`, `configure-frontend.sh`, `configure-frontend.ps1`, and the related README references so every deployment and local config path points at `frontend-react`. That is the highest-value unblocker before landing Easy Auth.

Treat that as the required first slice, not an optional suggestion.

## Required Source Of Truth

You must read and follow:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-MVP-PRODUCTION-HARDENING.md`

You must use the following sections directly:

1. `Codebase State Summary`
2. `MVP Workstreams`
3. `Strict Execution Order`
4. `Suggested Phase Breakdown`
5. `Verification Checklist`
6. `Remaining Risks`

## Execution Standard

Operate like a senior engineer executing a production hardening track in a mature codebase:

1. be precise about scope
2. verify before changing
3. prefer the smallest coherent change set per slice
4. preserve working flows unless the plan explicitly requires a change
5. close the loop with validation after each meaningful slice
6. keep implementation grounded in the saved plan and live repo state

## Non-Negotiable Constraints

1. Keep the work focused on productionizing the current working app.
2. Do not expand into A2A, MCP, Foundry, or multi-agent architecture.
3. Do not remove the confirmed multi-tenant or multi-IdP auth architecture.
4. Do not replace Easy Auth with in-code JWT validation.
5. Keep `frontend-react/` as the primary frontend.
6. Keep `function_app.py` as the backend unless a narrowly scoped split is explicitly justified by the plan.
7. Do not create alternative plans. Execute the existing one.
8. Do not skip ahead in a way that breaks the plan's dependency order.
9. Do not stop at analysis alone unless a genuine blocker prevents implementation.

## Required Execution Order

Execute the plan in this order unless the actual code forces a narrow correction:

1. **Phase 0 / Workstream 4 partial:** unblock frontend deployment and local config path correctness.
2. **Phase 1A / Workstream 1A:** authentication foundations.
3. **Phase 1B / Workstream 1B:** tenant enforcement and frontend auth UX.
4. **Phase 2 / Workstream 2:** request validation and data integrity.
5. **Phase 3 / Workstream 3:** error contracts and observability.
6. **Phase 4 / Workstreams 4 remainder + 5:** audit, compliance, rollback, smoke tests, production validation.
7. **Phase 5 / Workstream 6:** frontend reliability and UX hardening.
8. **Phase 6 / Workstream 7:** encounter context contract stabilization.

Do not begin later phases before the current phase is in a coherent, validated state.

## What You Must Do First

Before editing anything:

1. read `PLAN-MVP-PRODUCTION-HARDENING.md`
2. inspect the files named in the current phase
3. verify the current repository state against the plan section you are executing
4. identify any repo drift that affects that slice
5. then implement the current slice

## Phase 0 Scope

Start with the exact slice below.

### Phase 0 Deliverables

1. frontend CI/CD targets `frontend-react/`
2. React build output comes from `frontend-react/dist/`
3. runtime config generation targets the real React runtime config path consistently
4. deleted `frontend/` path references are removed from deployment and local config paths
5. README instructions reflect the real frontend and config flow

### Phase 0 Primary Files

- `/home/ayoola/streaming_agents/transcription-services-demo/.github/workflows/deploy-frontend.yml`
- `/home/ayoola/streaming_agents/transcription-services-demo/.github/workflows/deploy-all.yml`
- `/home/ayoola/streaming_agents/transcription-services-demo/configure-frontend.sh`
- `/home/ayoola/streaming_agents/transcription-services-demo/configure-frontend.ps1`
- `/home/ayoola/streaming_agents/transcription-services-demo/README.md`

Reference as needed:

- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/package.json`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/public/config.js`

### Phase 0 Expectations

1. `deploy-frontend.yml` builds and deploys the React app correctly.
2. `deploy-all.yml` builds and deploys the React app correctly.
3. no workflow or helper script writes to deleted `frontend/config.js`.
4. the only supported frontend path is `frontend-react/`.
5. the React app still builds successfully after the changes.

## Full-Plan Execution Expectations

After Phase 0, continue executing the plan phase by phase.

For each phase:

1. confirm the saved plan still matches the repo slice you are about to implement
2. implement only the current phase's intended deliverables
3. validate the affected files and behavior
4. fix issues before moving to the next phase
5. keep notes concise and factual

If a phase reveals meaningful drift, update the saved plan only if the implementation would otherwise become inaccurate or unsafe.

## Validation Loop

For every meaningful implementation slice:

1. inspect the relevant files before editing
2. make the smallest coherent set of changes
3. run the relevant build, lint, test, or error checks
4. fix any issues introduced by the slice
5. verify the result against the phase exit criteria

## Output Expectations

When reporting progress or completion, provide:

1. what phase or slice was implemented
2. which files changed
3. what validation was run
4. what remains next in the execution order
5. any blockers or repo drift discovered during implementation

## Critical Instruction

Read and execute the saved plan directly:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-MVP-PRODUCTION-HARDENING.md`

Begin with the highlighted next recommended action.

Do not stop at planning. Execute the work and make sure you achive the expected results before moving on to the next slice. AND ENSURE YOU ACHIVE OVER ALL GOAL