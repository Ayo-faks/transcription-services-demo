# Integration Planning Prompt

Use this prompt with a coding assistant to generate a concrete implementation plan for integrating the existing ambient transcription application with the Voice Live Universal Assistant.

## Prompt

You are working across two existing repositories in the same workspace:

- `/home/ayoola/streaming_agents/transcription-services-demo`
- `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant`

Your job is to generate a detailed implementation plan, not code yet.

## Product Goal

We already have an ambient transcription product in `transcription-services-demo` and a separate Voice Live conversational UI in `voice-live-universal-assistant`.

We want one integrated clinician workflow with this behavior:

1. User logs in and lands on the existing HealthTranscribe app.
2. The default experience remains the existing transcription workflow.
3. There is a clear `Assistant` option in the UI, ideally as a right-side panel or drawer rather than a separate application page.
4. The assistant can record doctor and patient conversation in real time.
5. The conversation should remain in a draft or reviewable state first.
6. When the doctor is satisfied, they click a clear button to finalize processing.
7. Only after that action, the system should run the clinical processing pipeline:
   - transcription finalization
   - medical entity extraction
   - relationship extraction
   - FHIR generation
   - result storage
8. Results should then appear in the existing HealthTranscribe analysis UI.

## Existing System Context

### Ambient transcription app (`transcription-services-demo`)

This repo already contains:

- Azure Functions Python backend in `function_app.py`
- Static frontend in `frontend/`
- Blob Storage for audio
- Cosmos DB for job state and results
- Azure Speech fast transcription
- Text Analytics for Health entity extraction
- relationship mapping
- FHIR export

The current UI is upload-first and batch/async oriented.

### Voice Live app (`voice-live-universal-assistant`)

This repo already contains:

- shared voice assistant frontend
- backend implementations for multiple languages
- JavaScript backend option already deployed and working in prior testing
- model mode and agent mode support
- a conversational Voice Live UX that can capture live voice sessions

## What I Need From You

Generate a structured plan that covers the following.

### 1. Architecture recommendation

Decide what the target integration architecture should be.

Specifically answer:

- Should `transcription-services-demo` remain the main host app?
- Should `voice-live-universal-assistant` be embedded as a panel, imported as components, or only mined for patterns?
- Which repo should become the long-term source of truth for frontend UX?
- Which repo should become the source of truth for backend APIs?
- What should be reused directly vs rewritten or adapted?

### 2. UX plan

Propose the best UX flow for clinicians.

Include:

- landing page behavior after login
- how the Assistant appears in the UI
- how recording starts and stops
- how draft transcript review works
- where the `Process Clinically` action lives
- how processed results map back into the existing results tabs

### 3. Repo integration strategy

Explain how to integrate the repos without creating a maintenance mess.

I want a recommendation among options such as:

- keep repos separate and integrate via API/contracts
- copy selected Voice Live frontend/backend modules into `transcription-services-demo`
- create a new shell app and consume both
- use one repo as reference only and implement directly in the other

State the recommended option and why.

### 4. Technical workstreams

Break the work into streams such as:

- frontend UX and navigation
- live capture/session management
- transcript draft state model
- processing trigger and job orchestration
- backend endpoints
- Cosmos/Blob state changes
- auth/login implications
- telemetry and auditability

### 5. API and data contract plan

Propose the new backend contracts needed.

Examples may include:

- create encounter session
- start live capture session
- append transcript draft chunks
- finalize transcript draft
- process finalized transcript
- fetch encounter results
- assistant tool endpoints over existing clinical job data

Do not write full implementation yet, but define what endpoints, payloads, and state transitions should exist.

### 6. Phased delivery plan

Produce phases such as:

- Phase 1: UX shell and assistant panel stub
- Phase 2: live transcript capture and draft review
- Phase 3: handoff into clinical processing pipeline
- Phase 4: assistant tools over stored results
- Phase 5: optional Foundry agent or RAG enhancements

For each phase include:

- goal
- files or folders likely affected
- dependencies
- key risks
- success criteria

### 7. Risks and decisions

Call out the most important product and engineering decisions, including:

- whether to use transcript-first integration or duplicate raw audio paths
- whether to keep batch processing semantics in the current backend
- whether to use model mode first or Foundry agent mode first
- how to maintain HIPAA-friendly auditability and minimize duplicated PHI pathways

## Constraints

- Favor minimal disruption to the existing `transcription-services-demo` user experience.
- Do not assume we want a full rewrite.
- Prefer one cohesive product UX over two visibly separate apps.
- Prefer an approach that is maintainable by a small startup team.
- Favor explicit doctor approval before full clinical extraction and storage.
- Use the existing screenshots and current HealthTranscribe UI structure as a guide.

## Deliverable Format

Return:

1. Executive recommendation
2. Target architecture
3. UX design recommendation
4. Repo integration strategy
5. Phased implementation plan
6. API/data contract outline
7. Risks and open questions

Be concrete and opinionated. If multiple options exist, choose one and justify it.