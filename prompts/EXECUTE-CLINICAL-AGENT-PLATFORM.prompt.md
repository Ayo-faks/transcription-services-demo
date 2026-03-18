# Execute Clinical Agent Platform Plan

I am working in `/home/ayoola/streaming_agents/transcription-services-demo`.

Your task is to execute the production-grade clinical agent platform plan described in:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-CLINICAL-AGENT-PLATFORM.md`

You must treat that saved markdown plan as the architectural source of truth, but you must also verify every step against the actual codebase before implementing changes. The repo reality wins over assumptions.

## Objective

Evolve HealthTranscribe into a production-grade React-based clinical agent platform while preserving the current Azure Functions backend as the system of record.

The target platform must support:

1. a clinical context layer
2. an operational context layer
3. an action layer
4. a shared encounter-scoped context substrate in the SPA that can later become patient-context when a real patient key exists
5. modern streamed chat responses
6. an agent platform architecture where chat, voice, and future specialized agents share runtime, state, and tools while exposing different surfaces

## Mandatory Review Before Any Code Change

Before you edit code, you must inspect the current implementation and explicitly answer these questions for yourself using the real files:

1. Does the plan match the current backend routes and current frontend provider boundaries?
2. Is the next phase achievable with minimal churn to `function_app.py`?
3. Are you treating encounter-context as the current canonical substrate rather than inventing patient aggregation?
4. Are you preserving the distinction between clinical context, operational context, and action execution?
5. Are you keeping Voice Live websocket transport separate from future streamed chat transport?
6. Are you preserving the current React provider stack and extending it rather than duplicating it?
7. Are your new contracts strongly typed and verifiable from backend to frontend?

If the current phase in the saved plan is too large for one change, narrow the slice without violating the architecture.

## Required Source References

Saved plan:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-CLINICAL-AGENT-PLATFORM.md`

Primary backend:

- `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py`

Primary React frontend:

- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/App.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/app/router/index.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/app/providers/RuntimeConfigProvider.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/app/providers/PlatformShellProvider.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/app/providers/AssistantWorkspaceProvider.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/state/AssistantSessionStore.ts`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/state/assistantTypes.ts`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/transport/AssistantTransport.ts`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/transport/voiceLiveSession.ts`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/tools/CurrentViewProvider.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/tools/GlobalKnowledgeProvider.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/shell/AssistantShell.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/upload/UploadPage.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/encounters/EncounterReviewPage.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/ResultsPage.tsx`
- `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/shared/types/api.ts`

You may inspect any other repo files needed to validate implementation feasibility.

## Non-Negotiable Constraints

1. Preserve `function_app.py` as the backend source of truth unless a backend change is required to support shared context, normalized projections, streaming assistant contracts, or action preview contracts.
2. Treat `frontend-react` as the primary implementation target.
3. Do not spend effort maintaining full feature parity in the legacy static frontend during this refactor.
4. Start encounter-scoped, not patient-scoped. Do not invent patient aggregation until a real patient or subject key exists.
5. Keep operational integrations contracts-first. Use interfaces and mock providers before any live insurer, scheme, treatment, or email connectors.
6. Keep the clinical context layer read-oriented and provenance-aware.
7. Keep the action layer preview-first, auditable, and separate from retrieval and chat.
8. Treat `CurrentViewProvider` as supplemental route context, not the canonical shared context store.
9. Treat `GlobalKnowledgeProvider` as an extension seam, not as proof that global retrieval already exists.
10. Do not reuse the Voice Live websocket path for streamed text chat.
11. Do not introduce new technologies unless they are justified by the existing codebase and the saved plan.

## Current Codebase Facts You Must Respect

1. The backend already has two workflow families: job-based upload processing and encounter-based ambient assistant processing.
2. Encounters and jobs are stored in Cosmos DB in the current backend and differentiated by `record_type`.
3. The current React app already has a meaningful provider stack and should be extended, not replaced.
4. The current assistant is one shared session store and one transport, not yet a registry-driven multi-agent runtime.
5. Route pages already publish structured view context through `CurrentViewProvider`.
6. `AssistantShell` currently mixes UI and orchestration and is therefore a refactor target.

## Target Platform Shape

Build toward the contracts and layering in the saved plan.

### Platform layers

1. clinical context layer
2. operational context layer
3. action layer
4. agent platform layer

### Agent platform contracts

Build toward these runtime concepts:

1. `AgentDefinition`
2. `AgentRuntime`
3. `EncounterContextState`
4. `AgentTurn`
5. `AgentThread`
6. `AgentSurfaceConfig`
7. `ToolDefinition`
8. `StreamingEnvelope`
9. `OperationalContextSnapshot`
10. `ActionPreview`

`PatientContextState` is future-facing only. Do not start there.

### Agent composition rule

Agents are not single components. They are runtime contracts with shared state and pluggable UI surfaces.

Components should be surfaces such as:

1. chat panel
2. voice panel
3. threads drawer
4. reasoning summary panel
5. citations panel
6. action composer
7. context inspector

Do not add speculative surfaces with no implementation need.

## Required Implementation Sequence

### Phase 0

Contract review and baseline capture.

Required outputs before any large code change:

1. current route and endpoint inventory
2. current provider and store inventory
3. target schema list for context, streaming, tools, and actions

### Phase 1

Stabilize existing seams with minimal churn.

Required work:

1. add typed helper seams around encounter and job persistence
2. add mapper or projector seams for encounter context assembly
3. extract orchestration out of `AssistantShell` without breaking current surfaces
4. do not introduce new public endpoints yet unless the current slice explicitly needs one

### Phase 2

Implement the shared encounter context read model and expose:

1. `GET /api/encounters/{encounter_id}/context`

Support lightweight filters such as `q`, `category`, `assertion`, and `limit`.

### Phase 3

Add operational context provider contracts and mock providers for:

1. eligibility
2. scheme qualification
3. treatment lookup
4. prior-auth summaries
5. communications or email preview

### Phase 4

Create shared React state for:

1. encounter context
2. streamed turns and threads
3. agent registry and runtime state
4. action previews and operational snapshots

Do not delete `AssistantSessionStore` prematurely. Migrate responsibilities intentionally.

### Phase 5

Introduce the agent platform architecture in React:

1. `AgentDefinition` registry
2. `AgentRuntime` controller layer
3. `AgentSurfaceHost`
4. `chat-agent` and `voice-agent` using the same shared context and turn state

### Phase 6

Add streamed chat responses using a dedicated text transport over SSE or chunked NDJSON from the backend.

The frontend must:

1. create the assistant turn immediately
2. append deltas incrementally
3. render tool and reasoning events separately
4. support cancellation and stable request ids
5. avoid breaking the existing ambient voice workflow

### Phase 7

Add preview-first action workflows for emails, treatment requests, and future prior-auth execution.

### Phase 8

Add production hardening:

1. auth and RBAC
2. audit trails
3. idempotency
4. PHI-safe telemetry
5. approval policies
6. timeout and retry rules for provider calls

## Implementation Rules

1. Examine current contracts thoroughly before changing them.
2. Keep code modular and strongly typed.
3. Prefer extending existing React provider and transport seams over inventing parallel architecture.
4. Keep route context supplemental, not canonical.
5. Keep chat and voice on one shared encounter-context substrate.
6. Do not implement hidden chain-of-thought exposure. If reasoning is shown, it must be a product-safe reasoning summary or tool trace.
7. Build incrementally and validate each slice before moving on.
8. If a phase requires too much backend churn, narrow the slice and stabilize seams first.
9. Preserve public contracts that existing pages already consume unless the current slice is explicitly migrating them.

## Required Verification Loop

For every meaningful slice, you must do all of the following before claiming completion:

1. review the backend and frontend contracts touched by the slice
2. verify the typed schema changes are reflected on both sides
3. run the relevant build or validation commands
4. if the build fails, fix and rebuild until it succeeds
5. confirm the change did not break upload, encounter review, results routing, or ambient assistant basics

## Verification Requirements

You must verify:

1. the encounter context endpoint returns stable, typed, searchable data
2. chat-agent and voice-agent can switch surfaces without losing context or active turns
3. streaming responses render incrementally in the React UI
4. encounter-scoped questions can be answered from normalized backend context, not DOM scraping
5. operational mock flows work via provider contracts
6. action previews are explicit, auditable, idempotency-aware, and not auto-executed
7. builds succeed after each meaningful slice

## Drift Prevention Rules

1. Do not skip ahead to speculative patient-level architecture.
2. Do not replace the current provider stack with a monolithic global store.
3. Do not collapse clinical context, operational lookup data, and action execution into one undifferentiated assistant object.
4. Do not claim streaming is implemented unless a real backend stream endpoint and incremental frontend reducer both exist.
5. Do not introduce live external action execution before preview, audit, approval, and idempotency controls are in place.

## Final Output Expectations

When a slice is done, provide:

1. what was implemented
2. which part of the saved plan it satisfies
3. which contracts were added or changed
4. what verification was run
5. what remains for later phases
6. any risks, gaps, or blockers still present

## Execution Instruction

Execute directly against the saved plan in:

- `/home/ayoola/streaming_agents/transcription-services-demo/PLAN-CLINICAL-AGENT-PLATFORM.md`

Do not stop at analysis unless a genuine blocker prevents implementation.