# Execute MVP Go-To-Market Note Requirements

I am working in `/home/ayoola/streaming_agents/transcription-services-demo`.

Your task is to update the app to the agreed MVP note and review requirements so the product is credible for go-to-market.

You must execute against the real codebase, not assumptions. Verify every step against the actual backend and React frontend before editing files. Repo reality wins over plan assumptions.

## Objective

Refactor the clinician-facing review experience so it is aligned to a realistic MVP documentation model rather than a weak five-section fallback note.

The MVP must prioritize:

1. a strong clinician-readable note
2. a strong action-oriented plan
3. trustworthy structured evidence
4. explicit failure behavior when note sections cannot be supported by evidence
5. minimal fake or filler clinical note content

## Agreed MVP Note Model

The primary MVP note should be built around:

1. `Visit Summary` or `HPI`
2. `Assessment`
3. `Plan`

`ROS` and `PE` are not mandatory top-level sections for the MVP.

They may be included only when explicit supporting evidence exists.

If the evidence is weak or absent, do not generate filler text such as generic “pending clinician review” or “not identified in generated output” language unless the product requires a sparse placeholder for legal or workflow reasons.

## Product Rules

These are non-negotiable for this execution:

1. `Plan` is the strongest and most operationally important note section.
2. `Assessment` should summarize the system’s best-supported clinical impression.
3. `Visit Summary` or `HPI` should provide the patient story and relevant context.
4. `ROS` should be conditional and only shown when supported by symptom/assertion evidence.
5. `PE` should be conditional and only shown when supported by objective findings such as vitals, measurements, or exam findings.
6. Do not let greetings, pleasantries, or incidental transcript openings become `HPI` content.
7. Do not let empty, failed, or placeholder transcription content become a completed note.
8. Do not force the frontend to infer note sections from generic summary prose if the backend can compose them explicitly.

## Required Source Of Truth

Treat these files as the primary implementation anchors:

1. `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py`
2. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/shared/types/api.ts`
3. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/SummaryPanel.tsx`
4. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/OutputsReadyPanel.tsx`
5. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/AnalysisResultsPanel.tsx`
6. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/encounters/EncounterReviewPage.tsx`
7. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/shared/types/api.ts`
8. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/api/encountersApi.ts`
9. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/index.css`

Reference related direction when useful:

1. `/home/ayoola/streaming_agents/transcription-services-demo/prompts/EXECUTE-CLINICIAN-AUTO-PIPELINE-REFACTOR.prompt.md`
2. `/home/ayoola/streaming_agents/transcription-services-demo/prompts/EXECUTE-CLINICIAN-CALM-UI-REDESIGN.prompt.md`

## Mandatory Review Before Editing

Before any edits, inspect the real code and answer these questions for yourself:

1. Where are final note sections currently composed in the backend?
2. Which clinician-facing sections are currently true structured outputs versus fallback-derived text?
3. Which workflow outputs already provide strong support for `Plan`?
4. Which workflow outputs already provide enough evidence for `Assessment`?
5. Whether `HPI` is currently being polluted by transcript-opening greetings or non-clinical phrases.
6. Whether `ROS` and `PE` can be supported in the current pipeline or should be conditional/omitted.
7. Which frontend components currently assume all five note sections always exist.

You must verify what exists before changing any contract.

## Required End State

The final clinician review payload should explicitly support an MVP-safe note contract.

The backend should emit a note model that:

1. always supports `visit_summary` or `hpi`
2. always supports `assessment`
3. always supports `plan`
4. supports `ros` only when supported by evidence
5. supports `pe` only when supported by evidence
6. includes enough source evidence for the UI to explain why a section is present or absent

The final clinician review screen should:

1. present the primary note first
2. keep action cards for medications, follow-up, tests, and referrals
3. keep transcript/entities/relationships/findings as evidence, not as the main note
4. avoid showing fake low-signal note sections when the underlying evidence is weak

## Implementation Standard

Do not treat this as a styling-only task.

This is a contract and note-composition task first, then a UI adjustment task second.

## Required Implementation Sequence

### Phase 1: Stabilize The MVP Note Contract

Update `frontend-react/src/shared/types/api.ts` and backend response shapes first.

Required work:

1. define the primary MVP note structure explicitly
2. make `visit_summary` or `hpi`, `assessment`, and `plan` first-class note outputs
3. make `ros` and `pe` optional or conditional sections rather than mandatory always-present sections
4. ensure the frontend does not have to guess section meaning from generic text
5. preserve compatibility where practical during migration

### Phase 2: Replace Weak Fallback Note Composition

Update `function_app.py`.

Required work:

1. identify and reduce weak fallback logic for HPI/ROS/PE/Assessment/Plan
2. add explicit derivation rules for each note section from workflow outputs
3. prevent greetings or incidental transcript openings from becoming `HPI`
4. compose `Plan` primarily from medication changes, follow-up instructions, tests, referrals, monitoring, and safety-net outputs
5. compose `Assessment` from structured findings and clinically relevant extracted evidence
6. compose `Visit Summary` or `HPI` from transcript/timeline/context rather than generic first-sentence fallback
7. render `ROS` only when symptom/assertion evidence is sufficient
8. render `PE` only when objective findings exist

### Phase 3: Align Review UI To The MVP Note Model

Update the clinician-facing React components.

Required work:

1. make the primary note layout center on `Visit Summary/HPI`, `Assessment`, and `Plan`
2. show `ROS` and `PE` only when populated with meaningful evidence, or present them in a lower-priority way if product requirements still need them visible
3. stop presenting generic filler text as if it were meaningful clinical content
4. keep action cards and evidence sections intact
5. keep approval, edit, regenerate, and technical results flows working

### Phase 4: Preserve Trust And Failure Behavior

Required work:

1. ensure empty or failed transcription does not produce a misleading completed note
2. ensure sparse evidence results in omission or explicit low-confidence handling, not fabricated note prose
3. keep the review screen trustworthy even when the pipeline is incomplete or weak

## Explicit Section Derivation Guidance

Use these rules when implementing explicit note composition:

### `Visit Summary` or `HPI`

Primary sources:

1. transcript
2. diarized patient/clinician phrases
3. timeline
4. symptom entities and related context

Must include where available:

1. presenting complaint
2. duration or onset
3. progression
4. associated symptoms
5. modifiers or context

Must exclude:

1. greetings
2. pleasantries
3. clinician administrative talk that is not part of the illness narrative

### `Assessment`

Primary sources:

1. structured findings
2. clinically relevant entities
3. relationships and assertions when available
4. clinician summary or problem framing outputs

Must provide a concise impression, not raw evidence dumping.

### `Plan`

Primary sources:

1. medication changes
2. follow-up instructions
3. tests
4. referrals
5. monitoring steps
6. return precautions if available

This section should be the strongest and most explicit.

### `ROS`

Primary sources:

1. symptom findings
2. assertion or negation metadata

Only include if the evidence quality supports a meaningful ROS.

### `PE`

Primary sources:

1. vitals
2. measurements
3. objective examination findings

Only include if objective evidence exists.

## Non-Negotiable Constraints

1. Do not keep all five note sections as always-on mandatory UI if the data quality does not support that.
2. Do not let filler placeholders become the dominant clinician experience.
3. Do not let transcript-first heuristics replace explicit note composition.
4. Do not move note composition responsibility into the frontend.
5. Do not break the existing clinician action rail and review workflow.
6. Do not collapse evidence and note composition into one undifferentiated summary blob.

## Verification Requirements

Before claiming completion, verify all of the following:

1. the backend emits a stable MVP note contract
2. `Visit Summary/HPI`, `Assessment`, and `Plan` are populated from explicit derivation logic
3. greetings do not become `HPI`
4. `Plan` is primarily derived from structured workflow results
5. `ROS` is omitted or conditionally shown when evidence is insufficient
6. `PE` is omitted or conditionally shown when objective evidence is absent
7. sparse or failed transcription does not produce a misleading completed note
8. the React app still builds successfully
9. any backend tests touched by the slice still pass

## Final Output Expectations

When complete, provide:

1. what MVP note contract changes were implemented
2. which backend note-composition rules changed
3. which frontend review components were updated
4. what verification was run
5. what remains for later phases
6. any known risks or evidence gaps still present

## Execution Instruction

Execute directly against the agreed MVP go-to-market note requirements above.

Do not stop at analysis unless a genuine blocker prevents implementation.