# Production Retrieval Hardening Plan

I am working in `/home/ayoola/streaming_agents/transcription-services-demo`.

This plan defines the next production-grade retrieval slice for HealthTranscribe.

## Objective

Harden encounter-local retrieval so the production chatbot can answer clinician questions from local transcript, extracted entities, extracted relations, and doctor-analysis summary data with explicit citations and stable streamed responses.

The target result is:

1. encounter processing automatically generates doctor-analysis summary text
2. Azure AI Search becomes the required encounter-local retrieval backend
3. transcript, entities, relations, and summaries are indexed as one clinical-context retrieval substrate
4. the React migration shell becomes the production assistant surface
5. the visible chatbot box uses the same encounter-local retrieval runtime consistently
6. streamed turns expose first-class citations with source type, title, and provenance
7. an automated regression suite validates gold questions and paraphrase questions against the sample consultation

## Decisions

1. Production chatbot surface: use `frontend-react`, not the legacy static frontend.
2. Retrieval rollout: Azure AI Search is required for this slice, not a best-effort fallback.
3. Retrieval scope: encounter-local retrieval remains authoritative; global retrieval remains a separate future concern.
4. Canonical retrieval schema: reuse the current encounter-context projector output rather than inventing a second incompatible document model.

## Current State Summary

### Backend

1. Encounter processing already creates `job.medical_entities` in `process_encounter` in `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py`.
2. Doctor-analysis summary text is not generated during processing. It is still created lazily by `GET /api/summary/{job_id}` and cached onto `job.llm_summary`.
3. Encounter-local context is currently projected by `build_context_item` and `build_encounter_context_items` in `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py`.
4. Retrieval is currently a substring filter over serialized context items, not a production retrieval backend.
5. Streamed assistant responses already exist and currently answer from the encounter-local context contract.

### Frontend

1. The real retrieval runtime is in `frontend-react`.
2. The currently deployed legacy chat box in `frontend/app.js` is still a heuristic snapshot assistant and is not the same retrieval runtime.
3. Streamed turns and citations already have typed state in `frontend-react`, but the citation UI is still flattened and not first-class.

## Risks To Resolve Before Shipping

1. Relation-shape mismatch: relation projection currently expects `roles`, but the health-analysis output shape differs. Relations are not yet trustworthy for production indexing.
2. Long transcript truncation: current health-analysis and summary generation paths truncate inputs. That creates silent retrieval gaps for longer encounters.
3. Two assistant surfaces exist today: the legacy frontend and the React shell. Production cannot keep two different local-answering behaviors.

## Execution Plan

### Phase 1: Stabilize Retrieval Inputs

1. Update encounter processing in `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py` so successful processing writes both `medical_entities` and `llm_summary` in one lifecycle.
2. Preserve the standalone summary route for regeneration or cache refresh, but stop depending on it for first-time doctor-analysis availability.
3. Fix the current relation-shape mismatch before indexing relation data.
4. Address truncation behavior for transcript analysis and summary generation so production retrieval is not incomplete by design.

### Phase 2: Add Azure AI Search Configuration And Schema

1. Extend `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py` configuration to include Azure AI Search endpoint, auth, index name, and embedding settings.
2. Extend `/home/ayoola/streaming_agents/transcription-services-demo/local.settings.example.json` with local Search configuration.
3. Extend `/home/ayoola/streaming_agents/transcription-services-demo/requirements.txt` with the required Azure Search SDK dependencies.
4. Extend `/home/ayoola/streaming_agents/transcription-services-demo/infra/main.bicep` with production configuration for Search settings and identity access.
5. Define one clinical-context index for:
   - transcript chunks
   - entity documents
   - relation documents
   - summary section documents
6. Include filterable metadata such as:
   - `encounter_id`
   - `job_id`
   - `kind`
   - `category`
   - `source`
   - `assertion`
   - timestamps
   - provenance

### Phase 3: Reuse The Existing Projector As The Search Document Source

1. Treat `build_context_item` and `build_encounter_context_items` in `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py` as the source of truth for normalized retrieval content.
2. Build Azure AI Search documents from those projected items rather than inventing a parallel schema.
3. Keep deterministic keys based on the current context item ids or stable derivatives.
4. Chunk transcript and summary content into citation-sized sections while preserving provenance.

### Phase 4: Index On The Write Path

1. Add indexing immediately after successful encounter processing in `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py`.
2. Add indexing immediately after summary persistence in `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py`.
3. Do not index from read routes such as the encounter-context endpoint.
4. Keep the indexing seam structured so it can later move to an async outbox or queue without changing the projector contract.

