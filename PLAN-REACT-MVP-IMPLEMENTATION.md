# React MVP Implementation Plan

## Objective

Convert the current React application into a clinician-facing MVP by changing the existing React shell and three current feature routes in a strict order: shell first, outputs page second, review page third, intake page fourth, then assistant-context cleanup.

The fastest path is to keep the current backend contracts intact and refactor presentation, routing language, and derived output states in the existing React files instead of opening new product scope.

## Current Constraints

1. The backend in `function_app.py` already supports the existing upload workflow, encounter review workflow, clinical processing workflow, and encounter-local assistant workflow.
2. The React app already has the core routes needed for an MVP:
   - `frontend-react/src/features/upload/UploadPage.tsx`
   - `frontend-react/src/features/encounters/EncounterReviewPage.tsx`
   - `frontend-react/src/features/results/ResultsPage.tsx`
3. The current assistant is encounter-scoped only. No durable patient key or patient-longitudinal context exists.
4. The current gap is not core extraction capability. The main gap is workflow clarity, product framing, and presentation of outputs.

## Target MVP Journey

The MVP should read as a three-step clinician journey:

1. Visit Intake
2. Draft Review
3. Outputs

The MVP should not foreground internal architecture concepts such as docked mode, expanded mode, ambient mode, entities, relations, or FHIR as the main user journey.

## Implementation Order

### Phase 1: Simplify the Shell and Navigation

**Primary file**

- `frontend-react/src/shell/layout/AppShell.tsx`

**Goal**

Replace architecture-facing language and navigation with workflow-facing language and actions.

**Changes**

1. Replace shell copy that foregrounds assistant surfaces with copy that foregrounds the clinician workflow.
2. Change labels and entry points so the user sees the product as Visit Intake, Draft Review, and Outputs.
3. Reduce emphasis on explicit surface-selection language in the primary flow.
4. Keep the underlying assistant mechanics intact; change presentation first.

**Expected result**

The shell communicates a three-step product journey instead of exposing internal assistant modes.

### Phase 2: Refactor the Results Route into the MVP Outputs Page

**Primary file**

- `frontend-react/src/features/results/ResultsPage.tsx`

**Goal**

Make the Results route the primary Outputs page for the MVP.

**Changes**

1. Remove the top-level pipeline-tab model as the main interaction.
2. Replace it with outcome-oriented sections:
   - visit-complete header
   - output action rail
   - clinician summary
   - outputs-ready panel
   - evidence panel
   - advanced data section
3. Keep current data fetching, polling, and route loading behavior.
4. Prefer derived UI state from existing `JobResult` and `ClinicalSummaryResponse` data.

**Expected result**

The page answers three questions immediately:

1. What happened in the visit?
2. What is ready now?
3. What should the clinician do next?

### Phase 3: Elevate the Existing Summary into the Primary Page Center

**Primary files**

- `frontend-react/src/features/results/SummaryPanel.tsx`
- `frontend-react/src/features/results/clinicalSummary.ts`

**Goal**

Use the existing summary renderer as the center of the Outputs page rather than a secondary tab.

**Changes**

1. Keep the current summary parsing logic.
2. Move model, token, and cost metadata out of the default main view and into advanced detail.
3. Present the clinician summary as the main reading surface for the route.

**Expected result**

The clinician summary becomes the default center of gravity on the Outputs page.

### Phase 4: Add Results Subcomponents for the New Outputs Layout

**Primary location**

- `frontend-react/src/features/results/`

**Goal**

Break the Outputs page into focused React components driven by current data.

**New components**

1. `OutputActionRail.tsx`
2. `OutputsReadyPanel.tsx`
3. `EvidencePanel.tsx`
4. `AdvancedDataSection.tsx`

**Expected behavior**

1. `OutputActionRail.tsx` exposes primary next-step actions such as patient follow-up, referral, admin packet, export, and assistant query.
2. `OutputsReadyPanel.tsx` translates current encounter outputs into buyer-facing readiness states.
3. `EvidencePanel.tsx` presents symptoms, medications, findings, tests, and follow-up items in product language.
4. `AdvancedDataSection.tsx` preserves access to transcript, structured evidence, FHIR payload, and raw extraction detail.

**Expected result**

The route is componentized for a product-first Outputs page without requiring backend contract changes.

### Phase 5: Simplify the Draft Review Route

**Primary file**

- `frontend-react/src/features/encounters/EncounterReviewPage.tsx`

**Goal**

Make the current encounter review page feel like the Draft Review step of the MVP.

**Changes**

1. Keep draft editing, transcript segment review, finalize, and process actions.
2. Reorder and simplify the page hierarchy so the clinician sees:
   - reviewed draft
   - supporting evidence context
   - process action
3. Remove any unnecessary assistant-first framing from the page body.

**Expected result**

The route clearly supports clinician approval before clinical processing.

### Phase 6: Simplify the Intake Route

**Primary file**

- `frontend-react/src/features/upload/UploadPage.tsx`

**Goal**

Turn the current upload route into Visit Intake.

**Changes**

