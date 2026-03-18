# Clinical Agent Platform Plan

## Objective

Evolve HealthTranscribe into a production-grade clinical agent platform while preserving the current Azure Functions backend as the system of record and the React SPA in `frontend-react` as the primary frontend.

The immediate delivery goal is not a full agentic rewrite. The immediate MVP goal is to productionize the current working application that already captures audio, processes encounters and jobs, and renders clinical results.

That means the first release target is:

1. secure and harden the current audio-to-results workflow
2. make the current encounter and results experience production-safe
3. add the smallest missing contracts needed for reliability and assistant readiness
4. defer the A2A + MCP + Agent Framework + Foundry redesign until the current product is operationally ready

The target platform must support:

1. a clinical context layer
2. an operational context layer
3. an action layer
4. a shared encounter-scoped context substrate in the SPA that can later grow into patient-context when a real patient key exists
5. streamed assistant responses with a modern assistant UX
6. an agent platform model where chat, voice, and future task agents share runtime, state, and tools while exposing different UI surfaces

The initial scope remains encounter-centric. Patient-level aggregation is explicitly deferred until the backend has a durable patient or subject identifier.

## Production-First Delivery Strategy

The roadmap is split into two major stages.

### Stage 1: Production MVP

Stage 1 is about taking the current working product to production without unnecessary architectural churn.

The MVP scope is:

1. authenticated and authorized access to the existing app
2. reliable upload, ambient capture, processing, and results workflows
3. hardened request validation, ownership checks, and concurrency handling
4. production-grade observability, audit logging, deployment checks, and rollback readiness
5. a stable encounter-scoped context contract that can support the current assistant and later platform work

The MVP is explicitly not:

1. a full multi-agent system
2. a full patient-longitudinal platform
3. live payer or scheme integrations
4. full A2A or MCP-based delegation across many remote agents

### Stage 2: Agentic Platform Evolution

Only after the current product is production-ready should the architecture evolve toward:

1. a client agent in the React SPA for UI state, approvals, local context injection, and streamed turn rendering
2. remote agents for orchestration and specialist task execution
3. Microsoft Agent Framework composition patterns
4. a Foundry-hosted orchestrator agent plus remote task agents
5. agent cards for capability discovery, skills, auth requirements, and routing metadata
6. MCP tool registry and governed action execution
7. A2A-based task delegation and agent discovery

This plan therefore prioritizes production readiness first and agentic expansion second.

## MVP Gaps That Must Be Closed Before Go-Live

Based on the current repo state, the highest-priority gaps before production MVP are:

1. authentication and access control
2. encounter and job ownership validation
3. consistent request and response schema validation
4. concurrency protection on draft and encounter updates
5. structured error contracts with correlation ids
6. dependency-aware health checks and App Insights dashboards
7. audit logging for reads, writes, approvals, and processing state changes
8. production deployment validation and rollback procedures
9. tighter CORS and secret management
10. stable encounter context endpoint for assistant-ready retrieval

These are release blockers.

The following items are important but post-MVP:

1. live external operational integrations
2. patient-level aggregation
3. multi-agent orchestration across many remote agents
4. A2A-first delegation design
5. broader MCP tool ecosystem

## Current Codebase Reality

This plan must be executed against the code that exists today, not against an idealized assistant platform.

### Backend Reality

The current backend lives primarily in `function_app.py` and already supports two distinct workflow families:

1. job-based upload and processing routes such as `POST /api/upload`, `POST /api/process/{job_id}`, `GET /api/status/{job_id}`, `GET /api/results/{job_id}`, and `GET /api/summary/{job_id}`
2. encounter-based ambient assistant routes such as `POST /api/encounters`, `GET /api/encounters/{encounter_id}`, `POST /api/encounters/{encounter_id}/capture/start`, `POST /api/encounters/{encounter_id}/capture/stop`, `POST /api/encounters/{encounter_id}/segments`, `PUT /api/encounters/{encounter_id}/draft`, `POST /api/encounters/{encounter_id}/finalize`, `POST /api/encounters/{encounter_id}/process`, and `GET /api/encounters/{encounter_id}/results`

The current persistence model stores both encounter records and job records in Cosmos DB using one container and `record_type` discrimination. Encounter records already carry draft text, draft segments, finalized text, processing job linkage, diarization metadata, and an event log.

### Frontend Reality

