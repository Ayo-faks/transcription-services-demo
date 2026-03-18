# Clinician Calm UI Redesign Plan

This plan captures the clinician-facing UI simplification direction for the React frontend in `transcription-services-demo/frontend-react`.

It is intended to be the durable implementation reference for future sessions. It aligns with the earlier session planning artifacts and converts them into a repo-saved source of truth.

## Objective

Refactor the React shell and core clinician workflow into a calmer, premium experience that preserves the existing backend contracts and encounter lifecycle while reducing visible UI complexity.

The target experience is:

1. one dominant action above the fold on each major screen
2. minimal cognitive load during live capture
3. helper surfaces that are available but not visually dominant
4. clinician-first framing instead of architecture-first framing
5. no regression to the existing encounter, draft review, approval, and outputs workflow

## Product Decisions

The redesign direction is based on these decisions:

1. keep the three-step workflow structure: Visit Intake, Draft Review, Outputs
2. use a clinical calm tone rather than a dashboard-heavy tone
3. simplify the assistant moderately, not eliminate it
4. keep the assistant discoverable but compact and on-demand by default
5. preserve the existing route structure and backend semantics unless repo reality forces a narrower change

## Core UX Rules

1. every clinician screen should expose exactly one dominant verb above the fold
2. explanatory copy should be minimal and state-based, not instructional by default
3. the assistant should not be the loudest surface on any primary workflow page
4. draft review must remain explicit and separate from output generation
5. advanced or technical data should be reachable, but never dominate the main clinical interpretation

## Screen Direction

### 1. Global Shell

Keep the current three-step navigation, but reduce chrome and helper noise.

Target changes:

1. preserve the left rail as orientation, not as a feature surface
2. reduce repeated assistant launch controls
3. keep the header short and workflow-oriented
4. remove architecture-facing language from the main clinician flow

Primary files:

1. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/shell/layout/AppShell.tsx`
2. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/index.css`

### 2. Visit Intake

Make the intake screen resolve to one clear start action.

Target changes:

1. keep `Start Ambient Scribe` as the dominant primary action
2. keep upload available, but demote it visually to a secondary path
3. remove dense chips, highlight tiles, and duplicate explanation blocks from the default viewport
4. keep processing and upload behavior intact

Primary files:

1. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/upload/UploadPage.tsx`
2. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/index.css`

### 3. Ambient Scribe Active Session

Make live capture feel like a dedicated consult surface rather than a general app page.

Target changes:

1. center the active session around a clear orb or status treatment
2. keep the timer, current state, and fixed control bar explicit
3. keep transcript visibility optional and hidden by default
4. maintain the explicit session-state model already established in the app
5. preserve the stop-to-review handoff

Primary files:

1. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/ambient/AmbientScribePage.tsx`
2. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/index.css`
3. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/shell/useAssistantController.ts`

Reference plan already in repo:

1. `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-AMBIENT-SESSION-UX-OPTIMIZATION.md`

### 4. Draft Review

Make review center on note quality and evidence confidence.

Target changes:

1. organize the page around note, evidence, and action
2. make the draft text the visual center
3. keep transcript and evidence secondary but trustworthy
4. only surface processing animation or pipeline detail after the clinician chooses to process
5. preserve save, finalize, and process semantics

Primary files:

1. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/encounters/EncounterReviewPage.tsx`
2. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/index.css`

### 5. Outputs

Make outputs readable as a clinical outcome, not a dense analysis board.

Target changes:

1. keep the clinician summary as the visual center of gravity
2. keep readiness and evidence visible, but calmer and less metric-heavy
3. move advanced data and technical exports into lower-priority disclosure
4. keep the existing data plumbing and summary parsing logic intact

Primary files:

1. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/ResultsPage.tsx`
2. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/SummaryPanel.tsx`
3. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/EvidencePanel.tsx`
4. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/OutputActionRail.tsx`
5. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/OutputsReadyPanel.tsx`
6. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/AdvancedDataSection.tsx`
7. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/index.css`

### 6. Assistant Surface

Keep assistant capability, but de-emphasize it in the main clinician workflow.

Target changes:

1. default to a compact `Ask` or `Open assistant` entry point
2. reduce status-pill density and system-language overload
3. hide docked or expanded surface language from the primary workflow framing
4. keep richer assistant surfaces available only when explicitly opened

Primary files:

1. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/shell/AssistantShell.tsx`
2. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/shell/AgentSurfaceHost.tsx`
3. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/index.css`

## Execution Order

Implement in this order unless actual code dependencies force a narrow adjustment:

1. simplify the global shell
2. redesign Visit Intake
3. reduce assistant density and mode visibility
4. tighten Ambient Scribe into a dedicated active session surface
5. restructure Draft Review around note, evidence, and action
6. simplify Outputs hierarchy and advanced disclosure
7. perform a shared visual cleanup pass across touched screens

## Non-Negotiable Constraints

1. do not break the encounter lifecycle
2. do not remove or bypass draft review
3. do not collapse approval and output generation into one action
4. do not break the current backend contracts unless a concrete issue makes a narrow contract change unavoidable
5. do not copy sample UIs wholesale; adapt patterns to the HealthTranscribe product

## Verification

Before claiming the redesign slice is complete, verify:

1. the React app passes `npm run lint`
2. the React app passes `npm run build`
3. Visit Intake has one unmistakable primary action above the fold
4. Ambient Scribe makes live state obvious and transcript optional
5. Draft Review still supports save, approval, and processing without regression
6. Outputs center on summary and next-step readiness rather than dense data presentation
7. the assistant remains available but is no longer visually dominant on first load

## Related References

These repo documents should be read with this plan:

1. `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-AMBIENT-SESSION-UX-OPTIMIZATION.md`
2. `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-REACT-MVP-IMPLEMENTATION.md`
3. `/home/ayoola/streaming_agents/transcription-services-demo/GAP-ANALYSIS.md`

These earlier session artifacts informed this repo-saved plan:

1. `/memories/session/plan.md`
2. `/memories/session/ux-spec.md`
3. `/memories/session/execution-order.md`