1. Keep file upload and ambient-start capability.
2. Simplify the page copy so it communicates one starting action for a visit.
3. Make the route feel like the beginning of a clinician workflow, not a platform demo surface.

**Expected result**

The page becomes a clear Visit Intake step for the MVP journey.

### Phase 7: Keep Routing Stable, but Align Route Meaning

**Primary file**

- `frontend-react/src/app/router/index.tsx`

**Goal**

Retain the current stable route structure while aligning labels, headings, and route ownership with the MVP journey.

**Changes**

1. Keep the current route structure unless a later step requires a change.
2. Update route labels and page headings so the routes read as Intake, Review, and Outputs.

**Expected result**

Minimal routing churn during the first MVP slice.

### Phase 8: Ground the Assistant in Product Outcomes

**Primary file**

- `frontend-react/src/assistant/tools/CurrentViewProvider.tsx`

**Secondary files**

- `frontend-react/src/features/upload/UploadPage.tsx`
- `frontend-react/src/features/encounters/EncounterReviewPage.tsx`
- `frontend-react/src/features/results/ResultsPage.tsx`

**Goal**

Make the assistant understand product outcomes rather than backend artifacts.

**Changes**

1. The Intake route should publish facts such as file readiness and visit-start state.
2. The Review route should publish draft status, transcript status, and processing readiness.
3. The Outputs route should publish facts such as follow-up readiness, referral readiness, medication changes, tests ordered, and output readiness.

**Expected result**

The assistant becomes more useful within the simplified product flow without changing scope beyond the current encounter.

### Phase 9: Align Assistant Copy and Prompt Framing

**Primary files**

- `frontend-react/src/assistant/shell/AssistantShell.tsx`
- `frontend-react/src/assistant/shell/useAssistantController.ts`

**Goal**

Align assistant copy, visible prompts, and suggested actions with the MVP journey.

**Changes**

1. Focus visible prompts on visit questions such as medication changes, next patient instructions, follow-up steps, and referral content.
2. Avoid exposing raw entity- or relation-count framing in the main assistant experience.

**Expected result**

The assistant reads like a visit-completion helper instead of a technical inspection tool.

### Phase 10: Add One Narrow Output Action After the React Experience Is Simplified

**Primary files**

- `frontend-react/src/features/results/ResultsPage.tsx`
- `frontend-react/src/features/results/OutputActionRail.tsx`
- `frontend-react/src/assistant/shell/useAssistantController.ts`

**Goal**

Add one narrow output action using current data and current action-preview seams.

**Recommended first action**

1. patient follow-up draft, or
2. referral handoff draft

**Reason**

Both map naturally onto the current summary and evidence data and do not require full operational integration before the UI becomes useful.

## Relevant Files

- `frontend-react/src/shell/layout/AppShell.tsx`
- `frontend-react/src/features/results/ResultsPage.tsx`
- `frontend-react/src/features/results/SummaryPanel.tsx`
- `frontend-react/src/features/results/clinicalSummary.ts`
- `frontend-react/src/features/encounters/EncounterReviewPage.tsx`
- `frontend-react/src/features/upload/UploadPage.tsx`
- `frontend-react/src/app/router/index.tsx`
- `frontend-react/src/assistant/tools/CurrentViewProvider.tsx`
- `frontend-react/src/assistant/shell/AssistantShell.tsx`
- `frontend-react/src/assistant/shell/useAssistantController.ts`
- `frontend-react/src/shared/types/api.ts`
- `GAP-ANALYSIS.md`

## Verification

1. After shell changes, confirm the shell communicates a three-step journey and no longer foregrounds internal assistant surface choices.
2. After Results page changes, confirm the Outputs page answers:
   - what happened in the visit
   - what is ready now
   - what should the clinician do next
3. After Review page changes, confirm the page clearly supports clinician approval before clinical processing.
4. After Intake page changes, confirm the page communicates one starting action for a visit.
5. After assistant-context and prompt changes, confirm the assistant is grounded in page outcomes such as follow-up readiness, referral readiness, medication changes, and tests ordered rather than raw technical artifacts.
6. Across all phases, confirm backend contracts remain unchanged unless a later dedicated output-action slice explicitly requires expansion.

## Decisions

1. React files to change first, in order:
   - `AppShell.tsx`
   - `ResultsPage.tsx`
   - results subcomponents
   - `EncounterReviewPage.tsx`
   - `UploadPage.tsx`
   - assistant context and prompt files
2. The Results route is the highest-leverage React refactor because it can turn current backend outputs into customer-visible value without backend changes.
3. The first output action should be presentation-level and template-backed before attempting full operational execution.
4. The route structure should remain stable during the first slice; prefer copy, layout, and component hierarchy changes before navigation churn.

## Further Considerations

1. If engineering capacity is tight, stop after Phases 1 through 5 and ship a design-led MVP slice before implementing live output actions.
2. If design capacity is tight, prototype the new Outputs page first because it determines the language and structure for the rest of the app.
3. Defer patient-longitudinal features, global retrieval, and broader operational agents until the three-page React workflow is coherent and demo-ready.