The React SPA already has the correct top-level composition seams:

1. `RuntimeConfigProvider` for API and Voice Live configuration
2. `PlatformShellProvider` for shell-level UI state
3. `GlobalKnowledgeProvider` as a future global retrieval seam, currently a stub
4. `CurrentViewProvider` for route-owned structured view context
5. `AssistantWorkspaceProvider` for constructing the shared `AssistantTransport`

The assistant runtime is not yet a true multi-agent platform. Today it is one shared Zustand session store plus one transport plus one shell component:

1. `AssistantSessionStore` owns encounter id, encounter status, draft state, transcript segments, chat messages, busy state, and last processed job id
2. `AssistantTransport` wraps encounter CRUD and Voice Live session construction
3. `AssistantShell` currently mixes orchestration and UI responsibilities
4. `CurrentViewProvider` gives supplemental route context for upload, review, and results routes
5. `GlobalKnowledgeProvider` does not yet retrieve real data

This means the plan must add platform structure incrementally. It must not pretend a registry, thread model, streaming turn model, or patient-context store already exists.

## Review Conclusion

The saved direction was strong but not production-grade enough as written.

It was directionally correct on:

1. keeping the React SPA as the primary target
2. treating the backend as the system of record
3. separating clinical context, operational context, and action layers
4. pushing toward shared runtime and surface composition

It was weak on:

1. grounding the plan in the current provider stack and current single-session assistant model
2. sequencing work to minimize backend churn in a single-file Functions app
3. explicitly distinguishing encounter-context now from patient-context later
4. constraining streaming work so it does not collide with the existing Voice Live websocket path
5. defining build, contract review, verification, and hardening gates concretely enough for a future implementation agent

This revised plan corrects those issues.

## Non-Negotiable Decisions

1. The React SPA in `frontend-react` is the primary implementation target.
2. The legacy static frontend is not a parity target for this platform architecture slice.
3. Existing Azure Functions routes remain authoritative unless a backend change is required to support shared context, typed projections, streaming chat, or action preview contracts.
4. Encounter scope is the canonical context boundary for the current implementation. Do not invent patient aggregation before a real patient key exists.
5. Operational integrations are contracts-first. Start with provider interfaces and mock implementations before any live insurer, scheme, treatment, or communication connectors.
6. The clinical context layer is read-oriented and provenance-aware.
7. The action layer is preview-first, auditable, approval-aware, and separate from retrieval and chat.
8. Route-owned view context remains supplemental. `CurrentViewProvider` must not become the canonical clinical context store.
9. Streaming chat must be added as a separate assistant endpoint. Do not overload the existing Voice Live websocket transport for text assistant turns.
10. Backend refactoring must start with helper seams and typed mappers in-place before any large multi-file extraction from `function_app.py`.

## Architectural Model

### Layer 1: Clinical Context Layer

The clinical context layer is the normalized, encounter-scoped read model derived from encounter and job outputs.

Its responsibilities are:

1. normalize clinical facts from encounter draft, finalized text, diarization, medical analysis, summaries, and encounter-linked job results
2. preserve provenance for facts, relations, assertions, diarization, summaries, and source record ids
3. provide read models for assistant retrieval and structured UI rendering
4. remain separate from draft-save, finalize, and process write workflows

Primary source inputs in the current repo are:

1. `EncounterSession.draft_text`
2. `EncounterSession.draft_segments`
3. `EncounterSession.finalized_text`
4. `EncounterSession.diarized_phrases`
5. `EncounterSession.events`
6. `TranscriptionJob.medical_entities`
7. `TranscriptionJob.llm_summary`
8. `build_job_result(job)` outputs

### Layer 2: Operational Context Layer

The operational context layer represents non-transcript business facts and external lookup results.

Its responsibilities are:

1. eligibility lookup summaries
2. scheme qualification and plan lookup summaries
3. treatment and provider lookup summaries
4. communication options and workflow status
5. freshness metadata and provider provenance

This layer starts with TypeScript interfaces, backend contract placeholders, and mock providers. No live integrations should appear before approval, audit, and idempotency rules are in place.

### Layer 3: Action Layer

The action layer handles side-effecting workflows.

Its responsibilities are:

1. preview and execute emails
2. preview and execute treatment requests
3. preview and execute future prior-authorization submissions
4. enforce approval, audit, idempotency, policy, and retry controls

