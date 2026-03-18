# Execute Production Retrieval Hardening Plan

I am working in `/home/ayoola/streaming_agents/transcription-services-demo`.

Your task is to execute the production-grade retrieval hardening plan described in:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-PRODUCTION-RETRIEVAL-HARDENING.md`

You must treat that saved markdown plan as the architectural source of truth, but you must verify every step against the real codebase before implementing changes. Repo reality wins over assumptions.

## Objective

Productionize encounter-local retrieval so the chatbot can answer clinician questions from local transcript, extracted entities, extracted relations, and doctor-analysis summary data using Azure AI Search as the retrieval backend.

The resulting slice must deliver:

1. auto-generated doctor-analysis summary during encounter processing
2. Azure AI Search indexing for transcript, entities, relations, and summary sections
3. hybrid retrieval instead of the current local substring filter
4. a single production chatbot surface in `frontend-react`
5. first-class citations in the streamed assistant UI
6. automated gold-question and paraphrase regression tests

## Mandatory Review Before Any Code Change

Before you edit code, inspect the real files and answer these questions for yourself:

1. Does the saved plan match the actual encounter processing, summary generation, and assistant query paths?
2. Can Azure AI Search be introduced by extending the existing encounter-context projector rather than replacing it?
3. Are you keeping encounter-local retrieval authoritative and separate from future global retrieval?
4. Are you making `frontend-react` the production assistant owner rather than splitting effort across two assistant UIs?
5. Are citations attached to streamed turns rather than generic session messages?
6. Are regression tests asserting grounded facts and citation metadata instead of brittle whole-string equality?
7. Are you removing silent fallback behavior if Azure AI Search is required for this slice?

If the full plan is too large for one edit batch, narrow the implementation slice without violating the saved plan’s architecture.

## Required Source References

Saved plan:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-PRODUCTION-RETRIEVAL-HARDENING.md`

Primary backend:

- `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py`
- `/home/ayoola/streaming_agents/transcription-services-demo/local.settings.example.json`
- `/home/ayoola/streaming_agents/transcription-services-demo/requirements.txt`
- `/home/ayoola/streaming_agents/transcription-services-demo/infra/main.bicep`

Primary frontend:

- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/shared/types/api.ts`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/api/encountersApi.ts`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/api/client.ts`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/shell/useAssistantController.ts`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/shell/AssistantShell.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/state/AssistantTurnsStore.ts`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/runtime/agentRuntimeTypes.ts`

Legacy assistant surface to retire or bypass:

- `/home/ayoola/streaming_agents/transcription-services-demo/frontend/index.html`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend/app.js`

Regression and browser automation:

- `/home/ayoola/streaming_agents/transcription-services-demo/package.json`
- `/home/ayoola/streaming_agents/transcription-services-demo/capture-screenshots.js`
- `/home/ayoola/streaming_agents/transcription-services-demo/samples/`

## Non-Negotiable Constraints

1. Treat `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-PRODUCTION-RETRIEVAL-HARDENING.md` as the governing plan for this execution.
2. Keep `function_app.py` authoritative unless introducing stable Search integration seams requires adjacent helper extraction.
3. Treat `frontend-react` as the only production assistant surface for this slice.
4. Do not spend effort preserving the legacy heuristic assistant in `frontend/app.js` except to bypass or retire it from the production path.
5. Azure AI Search is required for retrieval in this slice. Do not silently fall back to the old substring filter.
6. Preserve the current encounter-context projector as the canonical normalization seam.
7. Keep retrieval read-oriented and provenance-aware.
8. Keep assistant answers grounded in local encounter data and citations.
9. Keep global retrieval out of scope.
10. Build incrementally and validate every meaningful slice.

## Required Implementation Sequence

### Phase 1

Stabilize retrieval inputs.

Required work:

1. generate `job.llm_summary` during encounter processing
2. keep the summary route for regeneration or refresh, not first-time availability
3. fix the relation-shape mismatch before relation indexing
4. address long-transcript truncation risk enough that retrieval is not silently incomplete

### Phase 2

Add Azure AI Search configuration and index schema.

Required work:

1. add Search endpoint, auth, index name, and embedding settings to backend configuration
2. add required SDK dependencies
3. define one clinical-context index for transcript chunks, entity docs, relation docs, and summary section docs
4. include filterable provenance and encounter/job metadata

### Phase 3

Index from the write path.

Required work:

1. build Search docs from the existing context projector
2. index immediately after successful encounter processing
3. index immediately after summary persistence
4. do not index from read routes

### Phase 4

Replace local substring retrieval with hybrid Search retrieval.

Required work:

1. replace the current substring filtering path
2. keep the encounter-context response contract stable
3. update assistant answer assembly so streamed answers and citations are grounded in Search results

### Phase 5

Unify the visible assistant surface and citations.

Required work:

1. ensure the active chatbot box uses the same encounter-local retrieval runtime consistently
2. add first-class citation UI to streamed turns with source type, title, and provenance
3. keep `messages` as compatibility notices only

### Phase 6

Add regression coverage.

Required work:

1. add gold-question tests using the sample consultation
2. add harder paraphrase-question tests
3. verify API and UI behavior

## Verification Loop

For each meaningful slice, you must:

1. inspect the affected backend and frontend contracts
2. update both sides of any typed schema changes
3. run the relevant build and validation commands
4. fix errors and rebuild until clean
5. verify retrieval behavior with real endpoint calls, not just type-checking

## Final Verification Requirements

You must verify all of the following before claiming completion:

1. encounter processing now produces summary text automatically
2. Azure AI Search contains transcript, entity, relation, and summary docs
3. encounter-local retrieval returns expected results for symptoms, medications, measurements, tests, and follow-up questions
4. `/api/encounters/{encounter_id}/assistant/query` emits streamed events and citations grounded in Search results
5. the visible production chatbot surface uses the React retrieval runtime consistently
6. citations render clearly in the UI with source type, title, and provenance
7. gold and paraphrase regression suites pass
8. lint, build, and backend compile all pass

## Drift Prevention Rules

1. Do not reintroduce the old substring filter as a hidden fallback.
2. Do not leave two different chatbot runtimes in production.
3. Do not create a second retrieval schema that diverges from the current context projector.
4. Do not treat summary generation as optional for first-time retrieval.
5. Do not mark the task complete until Azure AI Search-backed retrieval, citations, and tests are all working together.