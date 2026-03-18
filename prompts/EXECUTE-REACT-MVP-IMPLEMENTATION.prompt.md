# Execute React MVP Implementation Plan

I am working in `/home/ayoola/streaming_agents/transcription-services-demo`.

Your task is to execute the React MVP implementation plan described in:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-REACT-MVP-IMPLEMENTATION.md`

You must treat that saved markdown plan as the implementation source of truth for this task. Verify every change against the actual codebase before editing files. Repo reality wins over assumptions.

## Objective

Convert the current React application into a clinician-facing MVP by simplifying the shell, reframing the Results route as an Outputs page, simplifying the Review and Intake routes, and aligning the assistant with product outcomes rather than backend artifacts.

The first slice must keep existing backend contracts intact wherever possible.

## Required Source of Truth

You must read and follow:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-REACT-MVP-IMPLEMENTATION.md`

## Primary Files

The implementation plan is tied directly to these React files:

- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/shell/layout/AppShell.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/ResultsPage.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/SummaryPanel.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/clinicalSummary.ts`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/encounters/EncounterReviewPage.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/upload/UploadPage.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/app/router/index.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/tools/CurrentViewProvider.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/shell/AssistantShell.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/shell/useAssistantController.ts`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/shared/types/api.ts`

Supporting reference:

- `/home/ayoola/streaming_agents/transcription-services-demo/GAP-ANALYSIS.md`

## Mandatory Constraints

1. Keep the current backend contract stable unless a later output-action slice proves a contract expansion is required.
2. Do not open new product scope such as patient-longitudinal context, global retrieval expansion, or broad operational integrations.
3. Do not rewrite the React app architecture. Extend and simplify the current implementation.
4. Follow the phase order in the saved plan.
5. Prefer derived UI state from current `JobResult` and `ClinicalSummaryResponse` payloads before changing shared types.
6. Keep the route structure stable unless a route change is clearly necessary.
7. The React app should read as a three-step clinician workflow:
   - Visit Intake
   - Draft Review
   - Outputs

## Required Execution Order

Execute in this order unless the actual code forces a narrow adjustment:

1. Simplify the shell in `AppShell.tsx`.
2. Refactor `ResultsPage.tsx` into the MVP Outputs page.
3. Reuse `SummaryPanel.tsx` and `clinicalSummary.ts` as the primary summary center.
4. Add results subcomponents under `frontend-react/src/features/results/`.
5. Simplify `EncounterReviewPage.tsx` into the Draft Review step.
6. Simplify `UploadPage.tsx` into Visit Intake.
7. Update route meaning in `router/index.tsx` only if needed.
8. Update `CurrentViewProvider.tsx` usage across Intake, Review, and Outputs.
9. Align `AssistantShell.tsx` and `useAssistantController.ts` with the MVP language and prompts.
10. Only after those steps, add one narrow output action if time and scope allow.

## Detailed Expectations

### Shell

In `AppShell.tsx`:

1. Replace architecture-facing copy with workflow-facing copy.
2. Reduce emphasis on explicit assistant surfaces in the main clinician path.
3. Keep the shell functional while changing the visible product framing.

### Results Route

In `ResultsPage.tsx`:

1. Remove the top-level technical tabs as the main user interaction.
2. Replace them with sections for:
   - visit-complete header
   - output action rail
   - clinician summary
   - outputs-ready panel
   - evidence panel
   - advanced data section
3. Keep current polling and data loading behavior intact.
4. Use existing data to derive readiness states.

### Results Subcomponents

Create the results subcomponents described by the plan, using current data only:

1. `OutputActionRail.tsx`
2. `OutputsReadyPanel.tsx`
3. `EvidencePanel.tsx`
4. `AdvancedDataSection.tsx`

### Review Route

In `EncounterReviewPage.tsx`:

1. Preserve draft editing and approval behavior.
2. Make the page hierarchy clearly support clinician review and approval before processing.

### Intake Route

In `UploadPage.tsx`:

1. Preserve upload and ambient-start capability.
2. Reframe the route as Visit Intake.

### Assistant Context and Prompts

In `CurrentViewProvider.tsx` usage, `AssistantShell.tsx`, and `useAssistantController.ts`:

1. Publish product-facing facts such as follow-up readiness, referral readiness, medication changes, and tests ordered.
2. Avoid leading with raw entity counts, relation counts, or internal pipeline language.

## Verification Requirements

You must verify all of the following before finishing:

1. The shell communicates a three-step journey.
2. The Outputs page answers:
   - what happened in the visit
   - what is ready now
   - what should the clinician do next
3. The Review page clearly supports clinician approval before processing.
4. The Intake page communicates one starting action for a visit.
5. The assistant is grounded in product outcomes rather than raw technical artifacts.
6. The React app still builds successfully after the changes.

## Validation Loop

For each meaningful slice:

1. inspect the affected React files before editing
2. implement the smallest coherent change set
3. run the relevant build or error checks
4. fix issues before moving on

## Output Expectations

When complete, provide:

1. what was implemented
2. which phases of the saved plan were completed
3. which files were changed
4. what verification was run
5. what remains for the next slice

## Critical Instruction

The saved plan file is required context for this task. Do not execute from memory or summary alone. Read and follow:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-REACT-MVP-IMPLEMENTATION.md`

Do not stop at analysis unless a genuine blocker prevents implementation.