The action layer must remain separate from the read-oriented clinical and operational context layers.

## Agent Platform Model

An agent is not a page component. The production model is:

1. a client agent in the SPA
2. remote orchestrator and task agents
3. a definition contract
4. a runtime controller
5. shared context state
6. shared turn and thread state
7. transport adapters
8. tool adapters
9. composable UI surfaces
10. agent cards for remote discovery and delegation

Today the repo has only a partial version of that model. The migration path must extend the existing seams rather than replace them wholesale.

For this repo, the platform should be introduced in two layers:

1. MVP layer: client-side assistant runtime plus stable backend context and action contracts
2. post-MVP layer: remote orchestrator and task agents using agent cards, task-agent delegation, MCP tools, and A2A-style inter-agent contracts

### Current Implementation Anchors

These modules are the correct anchor points and should be preserved:

1. `frontend-react/src/app/providers/RuntimeConfigProvider.tsx`
2. `frontend-react/src/app/providers/PlatformShellProvider.tsx`
3. `frontend-react/src/app/providers/AssistantWorkspaceProvider.tsx`
4. `frontend-react/src/assistant/state/AssistantSessionStore.ts`
5. `frontend-react/src/assistant/transport/AssistantTransport.ts`
6. `frontend-react/src/assistant/tools/CurrentViewProvider.tsx`
7. `frontend-react/src/assistant/tools/GlobalKnowledgeProvider.tsx`
8. `frontend-react/src/assistant/shell/AssistantShell.tsx`

### Post-MVP Agent Topology

The target post-MVP topology should explicitly distinguish:

1. `client-assistant-agent` in the React app
2. `platform-orchestrator-agent` as the primary remote agent
3. specialist remote task agents such as `clinical-summary-agent`, `scheduling-agent`, `email-agent`, `eligibility-agent`, and `prior-auth-agent`
4. MCP-exposed capability services behind governed backend tools

The orchestrator should use agent cards to understand available remote agents and delegate work to task agents rather than embedding all skills inside one remote agent.

### Target Contracts

#### AgentDefinition

Static metadata for each agent.

Fields:

1. `id`
2. `title`
3. `description`
4. `defaultMode`
5. `capabilities`
6. `enabledTools`
7. `requiredContexts`
8. `defaultSurfaces`
9. `streaming`
10. `actionPolicy`
11. `visibilityRules`

#### AgentRuntime

Live controller contract for a running agent instance.

Responsibilities:

1. `startTurn`
2. `appendDelta`
3. `completeTurn`
4. `failTurn`
5. `cancelTurn`
6. `switchSurface`
7. `hydrateContext`
8. `invokeTool`
9. `previewAction`

#### EncounterContextState

Canonical shared read model for the current implementation slice.

Fields:

1. encounter identity and status
2. draft metadata and versions
3. transcript segments and diarization summaries
4. normalized clinical facts and provenance
5. operational context snapshots
6. available actions and preview state
7. route supplements
8. freshness timestamps
9. linked job metadata

`PatientContextState` remains a future platform alias, not the first implementation artifact.

#### AgentTurn

Streamed conversation unit.

Fields:

1. `id`
2. `threadId`
3. `role`
4. `source`
5. `scope`
6. `status`
7. `requestId`
8. `parts`
9. `summary`
10. `toolEvents`
11. `citations`
12. `error`
13. `startedAt`
14. `completedAt`

#### AgentThread

Conversation container.

Fields:

1. `id`
2. `agentId`
3. `title`
4. `createdAt`
5. `updatedAt`
6. `contextSnapshotId`
7. `surfaceState`
8. `turnIds`

#### AgentSurfaceConfig

Pluggable UI composition metadata.

Fields:

1. `surfaceId`
2. `kind`
3. `placement`
4. `enabled`
5. `priority`
6. `featureFlags`
7. `renderConditions`

#### ToolDefinition

Lookup and command contract metadata.

Fields:

1. `id`
2. `kind`
3. `title`
4. `description`
5. `inputSchema`
6. `outputSchema`
7. `approvalRequired`
8. `auditLevel`
9. `allowedAgents`

#### StreamingEnvelope

Backend-to-frontend streamed event contract for chat responses.

Event kinds:

1. `turn.started`
2. `turn.delta`
3. `turn.reasoning_summary`
4. `turn.tool_started`
5. `turn.tool_delta`
6. `turn.tool_completed`
7. `turn.citation`
8. `turn.completed`
9. `turn.failed`
10. `turn.cancelled`

