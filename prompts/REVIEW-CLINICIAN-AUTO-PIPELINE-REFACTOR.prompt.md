# Review Clinician Auto Pipeline Refactor

I am working in `/home/ayoola/streaming_agents/transcription-services-demo`.

Your task is to review the saved execution prompt for the clinician auto pipeline refactor against the actual codebase, identify any gaps or risky assumptions, and improve the prompt if needed.

The execution prompt to review is:

1. `/home/ayoola/streaming_agents/transcription-services-demo/prompts/EXECUTE-CLINICIAN-AUTO-PIPELINE-REFACTOR.prompt.md`

You must inspect the real backend and frontend code before judging whether the prompt is strong enough to drive a future implementation session without drift.

## Objective

Determine whether the saved execution prompt is precise enough, well sequenced enough, and codebase-aligned enough to drive the repo from its current draft-first workflow into the desired clinician-focused automatic pipeline:

1. `Audio -> Transcription -> Medical NLP pipeline -> Structured outputs -> Final clinician-ready note`
2. no human in the loop during processing
3. clinician review only at the end
4. final review centered on `Approve`, `Edit`, and `Regenerate`

If the prompt is already strong, keep changes minimal and explain why.

If it is incomplete, risky, or inconsistent with the repo, improve it directly.

## Required Review Inputs

Primary prompt under review:

1. `/home/ayoola/streaming_agents/transcription-services-demo/prompts/EXECUTE-CLINICIAN-AUTO-PIPELINE-REFACTOR.prompt.md`

Existing repo plan that may conflict with the new goal:

1. `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-CLINICIAN-CALM-UI-REDESIGN.md`

Primary code references:

1. `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py`
2. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/shared/types/api.ts`
3. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/api/encountersApi.ts`
4. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/api/jobsApi.ts`
5. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/transport/AssistantTransport.ts`
6. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/state/AssistantSessionStore.ts`
7. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/app/router/index.tsx`
8. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/upload/UploadPage.tsx`
9. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/ambient/AmbientScribePage.tsx`
10. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/encounters/EncounterReviewPage.tsx`
11. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/ResultsPage.tsx`

Inspect any additional files needed to validate assumptions.

## Review Questions

You must answer these questions before editing the prompt:

1. Does the prompt correctly identify `api.ts` as the source of truth for the refactor contract?
2. Does the prompt sequence work in the right order: contract, backend, transport/state, then UI?
3. Does the prompt reflect the actual encounter and job routes in `function_app.py`?
4. Does the prompt account for the fact that the current repo still assumes explicit draft review before processing?
5. Does the prompt provide enough direction for the backend to emit clinician-facing structured outputs instead of forcing the frontend to infer them?
6. Does the prompt give enough migration guidance to preserve compatibility while introducing the new contract?
7. Does the prompt define enough verification requirements for a future implementation agent?
8. Does the prompt clearly distinguish final clinician review from technical outputs and legacy result views?

## Review Standards

Judge the prompt against these standards:

1. contract-first implementation discipline
2. minimal drift risk in future sessions
3. realistic sequencing against this repo
4. correct backend and frontend seam identification
5. compatibility-aware migration strategy
6. clear verification expectations
7. clinician-first product framing

## What To Do

### Step 1: Analyze The Real Codebase

Inspect the repo before judging the prompt.

Focus on:

1. current encounter lifecycle
2. current processing trigger points
3. current job and encounter result payloads
4. current Zustand and transport model
5. current route meanings and UI screen responsibilities

### Step 2: Review The Saved Execution Prompt

Assess whether it is:

1. technically accurate
2. sequenced correctly
3. specific enough to drive implementation
4. strict enough to prevent UI-first drift
5. compatible with the actual repo layout and contracts

### Step 3: Improve The Prompt If Needed

If the prompt is weak, incomplete, or risky, edit it directly.

Possible improvements include:

1. tightening required phases
2. correcting file targets
3. clarifying compatibility expectations
4. adding missing verification steps
5. clarifying which current plans or files are now superseded by the new product goal
6. removing ambiguity around the role of `ResultsPage` versus `EncounterReviewPage`

## Non-Negotiable Constraints

1. do not invent implementation steps unsupported by the current repo
2. do not let the review drift into generic product advice
3. do not weaken the contract-first requirement
4. do not ignore conflicts with the older clinician calm redesign plan
5. keep the review focused on making the saved execution prompt stronger for a future coding session

## Expected Output

When complete, provide:

1. whether the saved execution prompt was already strong enough or not
2. the most important findings, ordered by importance
3. what you changed in the prompt, if anything
4. any remaining risks or open questions for the future implementation session

## Execution Instruction

Review the codebase first.

Then review:

1. `/home/ayoola/streaming_agents/transcription-services-demo/prompts/EXECUTE-CLINICIAN-AUTO-PIPELINE-REFACTOR.prompt.md`

If it is not optimized enough, improve it directly.

Do not stop at analysis alone unless no improvement is justified.