### Phase 5: Replace Local Substring Retrieval With Azure AI Search Hybrid Retrieval

1. Remove the current substring-based encounter-local filtering path in `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py`.
2. Replace it with Azure AI Search hybrid retrieval that combines:
   - lexical matching
   - vector similarity
   - encounter-local filters
3. Preserve the current encounter-context response contract shape so frontend consumers do not need a second migration.

### Phase 6: Keep Assistant Answers Grounded In Search Results

1. Update backend assistant answer assembly in `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py` so responses are composed from Azure AI Search results.
2. Preserve the streamed envelope contract and ensure it emits:
   - `turn.started`
   - `turn.tool_*`
   - `turn.citation`
   - `turn.completed`
3. Ensure every assistant answer can surface source type, title, and provenance from local retrieval results.

### Phase 7: Make The React Shell The Production Assistant Surface

1. Treat `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react` as the production assistant owner.
2. Stop treating `/home/ayoola/streaming_agents/transcription-services-demo/frontend/app.js` as the local retrieval assistant implementation.
3. Ensure the visible chatbot box routes through the same encounter-local retrieval runtime already wired in:
   - `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/shell/useAssistantController.ts`
   - `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/api/encountersApi.ts`

### Phase 8: Add First-Class Citation UI

1. Extend streamed-turn rendering in `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/shell/AssistantShell.tsx`.
2. Extend citation state usage in `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/state/AssistantTurnsStore.ts`.
3. Show citations as structured UI elements rather than a flattened text line.
4. Each citation should display:
   - source type
   - title
   - provenance
5. Keep `messages` as compatibility or session notices only.

### Phase 9: Add Automated Regression Coverage

1. Add a gold-question regression suite using the sample consultation.
2. Add a paraphrase-question regression suite with harder retrieval wording.
3. Use Playwright at repo root for the first production-grade test runner because it already exists in `/home/ayoola/streaming_agents/transcription-services-demo/package.json`.
4. Cover both:
   - direct API assistant-query behavior
   - visible React assistant UI behavior
5. Validate:
   - required clinical facts in answers
   - citation presence
   - provenance presence
   - streamed event sequence
   - paraphrase robustness

## Required File Targets

Primary backend:

- `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py`
- `/home/ayoola/streaming_agents/transcription-services-demo/local.settings.example.json`
- `/home/ayoola/streaming_agents/transcription-services-demo/requirements.txt`
- `/home/ayoola/streaming_agents/transcription-services-demo/infra/main.bicep`

Primary frontend:

- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/shared/types/api.ts`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/api/encountersApi.ts`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/shell/useAssistantController.ts`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/shell/AssistantShell.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/state/AssistantTurnsStore.ts`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/runtime/agentRuntimeTypes.ts`

Legacy surface to retire or bypass:

- `/home/ayoola/streaming_agents/transcription-services-demo/frontend/index.html`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend/app.js`

Regression tests:

- `/home/ayoola/streaming_agents/transcription-services-demo/package.json`
- `/home/ayoola/streaming_agents/transcription-services-demo/capture-screenshots.js`

## Verification Requirements

1. After encounter processing, confirm both `medical_entities` and `llm_summary` exist without a separate summary call.
2. Confirm Azure AI Search contains transcript, entity, relation, and summary documents with stable keys and provenance.
3. Confirm encounter-local retrieval returns the expected document kinds for symptoms, medications, measurements, tests, and follow-up questions.
4. Confirm `/api/encounters/{encounter_id}/assistant/query` emits stable streamed envelopes and citations from Azure AI Search-backed local retrieval.
5. Confirm the visible chatbot box in the production assistant surface uses the same retrieval runtime consistently.
6. Confirm citations render in the UI with source type, title, and provenance.
7. Confirm gold questions and paraphrase questions pass in automated regression tests.
8. Confirm the app fails clearly if Azure AI Search is unavailable or misconfigured rather than silently falling back to the old substring filter.

## Definition Of Done

This slice is complete only when:

1. doctor-analysis summary is created automatically during encounter processing
2. Azure AI Search is the encounter-local retrieval backend
3. transcript, entities, relations, and summaries are indexed and retrievable
4. the production chatbot surface uses the React retrieval runtime
5. citations are first-class in the streamed assistant UI
6. automated regression tests cover gold questions and paraphrases
7. lint, build, backend compile, and retrieval verification all pass