#### OperationalContextSnapshot

Contracts-first external context projection.

Fields:

1. eligibility responses
2. scheme qualification responses
3. payer and prior-auth summaries
4. treatment lookup results
5. communication options
6. per-provider freshness metadata

#### ActionPreview

Pre-execution artifact for regulated workflows.

Fields:

1. `actionId`
2. `toolId`
3. `title`
4. `target`
5. `summary`
6. `payloadPreview`
7. `approvalRequirements`
8. `idempotencyKey`
9. `riskFlags`
10. `auditMetadata`

## Agent Registry Direction

The registry should begin with:

1. `chat-agent`
2. `voice-agent`

These must share:

1. `EncounterContextState`
2. `AgentTurn` and thread state
3. `ToolDefinition` contracts
4. `ActionPreview` workflows

They should differ only by:

1. default surfaces
2. transport bindings
3. capability flags

Future agents should plug into the same runtime substrate:

1. `eligibility-agent`
2. `communications-agent`
3. `prior-auth-agent`
4. `treatment-request-agent`

## Frontend Direction

### Preserve Existing Provider Order

The current provider order is meaningful and should remain intact unless there is a proven reason to change it:

1. runtime config
2. shell provider
3. global knowledge provider
4. current view provider
5. assistant workspace provider
6. router

### Required Frontend Evolution

1. keep `AssistantSessionStore` as the short-term shell/session store rather than deleting it
2. add a dedicated shared encounter-context store beside the current assistant store
3. add a dedicated turn or thread store for streamed responses rather than overloading the current `messages` array forever
4. extract orchestration from `AssistantShell` into controller hooks or operations modules
5. keep route-owned state in pages, but treat route summaries as supplements to the shared encounter-context store
6. use `GlobalKnowledgeProvider` as the adapter seam for future global retrieval, not as a place to hold canonical encounter facts

### Surface Composition Rule

An agent should be rendered by an `AgentSurfaceHost`, not by one monolithic assistant component.

Surface examples:

1. chat panel
2. voice panel
3. threads drawer
4. reasoning summary panel
5. citations panel
6. action composer
7. context inspector

Do not build code-renderer or chart-renderer surfaces unless a concrete use case appears in this repo.

## Backend Direction

### Minimal-Churn Principle

The backend is a single-file Azure Functions app today. Production-grade improvement does not require immediate fragmentation into many modules.

The first objective is to introduce clear seams inside or adjacent to `function_app.py` for:

1. encounter persistence access
2. job persistence access
3. encounter-to-context projection
4. clinical fact normalization
5. assistant streaming response generation
6. action preview assembly

Move code only when the seam is stable enough to justify extraction.

### Shared Context Endpoint

Add an encounter-scoped backend context endpoint:

1. `GET /api/encounters/{encounter_id}/context`

This endpoint should return:

1. encounter metadata and workflow status
2. normalized clinical context derived from existing encounter and job records
3. provenance and freshness metadata
4. optional query filters such as `q`, `category`, `assertion`, and `limit`
5. linked job and summary pointers when present

This must remain read-only.

### Streaming Chat Endpoint

Add a read-only assistant query endpoint that streams partial events over a dedicated text transport.

Preferred wire strategy:

1. keep the streaming event envelope stable regardless of whether the transport is SSE or chunked NDJSON
2. prefer SSE if the deployed Azure Functions setup supports it cleanly
3. use chunked NDJSON if SSE support is awkward in the current Python Functions hosting path
4. do not reuse the Voice Live websocket as the chat streaming channel

Required behavior:

1. assistant turn starts immediately
2. partial response deltas stream incrementally
3. tool trace and reasoning summary stream as separate event types
4. turn completion, failure, and cancellation are explicit
5. the initial version is retrieval-only over clinical and mocked operational context

## Execution Phases

### Phase 0: Contract Review And Baseline Capture

Before implementation begins:

1. capture the current backend routes, React providers, assistant store shape, and transport boundaries
2. define target schemas for encounter context, turn streaming, tool events, and action preview
3. review where version conflicts, audit metadata, and request ids already exist and where they do not

### Phase 1: Stabilize Existing Seams

