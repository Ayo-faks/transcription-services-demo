# React Platform Migration Plan

## Objective

Refactor HealthTranscribe by rebuilding the frontend as a React + TypeScript platform shell while preserving the current Azure Functions backend as the system of record. The target product is one cohesive platform with shared assistant state across docked chat, expanded chat, and ambient voice capture, plus a clean path to local screen-aware search and future global retrieval.

The backend in `function_app.py` remains authoritative for:

- upload and batch transcription workflows
- encounter lifecycle and draft persistence
- entity extraction and relation extraction
- AI summary generation
- FHIR bundle generation
- Cosmos and Blob persistence

The frontend is what gets rebuilt.

## Architectural Direction

### Core Decision

Rebuild the shell, not the whole product.

Keep the current Azure Functions backend and current workflow semantics. Replace the static HTML + imperative JavaScript frontend with a React platform shell that owns layout, navigation, assistant state, and feature composition.

### Product Model

The target app should be one shell with multiple assistant surfaces:

1. Docked sidebar assistant
2. Expanded chatbot workspace
3. Ambient voice assistant

These must all share the same assistant session model so the user can switch modes without losing context.

### Search Model

Treat search as two separate capabilities:

1. Local view retrieval
Answers questions about the current screen, current transcript, selected entity, active filters, current encounter, visible results, or other route-local state.

2. Global retrieval
Answers questions across knowledge bases, documents, policies, indexed records, and future cross-app content.

Do not force local view questions through global RAG.

## Current State Summary

The current frontend is a single static-page app with most behavior centralized in `frontend/app.js`, markup in `frontend/index.html`, and styling in `frontend/styles.css`.

It currently owns three major workflows:

1. Upload intake and processing
2. Results rendering across multiple tabs
3. Ambient assistant drawer with capture, draft review, and explicit clinical processing handoff

The frontend is currently DOM-driven and stateful through mutable globals. There is no real component boundary, router, or state partitioning by domain.

## Key Refactor Goals

1. Introduce a real component model and route structure.
2. Separate platform shell state from feature state.
3. Separate assistant state from page rendering state.
4. Preserve the current backend contracts during the first migration slice.
5. Preserve the current ambient workflow semantics: draft first, explicit approval before clinical processing.
6. Create a future-ready assistant architecture for local view reasoning, global search, and voice interaction.

## Target Frontend Architecture

### 1. Platform Shell Layer

The shell owns:

- app layout
- navigation
- page framing
- theme
- runtime config bootstrap
- notifications
- assistant host and mode switching

The shell must not directly own business workflow logic.

### 2. Feature Layer

Feature modules should be isolated by domain, not by old file boundaries.

Recommended feature areas:

- upload
- processing
- results
- summary
- encounter review
- assistant

### 3. Assistant Platform Layer

Define explicit assistant contracts instead of embedding assistant logic into screens.

Recommended abstractions:

- `AssistantShell`
- `AssistantSessionStore`
- `AssistantTransport`
- `CurrentViewProvider`
- `GlobalKnowledgeProvider`
- `ToolRuntime`

### 4. Shared UI Layer

Create reusable primitives for:

- cards
- tabs
- drawers
- transcript blocks
- status pills
- side panels
- action bars
- result sections
- assistant controls

### 5. API Layer

Introduce a typed API client layer around the current backend:

- `jobsApi`
- `encountersApi`
- `summaryApi`
- `assistantApi` later

## Recommended Folder Structure

Create a new parallel frontend rather than rewriting the current static frontend in place immediately.

Suggested structure:

```text
transcription-services-demo/
  frontend/
    ... existing static frontend retained during migration
  frontend-react/
    index.html
    package.json
    tsconfig.json
    vite.config.ts
    src/
      app/
        App.tsx
        providers/
          PlatformShellProvider.tsx
          ThemeProvider.tsx
          RuntimeConfigProvider.tsx
          AssistantWorkspaceProvider.tsx
        router/
          index.tsx
      shell/
        layout/
          AppShell.tsx
          Header.tsx
          Sidebar.tsx
          AssistantRail.tsx
        navigation/
        notifications/
      features/
        upload/
          components/
          hooks/
          api/
          index.ts
        processing/
        results/
          transcription/
          entities/
          relations/
          fhir/
        summary/
        encounters/
        assistant/
          docked/
          expanded/
          ambient/
          review/
      assistant/
        shell/
          AssistantShell.tsx
          AssistantModeSwitcher.tsx
        state/
          AssistantSessionStore.ts
          assistantTypes.ts
        transport/
          AssistantTransport.ts
          voiceSessionController.ts
        tools/
          CurrentViewProvider.ts
          GlobalKnowledgeProvider.ts
          toolContracts.ts
      shared/
        ui/
        hooks/
        lib/
        styles/
        types/
      api/
        client.ts
        jobsApi.ts
        encountersApi.ts
        summaryApi.ts
```

## Route Model

Recommended initial route shape:

1. `/`
Primary landing route. Hosts upload and recent/current workflow entry.

2. `/jobs/:jobId`
Canonical results route for processed jobs.

3. Assistant remains shell-owned
Use shell state or query state for opening the assistant instead of making it a standalone app route in the first phase.

Possible future route if needed:

4. `/encounters/:encounterId/review`
Only if encounter review becomes sufficiently deep to justify its own dedicated route.

## Assistant Architecture

### AssistantShell

Presentation-only container that renders assistant surfaces in different modes:

