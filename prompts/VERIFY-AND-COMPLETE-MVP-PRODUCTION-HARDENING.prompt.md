# Verify And Complete MVP Production Hardening Execution

I am working in `/home/ayoola/streaming_agents/transcription-services-demo`.

## Task

Audit the repository to determine whether the execution described in:

- `/home/ayoola/streaming_agents/transcription-services-demo/prompts/EXECUTE-MVP-PRODUCTION-HARDENING.prompt.md`

has actually been completed in code.

Do not assume it has.

You must:

1. verify what has already been executed
2. identify any missing or partially executed work
3. determine the highest-priority remaining gap based on the required execution order
4. implement the missing work directly
5. continue until the current gap is closed and validated, or until a genuine blocker prevents safe progress

This is for a fresh coding session. Treat the repo as authoritative, not prior chat history.

## Required Source Of Truth

You must read and use both of these files directly:

1. `/home/ayoola/streaming_agents/transcription-services-demo/prompts/EXECUTE-MVP-PRODUCTION-HARDENING.prompt.md`
2. `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-MVP-PRODUCTION-HARDENING.md`

The execution prompt is the operational checklist you are auditing against.

The plan is the implementation source of truth for sequencing, scope, workstreams, and verification.

## Objective

Establish whether the MVP production hardening program has actually been executed end to end, then close the next real gap in the repo.

The target remains the same:

1. productionize the current HealthTranscribe app
2. preserve the existing working upload and ambient workflows
3. keep `frontend-react/` as the primary frontend
4. keep `function_app.py` as the backend source of truth unless a narrowly scoped split is clearly justified
5. avoid future-architecture expansion

## Non-Negotiable Constraints

1. Do not treat the execution prompt as completed just because some later work exists in the repo.
2. Do not stop at review-only output unless the repo is genuinely blocked.
3. Do not invent new plan documents.
4. Do not expand into A2A, MCP, Foundry, or multi-agent redesign.
5. Do not remove the confirmed Easy Auth multi-IdP and multi-tenant direction.
6. Do not replace Easy Auth with in-code JWT validation.
7. Do not skip ahead in a way that violates dependency order.
8. Prefer the smallest coherent implementation slice that closes the next real gap.
9. If the repo has drifted from the saved plan, note the drift and still execute the closest correct slice grounded in the codebase.

## Mandatory Audit Process

You must perform this audit before editing files.

### Step 1 — Read The Execution Prompt And Plan

Read:

1. `/home/ayoola/streaming_agents/transcription-services-demo/prompts/EXECUTE-MVP-PRODUCTION-HARDENING.prompt.md`
2. `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-MVP-PRODUCTION-HARDENING.md`

Use these sections from the plan directly:

1. `Codebase State Summary`
2. `MVP Workstreams`
3. `Strict Execution Order`
4. `Suggested Phase Breakdown`
5. `Verification Checklist`
6. `Remaining Risks`

### Step 2 — Audit Execution Status Against The Repo

For each phase and workstream named in the execution prompt, determine whether it is:

1. fully executed
2. partially executed
3. not executed
4. superseded by a repo-accurate equivalent implementation

You must verify this in real files, not by inference.

### Step 3 — Produce An Internal Execution Matrix

Build an internal checklist mapping:

1. phase or workstream
2. expected deliverables
3. actual files or code found
4. status: complete, partial, missing, or drifted
5. evidence for the status

Do not stop after building this matrix. Use it to decide the next implementation slice.

### Step 4 — Pick The Next Real Gap

Choose the highest-priority unfinished slice using the saved execution order unless repo reality forces a narrower correction.

If Phase 0 is incomplete, do that first.

If Phase 0 is complete, continue to the earliest incomplete phase in the required order.

### Step 5 — Implement, Validate, Repeat

After choosing the next gap:

1. inspect the exact files involved
2. implement the missing work
3. run validation
4. fix issues introduced by the slice
5. continue until that slice is genuinely complete

