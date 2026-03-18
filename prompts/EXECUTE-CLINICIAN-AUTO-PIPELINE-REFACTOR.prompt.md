# Execute Clinician Auto Pipeline Refactor

I am working in `/home/ayoola/streaming_agents/transcription-services-demo`.

Your task is to refactor the current repo from a draft-first, developer-facing workflow into a clinician-focused, fully automatic pipeline where audio capture or upload runs all the way through structured clinical outputs before the clinician reviews the final result.

You must execute against the real codebase, not assumptions. Verify each step against actual files before editing. Repo reality wins over plan assumptions.

## Product Goal

The target workflow is:

1. `Audio -> Transcription -> Medical NLP pipeline -> Structured outputs -> Final clinician-ready note`
2. no human in the loop during processing
3. clinician review happens only at the end
4. the main clinician experience is a final review surface with `Approve`, `Edit`, and `Regenerate`

The doctor should see:

1. final note first
2. clear cards for follow-up, medication changes, tests, and referrals
3. optional collapsible evidence for transcript, entities, relationships, and assertions
4. minimal assistant and architecture noise

## Required Source Of Truth

Treat these files as the main implementation anchors:

1. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/shared/types/api.ts`
2. `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py`
3. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/api/encountersApi.ts`
4. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/api/jobsApi.ts`
5. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/transport/AssistantTransport.ts`
6. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/state/AssistantSessionStore.ts`
7. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/app/router/index.tsx`
8. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/upload/UploadPage.tsx`
9. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/ambient/AmbientScribePage.tsx`
10. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/encounters/EncounterReviewPage.tsx`
11. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/ResultsPage.tsx`
12. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/SummaryPanel.tsx`
13. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/EvidencePanel.tsx`
14. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/OutputActionRail.tsx`
15. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/OutputsReadyPanel.tsx`
16. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/AdvancedDataSection.tsx`
17. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/index.css`

## Contract-First Rule

`/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/shared/types/api.ts` is the source of truth for the refactor.

Do not start with UI edits.

First define the exact clinician review contract in `api.ts`, then make the backend emit it, then update transport/state, then refactor screens.

## Required End State

The repo must support a primary encounter-centric review payload that includes:

1. transcript
2. extracted medical entities
3. relationships
4. assertions
5. timeline
6. clinical summary
7. structured findings
8. follow-up instructions
9. medication changes
10. tests and referrals
11. final note sections: HPI, ROS, PE, Assessment, Plan

The review screen must present that payload in clinician-first order.

## Mandatory Read Before Editing

Before any edits, inspect the current implementation in these areas:

1. encounter processing routes in `function_app.py`
2. current `build_job_result(...)` response shape
3. current encounter review flow in `EncounterReviewPage.tsx`
4. current results flow in `ResultsPage.tsx`
5. current Zustand assistant session model in `AssistantSessionStore.ts`
6. current transport/API client split in `AssistantTransport.ts`, `encountersApi.ts`, and `jobsApi.ts`

You must explicitly verify what already exists before changing each layer.

## Required Implementation Sequence

### Phase 1: Define Exact API Schema

Update `api.ts` first.

Required work:

1. define the clinician review result contract
2. define `clinician_outputs` and all nested item types
3. define final note section types
4. define review action request and response types
5. define encounter status values for the new workflow
6. preserve old types while introducing the new contract cleanly

The target model must support final clinician review without forcing UI code to infer medication changes, follow-up, tests, referrals, or final note sections from raw summary text.

### Phase 2: Backend Response Adapter

Update `function_app.py` next.

Required work:

1. add a backend builder function that assembles the clinician review result from current encounter and job data
2. keep `build_job_result(...)` for backward compatibility while introducing the new primary encounter review result
3. extend summary generation output or mapping so the backend returns clinician-facing sections, not only research-style summary text
4. normalize timeline, structured findings, follow-up, medication changes, tests, referrals, and final note fields in the backend
5. make `GET /api/encounters/{encounter_id}/results` return the new review contract

Do not force the frontend to derive the clinician note structure from raw strings when the backend can emit it once.

### Phase 3: Automatic Orchestration

Still in `function_app.py`, change the workflow trigger model.

Required work:

1. remove the need for human draft validation before processing starts
2. ensure uploaded audio and ambient session completion automatically trigger the same processing path
3. preserve explicit clinician review, but move it to the end of the pipeline
4. add or revise statuses so the encounter can move through `capturing`, `processing`, `ready_for_review`, `approved`, and `failed`
5. add final review endpoints such as approve, save clinician edits, and regenerate

Keep the processing pipeline continuous and encounter-centric.

### Phase 4: API Client And Transport Refactor

Update these files:

1. `frontend-react/src/api/encountersApi.ts`
2. `frontend-react/src/api/jobsApi.ts`
3. `frontend-react/src/assistant/transport/AssistantTransport.ts`

Required work:

1. add typed client methods for encounter review results and review actions
2. make encounter review the primary frontend contract
3. keep legacy job methods only as transitional helpers where needed
4. make transport methods reflect automatic processing plus final review instead of draft-first review

### Phase 5: State Model Refactor

Update `AssistantSessionStore.ts`.

Required work:

1. stop centering the store on draft-first workflow state
2. add state for processing progress, review result, reviewed note, and review actions
3. preserve transcript and evidence state as secondary supporting data
4. update system copy so it no longer describes draft review as the gate before outputs

### Phase 6: Route And Screen Refactor

Update these files:

1. `frontend-react/src/app/router/index.tsx`
2. `frontend-react/src/features/upload/UploadPage.tsx`
3. `frontend-react/src/features/ambient/AmbientScribePage.tsx`
4. `frontend-react/src/features/encounters/EncounterReviewPage.tsx`
5. `frontend-react/src/features/results/ResultsPage.tsx`

Required work:

1. make the workflow effectively become `Intake -> In Progress -> Final Review`
2. make `EncounterReviewPage.tsx` the main final clinician review surface
3. move processing visuals out of the final review center and into transitional states only
4. make `ResultsPage.tsx` either a processing handoff surface or a lower-priority technical view
5. make the clinician land on final note first, not a developer-style analysis board

### Phase 7: Clinician-Focused Result Components

Update these files:

1. `frontend-react/src/features/results/SummaryPanel.tsx`
2. `frontend-react/src/features/results/EvidencePanel.tsx`
3. `frontend-react/src/features/results/OutputActionRail.tsx`
4. `frontend-react/src/features/results/OutputsReadyPanel.tsx`
5. `frontend-react/src/features/results/AdvancedDataSection.tsx`

Required work:

1. render final note sections cleanly and prominently
2. show clinician cards for follow-up, meds, tests, and referrals
3. keep transcript, entities, relations, and assertions behind optional disclosure
4. make `Approve`, `Edit`, and `Regenerate` the primary review actions
5. demote technical or export-heavy views

### Phase 8: Final Visual Cleanup

Update `frontend-react/src/index.css` last.

Required work:

1. remove remaining developer/dashboard-heavy presentation patterns
2. make the review experience quiet, standard, and clinician-friendly
3. preserve mobile and desktop usability
4. keep one dominant primary action above the fold per screen

## Non-Negotiable Constraints

1. do not start with CSS-only work
2. do not make the frontend reverse-engineer the final note from raw summary text if the backend can emit structured fields
3. do not break existing backend routes without providing a compatibility path during migration
4. do not leave the app in a mixed state where the UI expects a new contract the backend does not emit yet
5. do not reintroduce developer-first workflow language in clinician screens

## Verification Requirements

You must verify each completed slice.

Minimum verification before claiming meaningful progress:

1. backend code still parses or compiles where applicable
2. `frontend-react` passes `npm run build`
3. if a UI slice is changed, the route still renders without runtime errors
4. the encounter results contract matches `api.ts`
5. the final review screen is clinician-first rather than analysis-first

## Final Output Expectations

When reporting progress, always include:

1. what contract changes were made
2. what backend routes or builders changed
3. what state and transport changes were made
4. what screens were refactored
5. what remains
6. what was verified

## Execution Instruction

Execute this refactor in the order above.

Do not stop at architecture discussion unless a genuine blocker prevents implementation.

If you need to narrow scope for one session, complete at least:

1. `api.ts` exact schema
2. backend encounter review response builder
3. transport/client alignment

Only then move into UI refactoring.