1. keep `function_app.py` authoritative but introduce typed helpers and mapper seams around encounter and job persistence
2. document the current assistant frontend seams and extract orchestration logic out of `AssistantShell`
3. avoid endpoint churn in this phase

### Phase 2: Shared Encounter Context Model

1. add the backend encounter context projection and endpoint
2. add a frontend shared encounter-context store fed from the new endpoint and existing encounter APIs
3. keep `CurrentViewProvider` route facts supplemental

### Phase 3: Operational Context Contracts

1. add TypeScript and backend contracts for operational context snapshots
2. implement mock providers only
3. surface freshness, provenance, and availability state explicitly

### Phase 4: Turn And Thread Runtime

1. add typed turn and thread state in the SPA
2. define `AgentDefinition` and `AgentRuntime` contracts
3. keep voice and chat attached to the same encounter-context substrate

### Phase 5: Surface Composition

1. introduce registry-driven surface composition
2. migrate `AssistantShell` to consume runtime controllers rather than own orchestration directly
3. preserve docked, expanded, and ambient surface modes during migration

### Phase 6: Streamed Chat

1. add the backend read-only streaming assistant endpoint
2. add frontend streaming transport and turn reducers
3. render deltas, tool events, reasoning summaries, citations, completion, and failure explicitly
4. support cancellation and stable request ids

### Phase 7: Action Preview Layer

1. add action preview contracts and auditable preview UI
2. keep execution behind explicit approval boundaries
3. do not auto-execute from chat responses

### Phase 8: Production Hardening

1. authentication and authorization
2. audit trails for retrieval, previews, approvals, and execution
3. idempotency keys and replay protection for actions
4. PHI-safe telemetry and logging
5. operational policy enforcement and failure handling
6. explicit timeout and retry rules per external provider

### Phase 9: Patient-Level Aggregation

Only begin this phase when a durable patient or subject identifier exists across encounters.

## Verification Requirements

1. define and review JSON schemas for encounter context, streaming events, tools, and action previews before implementation of each slice
2. confirm voice and chat share one encounter-context substrate and one turn model without remount loss
3. prove streamed responses update incrementally in React without blocking the existing ambient voice workflow
4. validate encounter-specific search over normalized clinical facts from backend context, not from DOM scraping
5. validate mock operational flows for eligibility, scheme qualification, treatment lookup, and communications via provider contracts
6. validate action previews are explicit, auditable, idempotency-aware, and not auto-executed
7. run a build or validation loop after each meaningful slice rather than waiting for the end
8. review security, approval, and audit constraints before enabling any live external action

## Recommended Streaming Choice

Use a dedicated assistant text stream over SSE or chunked NDJSON from Azure Functions.

Reason:

1. preserves ordered deltas and explicit completion markers
2. supports tool and reasoning event envelopes without overloading the Voice Live websocket path
3. allows the frontend to evolve a proper turn reducer independently of the ambient voice transport

## Relevant Files

Primary backend:

1. `/home/ayoola/streaming_agents/transcription-services-demo/function_app.py`

Primary frontend:

1. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/App.tsx`
2. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/app/router/index.tsx`
3. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/app/providers/RuntimeConfigProvider.tsx`
4. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/app/providers/PlatformShellProvider.tsx`
5. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/app/providers/AssistantWorkspaceProvider.tsx`
6. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/state/AssistantSessionStore.ts`
7. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/state/assistantTypes.ts`
8. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/transport/AssistantTransport.ts`
9. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/transport/voiceLiveSession.ts`
10. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/tools/CurrentViewProvider.tsx`
11. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/tools/GlobalKnowledgeProvider.tsx`
12. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/assistant/shell/AssistantShell.tsx`
13. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/upload/UploadPage.tsx`
14. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/encounters/EncounterReviewPage.tsx`
15. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/features/results/ResultsPage.tsx`
16. `/home/ayoola/streaming_agents/transcription-services-demo/frontend-react/src/shared/types/api.ts`

## Final Guidance

Build this as a platform, not as a one-off chat pane.

The production path for this repo is:

1. one shared encounter-context substrate now, with patient-context deferred
2. one typed turn and thread model for streamed assistant behavior
3. one registry of agent definitions
4. one runtime/controller layer shared by voice and chat
5. multiple surfaces rendered through composition
6. one explicit action layer with audit, approval, and idempotency controls

That path is realistic for this codebase and is the right foundation for a production-grade assistant platform.