## Required Execution Order

Use this order unless the actual repo forces a narrow adjustment:

1. **Phase 0 / Workstream 4 partial:** frontend deployment and local config path correctness
2. **Phase 1A / Workstream 1A:** authentication foundations
3. **Phase 1B / Workstream 1B:** tenant enforcement and frontend auth UX
4. **Phase 2 / Workstream 2:** request validation and data integrity
5. **Phase 3 / Workstream 3:** error contracts and observability
6. **Phase 4 / Workstreams 4 remainder + 5:** audit, compliance, rollback, smoke tests, production validation
7. **Phase 5 / Workstream 6:** frontend reliability and UX hardening
8. **Phase 6 / Workstream 7:** encounter context contract stabilization

Do not skip to a later phase just because some later code already exists.

## Minimum Files To Inspect During Audit

You must inspect the relevant real files for the earliest incomplete slice. Depending on what you find, that will likely include many of these:

### Deployment and config

1. `/home/ayoola/streaming_agents/transcription-services-demo/.github/workflows/deploy-frontend.yml`
2. `/home/ayoola/streaming_agents/transcription-services-demo/.github/workflows/deploy-all.yml`
3. `/home/ayoola/streaming_agents/transcription-services-demo/configure-frontend.sh`
4. `/home/ayoola/streaming_agents/transcription-services-demo/configure-frontend.ps1`
5. `/home/ayoola/streaming_agents/transcription-services-demo/README.md`

### Backend

1. `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py`
2. `/home/ayoola/streaming_agents/transcription-services-demo/local.settings.example.json`
3. `/home/ayoola/streaming_agents/transcription-services-demo/requirements.txt`

### Frontend

1. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/App.tsx`
2. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/api/client.ts`
3. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/app/router/index.tsx`
4. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/shell/layout/AppShell.tsx`
5. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/transport/voiceLiveSession.ts`
6. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/shared/types/api.ts`

### Infrastructure and tests

1. `/home/ayoola/streaming_agents/transcription-services-demo/infra/main.bicep`
2. `/home/ayoola/streaming_agents/transcription-services-demo/playwright.config.cjs`
3. `/home/ayoola/streaming_agents/transcription-services-demo/tests/`

Inspect more files as needed. Do not constrain the audit to this list if the codebase points elsewhere.

## How To Judge Completion

A phase is only complete if both are true:

1. the code for its required deliverables exists in the repo in a working form
2. the phase has appropriate validation evidence or can be validated successfully now

If code exists but validation is missing or broken, treat the phase as partial.

If implementation differs from the saved plan but satisfies the same production-hardening goal safely, treat it as repo-accurate drift rather than missing work.

## Validation Requirements

For each slice you touch, run the smallest relevant validation loop:

1. build checks
2. lint or type checks where applicable
3. targeted tests where applicable
4. file-specific error checks

At minimum, if frontend files are touched, validate the React build.

At minimum, if backend files are touched, validate Python syntax and any targeted tests that cover the changed behavior.

If infra or workflow files are touched, validate syntax and consistency as far as the repo allows.

## Output Requirements

When you finish the current session, provide:

1. **Execution status audit:** which phases are complete, partial, missing, or drifted
2. **Gap found:** the next real incomplete slice you identified
3. **Implementation completed:** what you changed in this session
4. **Files changed:** exact files updated
5. **Validation run:** commands or checks performed and their results
6. **Remaining work:** the next phase or gap still pending after your changes
7. **Blockers:** only if something genuinely could not be completed safely

## Critical Instruction

Do not stop after the audit.

After you determine the current execution status against:

- `/home/ayoola/streaming_agents/transcription-services-demo/prompts/EXECUTE-MVP-PRODUCTION-HARDENING.prompt.md`

you must implement the next real missing slice and validate it.

Treat this as an execution-and-gap-closure prompt, not a review-only prompt.