- docked
- expanded
- fullscreen if needed later
- ambient voice

It should not own transport or workflow logic directly.

### AssistantSessionStore

Shared state for:

- messages
- transcript items
- tool invocation events
- grounding items
- encounter draft state
- current mode
- current session phase
- errors
- loading states

Recommended implementation: a lightweight store such as Zustand.

### AssistantTransport

A normalized message/event contract between frontend and backend or realtime gateway.

Suggested event types:

- session_started
- session_stopped
- transcript_delta
- transcript_final
- assistant_message
- tool_call_started
- tool_call_executing
- tool_call_completed
- tool_call_failed
- audio_playback_started
- audio_playback_stopped
- error

### CurrentViewProvider

Each route should expose structured `viewContext` so the assistant can reason over the current screen.

Suggested context fields:

- route id
- page title
- active tab
- selected entities
- visible summary cards
- loaded record ids
- current encounter/job id
- active filters
- available user actions

This is the preferred mechanism for screen-aware assistant behavior.

### GlobalKnowledgeProvider

Separate abstraction for future backend-powered search and retrieval over global documents and indexed data.

This is where Azure AI Search or other retrieval backends can plug in later.

## What To Reuse

### Reuse From Current HealthTranscribe

- current workflow semantics
- upload and results backend contracts
- encounter review and approval model
- ambient draft-before-processing behavior
- visual language and UX cues

### Reuse From Voice Live Samples

From the universal assistant sample, reuse the architectural patterns for:

- audio capture isolation
- playback isolation
- session lifecycle separation
- transcript presentation
- hook-based session state

From the VoiceRAG sample, reuse the architectural patterns for:

- retrieval as a backend tool concern
- tool lifecycle events
- tool registry pattern
- assistant bridge between UI and retrieval pipeline

## What Not To Reuse Blindly

1. Do not keep scaling the monolithic `frontend/app.js` model.
2. Do not copy the sample apps as complete product structures.
3. Do not copy sample prompts, demo business logic, or domain-specific assistant behaviors.
4. Do not couple current-screen questions to global RAG.
5. Do not make ambient voice a separate product/app surface.

## Migration Strategy

### Step 1: Create `frontend-react`

Build a new React + Vite + TypeScript frontend in parallel.

### Step 2: Establish shell and design primitives

Before porting workflows, implement:

- platform shell
- theme and tokens
- assistant host container
- base layouts
- UI primitives

### Step 3: Port upload workflow first

Use the current backend endpoints unchanged:

- `POST /api/upload`
- `POST /api/process/{jobId}`
- `GET /api/status/{jobId}`
- `GET /api/results/{jobId}`

This proves React parity with the least architectural risk.

### Step 4: Port results workspace

Move results rendering into React route-level components.

Suggested module split:

- transcription view
- entities view
- relations view
- FHIR view
- AI summary view

### Step 5: Port ambient assistant workflow

Rebuild the current drawer behavior in React, but put transport, audio, transcript, and draft logic behind proper abstractions.

### Step 6: Add view context contracts

Each route registers structured context for assistant use.

### Step 7: Introduce search providers

Start with `CurrentViewProvider` first.
Add `GlobalKnowledgeProvider` after shell and assistant parity are stable.

### Step 8: Consider CopilotKit later

Only after the core shell, assistant contracts, and route context model are stable.

### Step 9: Cut over using strangler pattern

Keep the static frontend operational until React reaches parity.
Then switch the entry point and retire the legacy frontend.

## Suggested Execution Order

1. Create React app scaffold
2. Add runtime config compatibility
3. Add shell layout and theme
4. Build shared UI primitives
5. Implement typed API clients
6. Port upload flow
7. Port processing state flow
8. Port results tabs
9. Port summary flow
10. Port assistant shell
11. Port ambient capture and review flow
12. Add view context provider model
13. Add local screen-aware assistant behavior
14. Add global retrieval later

## Risks To Manage

1. Monolithic frontend state must be decomposed carefully.
2. Assistant draft autosave and unload semantics are easy to regress.
3. Audio and websocket lifecycles must not be tied loosely to component re-renders.
4. Current absolute asset/runtime config assumptions must be redesigned for the new shell.
5. Results parity must be verified before the old frontend is retired.

## Recommended State Boundaries

### Job State

- selected file
- active job id
- processing status
- polling lifecycle

### Result State

- loaded result payload
- active tab
- derived summaries

### Summary State

- summary content
- loading and error state
- regeneration cooldown state
- export/download state

### Assistant State

- encounter id
- session phase
- transcript items
- draft text and version
- tool events
- message history
- UI mode

### Media State

- mic permission
- audio engine readiness
- websocket connection status
- mute state
- elapsed timer

## Verification Criteria

1. React shell reproduces current upload flow against the current backend.
2. React results workspace reproduces transcription, entities, relations, FHIR, and AI summary views.
3. Docked, expanded, and ambient assistant modes share the same assistant session state.
4. Current-screen questions are answered from route context.
5. Global retrieval can be added later without changing the local view contract.
6. Encounter review, finalize, and clinical processing preserve current semantics.
7. Telemetry remains compatible with Azure Application Insights for baseline app monitoring.

## Final Recommendation

The best way to achieve the platform you want is:

- keep the current backend
- rebuild the frontend shell in React + TypeScript
- create a shared assistant platform layer
- separate local screen-aware context from global retrieval
- migrate incrementally with a parallel React app

This gives you a real platform architecture instead of a larger static app with more embedded complexity.