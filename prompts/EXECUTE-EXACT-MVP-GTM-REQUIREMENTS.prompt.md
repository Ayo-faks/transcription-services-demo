# Execute Exact MVP Go-To-Market Requirements

I am working in `/home/ayoola/streaming_agents/transcription-services-demo`.

Your task is to implement the exact agreed MVP go-to-market requirements for the clinician review experience.

You must execute against the live codebase, not assumptions. Verify every claim against the real backend and frontend before editing files. Repo reality wins over plan assumptions.

## Core Decision Already Made

Do not redesign the product around a full always-on 5-section note.

For the MVP, the primary clinician note must be:

1. `Visit Summary` or `HPI`
2. `Assessment`
3. `Plan`

`ROS` and `PE` are optional, conditional sections only.

They must only appear when supported by explicit evidence.

If evidence is weak or absent, do not render fake filler note content.

## Exact MVP Requirements

### Required sections

The final clinician-facing note must always support:

1. `Visit Summary` or `HPI`
2. `Assessment`
3. `Plan`

### Conditional sections

`ROS` may appear only when symptom/assertion evidence is strong enough.

`PE` may appear only when objective findings exist, such as:

1. vitals
2. measurements
3. physical examination findings

If `ROS` or `PE` evidence is not strong enough, omit the section or handle it as explicitly unavailable. Do not fabricate content.

### What the clinician must still see

The review screen must still include:

1. the primary clinician note first
2. medication changes
3. follow-up instructions
4. tests
5. referrals
6. transcript and structured evidence in secondary disclosure
7. `Approve`, `Edit`, and `Regenerate` actions

### What must stop happening

1. greetings or pleasantries must not become `HPI`
2. generic placeholders such as “pending clinician review” must not be the dominant note content
3. empty or failed transcription must not become a completed clinician note
4. the frontend must not reverse-engineer note sections from loose summary prose if the backend can compose them explicitly

## Mandatory Source Of Truth

Use these files as the primary implementation targets:

1. `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py`
2. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/shared/types/api.ts`
3. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/SummaryPanel.tsx`
4. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/OutputsReadyPanel.tsx`
5. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/AnalysisResultsPanel.tsx`
6. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/encounters/EncounterReviewPage.tsx`
7. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/api/encountersApi.ts`
8. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/index.css`

Reference for related product direction:

1. `/home/ayoola/streaming_agents/transcription-services-demo/prompts/EXECUTE-MVP-GO-TO-MARKET-NOTE-REQUIREMENTS.prompt.md`
2. `/home/ayoola/streaming_agents/transcription-services-demo/prompts/EXECUTE-CLINICIAN-AUTO-PIPELINE-REFACTOR.prompt.md`
3. `/home/ayoola/streaming_agents/transcription-services-demo/prompts/EXECUTE-CLINICIAN-CALM-UI-REDESIGN.prompt.md`

## Mandatory Review Before Editing

Before changing any file, inspect the live code and verify:

1. where note sections are currently composed in the backend
2. which sections are true structured outputs versus fallback-derived text
3. which workflow outputs already strongly support `Plan`
4. which workflow outputs already strongly support `Assessment`
5. whether `HPI` is currently polluted by transcript-opening greetings or non-clinical phrases
6. whether the current pipeline can actually support `ROS` and `PE`
7. which frontend components assume all five note sections always exist

Do not skip this review.

## Exact Implementation Outcome Required

When this task is complete, the app must behave like this:

1. the backend emits a stable clinician note contract centered on `Visit Summary/HPI`, `Assessment`, and `Plan`
2. `Plan` is composed primarily from structured workflow outputs such as medication changes, follow-up instructions, tests, referrals, monitoring, and precautions
3. `Assessment` is composed from structured findings and clinically relevant extracted evidence
4. `Visit Summary/HPI` is composed from transcript, timeline, diarized phrases, symptom evidence, and context, not from the first sentence fallback alone
5. `ROS` is shown only if symptom/assertion evidence is sufficient
6. `PE` is shown only if objective evidence exists
7. greetings do not become `HPI`
8. failed or empty transcription does not produce a misleading completed note
9. the React review screen puts the clinician note first and treats transcript/evidence as secondary support

## Required Implementation Sequence

### Phase 1: Lock The MVP Note Contract

Update backend and typed frontend contracts first.

Required work:

1. define a first-class note model for `visit_summary` or `hpi`, `assessment`, and `plan`
2. make `ros` and `pe` optional or conditional in the contract
3. preserve compatibility where practical but do not preserve bad semantics

### Phase 2: Replace Weak Backend Fallbacks

Update `function_app.py`.

Required work:

1. reduce or remove weak fallback logic that produces fake note sections
2. explicitly derive each primary note section from workflow outputs
3. prevent greeting-first transcript fallback from producing bad `HPI`
4. keep note composition in the backend, not the frontend

### Phase 3: Align The React Review Experience

Update the clinician review components.

Required work:

1. make the primary note show `Visit Summary/HPI`, `Assessment`, and `Plan` first
2. show `ROS` and `PE` only when meaningful
3. stop presenting low-signal filler as legitimate note text
4. preserve action cards and evidence sections

### Phase 4: Preserve Trust

Required work:

1. ensure sparse evidence is handled honestly
2. ensure failed/empty transcription cannot produce a fake completed note
3. keep the review surface clinically credible for MVP go-to-market

## Explicit Derivation Rules

### `Visit Summary` or `HPI`

Allowed sources:

1. transcript
2. diarized phrases
3. timeline
4. symptom/context evidence

Must include when available:

1. presenting complaint
2. onset or duration
3. progression
4. associated symptoms
5. relevant modifiers/context

Must exclude:

1. greetings
2. pleasantries
3. non-clinical opening chatter

### `Assessment`

Allowed sources:

1. structured findings
2. clinically relevant entities
3. assertions/relationships when meaningful
4. clinician summary or problem framing outputs

Must read as an impression, not a raw fact dump.

### `Plan`

Allowed sources:

1. medication changes
2. follow-up instructions
3. tests
4. referrals
5. monitoring steps
6. safety-net or return precautions if present

This should be the strongest section in the MVP.

### `ROS`

Allowed sources:

1. symptom findings
2. negation/assertion metadata

Do not render unless the evidence is good enough.

### `PE`

Allowed sources:

1. vitals
2. measurements
3. objective examination findings

Do not render unless objective evidence exists.

## Non-Negotiable Constraints

1. Do not force all five note sections to render for every encounter.
2. Do not leave the frontend to infer note structure from generic prose.
3. Do not retain clearly bad note text just for compatibility.
4. Do not break approve, edit, regenerate, or technical results flows.
5. Do not treat transcript evidence as the note itself.

## Verification Requirements

Before claiming completion, verify all of the following:

1. the backend emits the agreed MVP note contract
2. `Visit Summary/HPI`, `Assessment`, and `Plan` are explicitly derived
3. `Plan` is composed from structured workflow outputs
4. greetings do not become `HPI`
5. `ROS` is omitted or conditionally shown when evidence is weak
6. `PE` is omitted or conditionally shown when objective evidence is absent
7. failed or empty transcription cannot produce a misleading completed note
8. the React app still builds successfully
9. any touched backend tests still pass

## Final Output Requirements

When complete, provide:

1. what exact contract changes were made
2. what backend derivation rules were changed
3. what frontend note/review components changed
4. what verification was run
5. what remains for later phases
6. any evidence-quality limitations still present

## Execution Instruction

Execute these exact MVP requirements directly.

Do not stop at analysis unless a genuine blocker prevents implementation.