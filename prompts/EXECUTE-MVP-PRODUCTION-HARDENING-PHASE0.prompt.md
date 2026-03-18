# Execute MVP Production Hardening Plan — Phase 0

I am working in `/home/ayoola/streaming_agents/transcription-services-demo`.

## Task

Execute **Phase 0** of the MVP production hardening plan.

You must use the saved plan as the implementation source of truth for this task:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-MVP-PRODUCTION-HARDENING.md`

Repo reality still wins over assumptions. Read the actual files before editing them.

## Objective

Unblock productionization by fixing the broken frontend deployment and local config path drift before landing Easy Auth or any deeper hardening work.

This is not a general hardening pass.

This is a focused execution slice for the highest-value unblocker identified in the plan review.

## Next Recommended Action

Start Phase 0 first: fix `deploy-frontend.yml`, `deploy-all.yml`, `configure-frontend.sh`, `configure-frontend.ps1`, and the related README references so every deployment and local config path points at `frontend-react`. That is the highest-value unblocker before landing Easy Auth.

## Required Source Of Truth

Read and follow:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-MVP-PRODUCTION-HARDENING.md`

Focus specifically on:

1. `Codebase State Summary`
2. `Workstream 4: Deployment Pipeline And Runtime Hardening`
3. `Strict Execution Order`
4. `Suggested Phase Breakdown`
5. `Verification Checklist`

## Scope For This Execution

Only execute the **Phase 0** slice from the plan:

1. frontend CI/CD must target `frontend-react/`
2. frontend build output must come from `frontend-react/dist/`
3. runtime config generation must target `frontend-react/public/config.js` or the built output in a consistent, explicit way
4. all stale references to deleted `frontend/` paths in the deployment and local-config workflow must be removed
5. CORS tightening may be included only if it is a narrow, low-risk Phase 0 change and does not expand the slice into auth or broader infra redesign

Do not implement Easy Auth, tenancy, or backend auth helpers in this task.

## Primary Files

You should expect to inspect and update these files:

- `/home/ayoola/streaming_agents/transcription-services-demo/.github/workflows/deploy-frontend.yml`
- `/home/ayoola/streaming_agents/transcription-services-demo/.github/workflows/deploy-all.yml`
- `/home/ayoola/streaming_agents/transcription-services-demo/configure-frontend.sh`
- `/home/ayoola/streaming_agents/transcription-services-demo/configure-frontend.ps1`
- `/home/ayoola/streaming_agents/transcription-services-demo/README.md`

You may also inspect these files if required for correctness:

- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/package.json`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/public/config.js`
- `/home/ayoola/streaming_agents/transcription-services-demo/infra/main.bicep`
- `/home/ayoola/streaming_agents/transcription-services-demo/infra/function-only.bicep`

## Mandatory Constraints

1. Keep the work focused on productionizing the current app, not redesigning it.
2. Do not expand into A2A, MCP, Foundry, or multi-agent architecture.
3. Keep `frontend-react/` as the only supported frontend target.
4. Do not reintroduce the deleted `frontend/` directory in scripts, docs, or workflows.
5. Do not start auth implementation in this slice.
6. Prefer the smallest coherent change set that makes deployment and config paths correct.
7. Preserve the current React build contract: `npm ci && npm run build` from `frontend-react/`.
8. If you touch CORS in this slice, keep it parameterized and minimal.

## Required Execution Order

Execute in this order unless the repo forces a narrow adjustment:

1. Read the saved plan section for Phase 0 and Workstream 4.
2. Inspect the current deployment workflows and identify all references to deleted `frontend/` paths.
3. Update `deploy-frontend.yml` so it builds and deploys `frontend-react/` correctly.
4. Update `deploy-all.yml` so the frontend stage builds and deploys `frontend-react/` correctly.
5. Update `configure-frontend.sh` and `configure-frontend.ps1` so they only write supported config entrypoints.
6. Update README references so local setup and deployment instructions no longer point at deleted frontend paths.
7. Validate the frontend build and check the edited files for errors.

## Detailed Expectations

### Deployment Workflows

In `.github/workflows/deploy-frontend.yml` and `.github/workflows/deploy-all.yml`:

1. Replace all `frontend/**` trigger paths with `frontend-react/**` where appropriate.
2. Run the frontend build from `frontend-react/`.
3. Deploy `frontend-react/dist/` to the static website container.
4. Ensure runtime config generation aligns with the actual React app path and build flow.
5. Remove writes to `frontend/config.js`.
6. Do not leave split-brain behavior where workflows target both the deleted path and the React app.

### Local Config Scripts

In `configure-frontend.sh` and `configure-frontend.ps1`:

1. Remove any writes to deleted `frontend/config.js`.
2. Keep `frontend-react/public/config.js` as the supported config source unless a more correct build-output approach is already established in the repo.
3. Keep the developer experience straightforward: one command should still update the React runtime config.

### Documentation

In `README.md`:

1. Remove or correct all references to `frontend/config.js`.
2. Update setup and deployment guidance so it reflects the React app as the only frontend.
3. Keep documentation edits tightly scoped to the paths and commands changed in this slice.

## Verification Requirements

Before finishing, verify all of the following:

1. `deploy-frontend.yml` targets `frontend-react/` end to end.
2. `deploy-all.yml` targets `frontend-react/` end to end.
3. No edited workflow writes to `frontend/config.js`.
4. No edited local helper script writes to `frontend/config.js`.
5. README instructions reference `frontend-react` and the correct config path.
6. The React app still builds successfully from `frontend-react/`.

## Validation Loop

For each meaningful change set:

1. inspect the actual file before editing
2. make the smallest coherent update
3. run the relevant validation
4. fix any issues before moving on

## Output Expectations

When complete, report:

1. what Phase 0 changes were implemented
2. which files were changed
3. what validation was run
4. any remaining blockers before Phase 1A

## Critical Instruction

Do not execute from summary alone.

Read and follow:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-MVP-PRODUCTION-HARDENING.md`

Then execute only the Phase 0 slice.

Do not stop at analysis unless a genuine blocker prevents implementation.