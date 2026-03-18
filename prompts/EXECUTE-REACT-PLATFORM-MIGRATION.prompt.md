# Execute React Platform Migration

I am working in `/home/ayoola/streaming_agents/transcription-services-demo`.

Your task is to execute the React platform migration plan described in:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-REACT-PLATFORM-MIGRATION.md`

## Objective

Refactor the frontend into a React + TypeScript platform shell while preserving the current Azure Functions backend as the system of record.

The end-state must support:

1. a docked sidebar assistant
2. an expanded chatbot workspace
3. an ambient voice assistant surface
4. local screen-aware assistant context
5. future global retrieval without forcing all questions through RAG

## Non-Negotiable Constraints

1. Do not rewrite the backend first.
Keep `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py` as the source of truth and preserve current backend contracts unless a change is clearly necessary and justified.

2. Do not delete or replace the current static frontend immediately.
Create the React frontend in parallel so the existing app remains usable during migration.

3. Do not treat the Voice Live samples as copy-paste product code.
Reuse their architectural patterns only.

4. Do not couple current-screen questions to global retrieval.
Design separate abstractions for local view context and global knowledge retrieval.

5. Do not introduce iframe composition or separate standalone assistant apps.
The product must remain one shell.

## Source References

Primary backend:
- `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py`

Current frontend reference:
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend/index.html`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend/app.js`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend/styles.css`

Reference samples for architecture patterns:
- `/home/ayoola/streaming_agents/voicelive-samples/voice-live-universal-assistant/README.md`
- `/home/ayoola/streaming_agents/voicelive-samples/python/voice-live-voicerag-assistant/README.md`

## What To Deliver

Execute the migration incrementally with production-minded architecture.

### Phase 1

Create a new parallel React + Vite + TypeScript frontend, for example under:

- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react`

Set up:

- React
- TypeScript
- routing
- runtime config compatibility with the existing generated `config.js` model
- shell layout
- design tokens or reusable UI primitives

### Phase 2

Define and implement the shell and assistant architecture:

- `PlatformShellProvider`
- `AssistantWorkspaceProvider`
- `AssistantShell`
- `AssistantSessionStore`
- `AssistantTransport`
- `CurrentViewProvider`
- `GlobalKnowledgeProvider`

Use clear, explicit module boundaries.

### Phase 3

Port the existing upload and processing workflow to React using the current backend endpoints:

- `POST /api/upload`
- `POST /api/process/{jobId}`
- `GET /api/status/{jobId}`
- `GET /api/results/{jobId}`
- `GET /api/summary/{jobId}`

### Phase 4

Port the results workspace into React with clear feature slices:

- transcription
- entities
- relations
- FHIR
- AI summary

### Phase 5

Port the assistant flow using React-native abstractions rather than DOM mutation.
Preserve current workflow semantics:

- create encounter
- start capture
- append transcript segments
- stop capture
- save draft
- finalize draft
- process clinically

### Phase 6

Add route-level structured view context so the assistant can answer questions about the current screen without DOM scraping.

### Phase 7

Leave global retrieval as a clean extension point if it cannot be fully implemented in the first slice.

## How To Work

1. Start by examining the current frontend and backend contracts thoroughly.
2. Build the React shell in parallel, not in place.
3. Preserve behavior before optimizing architecture further.
4. Keep code modular and strongly typed.
5. Use the smallest backend changes necessary.
6. Validate each migration slice before moving on.

## Verification Requirements

You must verify:

1. the new React shell can run locally
2. upload flow works against the current backend
3. results rendering works for the current backend payloads
4. assistant state can support docked, expanded, and ambient surfaces
5. current-screen context is structured and queryable
6. no regression is introduced to the current backend contracts unless explicitly intended

## Final Output Expectations

When done, provide:

1. what was implemented
2. what remains for later phases
3. architectural decisions taken
4. any risks or blockers still present

Execute the plan directly. Do not stop at analysis unless a genuine blocker prevents implementation.