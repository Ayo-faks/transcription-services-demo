# Execute Clinician Calm UI Redesign Plan

I am working in `/home/ayoola/streaming_agents/transcription-services-demo`.

Your task is to execute the clinician-facing UI simplification and redesign plan described in:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-CLINICIAN-CALM-UI-REDESIGN.md`

You must treat that saved markdown plan as the implementation source of truth, but you must verify every step against the real codebase before changing files. Repo reality wins over assumptions.

## Objective

Refactor the React frontend into a calmer, premium clinician workflow with:

1. one dominant action above the fold on every major clinician screen
2. a focused ambient capture surface
3. a clearer draft review experience
4. a calmer outputs experience
5. a helper assistant that is available but not visually dominant
6. no regression to the existing encounter, draft approval, and output generation flow

## Required Plan Reference

Read this file first and keep it aligned with your work:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-CLINICIAN-CALM-UI-REDESIGN.md`

Also read these related references when they are relevant to the slice you implement:

1. `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-AMBIENT-SESSION-UX-OPTIMIZATION.md`
2. `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-REACT-MVP-IMPLEMENTATION.md`
3. `/home/ayoola/streaming_agents/transcription-services-demo/GAP-ANALYSIS.md`

## Required Source References

Primary implementation targets:

1. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/shell/layout/AppShell.tsx`
2. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/upload/UploadPage.tsx`
3. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/ambient/AmbientScribePage.tsx`
4. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/encounters/EncounterReviewPage.tsx`
5. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/ResultsPage.tsx`
6. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/SummaryPanel.tsx`
7. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/EvidencePanel.tsx`
8. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/shell/AssistantShell.tsx`
9. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/shell/AgentSurfaceHost.tsx`
10. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/index.css`

Reference sample repo to learn from where useful, not to copy blindly:

1. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/components/ActiveSession.tsx`
2. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/components/SessionControls.tsx`
3. `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/frontend/src/components/VoiceOrb.tsx`

## Mandatory Review Before Editing

Before editing any file, verify these points from the actual code:

1. how the current shell exposes workflow and assistant entry points
2. which parts of Visit Intake currently compete visually
3. how the current ambient session states are rendered
4. how stop currently routes into draft review
5. which review and output behaviors must remain intact after presentation changes
6. which assistant mechanics are product-critical versus presentation-only

If the saved plan must be narrowed into a single implementation slice, narrow it without violating the plan direction.

## Required Implementation Sequence

### Phase 1

Simplify the global shell and shared visual baseline.

Required work:

1. preserve the three-step workflow nav
2. reduce repeated assistant launch controls
3. reduce assistant-first framing in the shell
4. establish calmer shared layout and hierarchy styles in `index.css`

### Phase 2

Redesign Visit Intake.

Required work:

1. make `Start Ambient Scribe` the clear primary action
2. demote upload to a quieter secondary path
3. remove or reduce dense chips, highlight tiles, and recommendation panels from the initial viewport
4. preserve upload and processing behavior

### Phase 3

Reduce assistant density and architecture visibility.

Required work:

1. collapse status-pill density
2. hide docked or expanded surface language from the primary workflow experience
3. make the assistant compact and on-demand by default
4. keep richer assistant surfaces available when explicitly opened

### Phase 4

Tighten Ambient Scribe into a dedicated consult surface.

Required work:

1. keep the explicit session-state model intact
2. make the active screen centered on orb, state, timer, and bottom controls
3. keep transcript optional and hidden by default
4. preserve stop-to-review handoff

### Phase 5

Restructure Draft Review.

Required work:

1. center the page on note, evidence, and action
2. keep the draft text as the primary reading surface
3. keep transcript and evidence secondary but trustworthy
4. show processing animation only after the clinician initiates processing

### Phase 6

Simplify Outputs.

Required work:

1. keep the clinician summary as the center of gravity
2. make evidence and readiness calmer and easier to scan
3. move technical or advanced data into lower-priority disclosure
4. preserve existing data fetching and parsing behavior

### Phase 7

Perform a shared visual cleanup pass.

Required work:

1. normalize spacing, border weight, shadow use, and accent use
2. remove leftover dense dashboard patterns that conflict with the redesign
3. ensure narrow-width layouts preserve the same primary-action hierarchy

## Non-Negotiable Constraints

1. do not break the encounter lifecycle
2. do not remove or bypass draft review
3. do not collapse approval and output generation into one action
4. do not change backend contracts unless a concrete issue makes a narrow change necessary
5. do not copy sample UI wholesale
6. treat the saved plan as authoritative unless actual code forces a more precise implementation

## Verification Requirements

You must verify all of the following before claiming completion:

1. the React app builds successfully with `npm run build`
2. the React app passes `npm run lint`
3. Visit Intake has one unmistakable primary action above the fold
4. Ambient Scribe makes live status obvious and transcript optional
5. Draft Review still preserves save, finalize, and process behavior
6. Outputs center on summary and next-step readiness rather than dense technical presentation
7. the assistant remains available but is no longer visually dominant on first load

## Final Output Expectations

When the implementation slice is complete, provide:

1. what was implemented
2. which parts of the saved plan were completed
3. what verification was run
4. what remains for later phases
5. any risks or blockers still present

## Execution Instruction

Execute directly against the saved plan in:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-CLINICIAN-CALM-UI-REDESIGN.md`

Do not stop at analysis unless a genuine blocker prevents implementation.