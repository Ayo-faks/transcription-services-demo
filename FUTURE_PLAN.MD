# Future Plan

The ideal app for this repo is not “a transcription demo with a chatbot added.” It is a clinical operations workspace with one shared assistant substrate.

The product should feel like one application with four tightly connected modes:

1. Ambient voice capture for live consultations.
2. Clinical workspace for transcript, review, summarization, coding, and structured facts.
3. Operational workspace for scheduling, eligibility, prior auth, treatment requests, and communications.
4. Agent workspace for chat, orchestration, approvals, threads, and guided actions.

That direction fits the code you already have. The backend in `function_app.py` already supports the two most important foundations: encounter-centered draft workflow and job-centered analysis/results. The React shell in `frontend-react` already gives you the right direction for a shared assistant host. The missing piece is to stop thinking in terms of separate features and instead design one shared context and orchestration model.

## Ideal Product

The perfect design is a clinician-facing operating system around an encounter.

At the center is an encounter context object, not a page and not a chat thread. Every surface reads and writes around that same encounter context. The major user-visible capabilities should be:

1. Live scribing.
   The clinician can start voice capture, see provisional transcript, stop, review, edit, and approve.

2. Clinical understanding.
   The app should derive structured findings, medications, symptoms, vitals, plans, risks, follow-up tasks, and FHIR-aligned outputs from the encounter.

3. Operational follow-through.
   From the same encounter, the user should be able to ask:
   schedule follow-up, draft referral, check eligibility, draft prior auth packet, send summary email, create treatment request, and track status.

4. Agent-assisted decision support.
   The assistant should answer questions over the current encounter, explain what is missing, suggest next steps, and orchestrate the correct downstream tool or specialist agent.

5. Approval-first action execution.
   No clinically or operationally meaningful side effect should happen without explicit preview and approval.

That is the correct “perfect app” for this repo.

## Ideal Architecture

The ideal architecture is a 4-plane system.

1. React presentation plane.
   React owns routing, page composition, thread UI, transcript UI, charts, approvals, drawers, forms, and streaming rendering.

2. Shared context plane.
   A single encounter context store feeds every surface: voice, chat, review, results, scheduling, email, and action previews.

3. Foundry orchestration plane.
   Foundry is the backend agent brain. It receives the user turn, decides intent, selects tools or specialist agents, manages thread continuity, and synthesizes the response.

4. Functions capability plane.
   Azure Functions remain the governed capability layer. They expose encounter context, search, summarization, scheduling, email preview, eligibility lookup, prior auth preview, and execution endpoints under policy and audit control.

That means Foundry should not replace the React router, and it should not replace your backend domain logic. It should be the orchestrator between the UI and governed tools.

## How React Should Be Designed

The React app should be built around one shell and one shared context, with multiple surfaces.

The ideal shell has these areas:

1. Primary workspace.
   Main route area for encounter review, results, patient timeline, and operational panels.

2. Assistant rail.
   Always-available assistant entry with unread state, current thread state, and surface switcher.

3. Threads drawer.
   Persistent conversational history by encounter and task.

4. Context side panel.
   Structured facts, sources, tool activity, and current action previews.

5. Approval drawer.
   A dedicated place for sending mail, submitting requests, booking appointments, and confirming any external action.

The route model should stay React-owned. Suggested route areas:

1. Home/dashboard.
2. Encounter workspace.
3. Results workspace.
4. Operations workspace.
5. Assistant-focused full-screen workspace.
6. Admin/configuration workspace later.

All those routes should hydrate from the same shared encounter context model, not from isolated page fetches.

## What The Shared Context Should Be

The perfect design in this repo is encounter-first, with patient-ready extension later.

The core shared context should include:

1. Encounter identity and status.
2. Draft text and finalized text.
3. Transcript segments and diarization.
4. Normalized clinical facts.
5. Summary artifacts.
6. Related job metadata.
7. Operational snapshots such as scheduling options or eligibility results.
8. Available actions and action previews.
9. Provenance and freshness state.

Today, the codebase is encounter-centric, not patient-centric. So the ideal design now is an `EncounterContextStore`. Later, when a real patient key exists, that can sit inside a `PatientContextStore`.

## How Foundry Should Be Used

Foundry makes the most sense here as the orchestration control plane.

The best Foundry model is:

1. One entry orchestrator agent.
   This is the main assistant entrypoint for every user turn.

2. Several logical specialist agents.
   Clinical agent, voice or scribe agent, scheduling agent, email agent, eligibility agent, prior auth agent.

3. Backend tools exposed by your app.
   Foundry should not directly mutate your systems. It should call tools provided by your backend.

So a typical flow becomes:

1. User asks, “Schedule follow-up in two weeks and email the patient summary.”
2. React sends the turn to your backend assistant gateway.
3. Backend loads encounter context and permissions.
4. Foundry orchestrator decides this needs scheduling plus email.
5. Foundry calls scheduling preview tool and email preview tool.
6. Backend returns previews.
7. Foundry synthesizes a response with approval cards.
8. React renders the previews.
9. User approves.
10. Backend executes the actions and records audit events.

That is the correct use of Foundry in a React app.

## Best Agent Model

The perfect agent design is not one giant assistant. It is one orchestrator plus composable surfaces.

Suggested surfaces:

1. Chat agent surface.
   Full assistant conversation, threads, reasoning summary, tool trace, charts, code blocks, citations, action previews.

2. Voice agent surface.
   Live transcript, recording controls, draft review, handoff to chat, context-aware prompts.

3. Operations agent surface.
   Form-like guided execution for scheduling, treatment requests, eligibility, prior auth, and outbound communication.

4. Clinical review surface.
   Facts, summary, coding suggestions, note generation, evidence trace.

All of them should share:

1. context state
2. thread state
3. tool contracts
4. approval workflows

They should not each invent their own mini-state machine.

## Functionalities The Final App Should Have

The ideal final app should support these categories.

1. Encounter capture and review.
   Live voice, transcript review, edits, finalization, structured summary.

2. Clinical Q&A.
   Questions like “What are the active conditions?”, “What changed in medication?”, “What follow-up did the doctor request?”, “What red flags were discussed?”

3. Clinical drafting.
   Progress note, referral letter, discharge summary, patient instructions, coding support, treatment rationale drafts.

4. Operational workflows.
   Scheduling, eligibility checks, scheme qualification, prior auth prep, treatment request drafting, communication workflows.

5. Communication workflows.
   Draft patient summary email, provider handoff email, internal follow-up instructions, administrative messages.

6. Insight and analytics.
   Charts for vitals trend, action status, turnaround time, operational bottlenecks, unresolved tasks.

7. Approval and audit.
   Every side effect is previewed, approved, traceable, and reversible where possible.

## UI Pattern That Fits Best

The ideal React design is a workspace UI, not a single-chat UI.

Suggested layout patterns:

1. Main encounter canvas.
   Transcript, summary, facts, timeline, tasks.

2. Floating assistant or docked rail.
   Available everywhere.

3. Full assistant workspace.
   When the user needs deep conversation, thread browsing, charts, code blocks, and tool traces.

4. Side panels for facts and actions.
   Keep structured context visible while the assistant works.

5. Approval cards and task trays.
   Side effects are visible, explicit, and manageable.

That gives you the “Google or Anthropic quality” experience without turning everything into one chat scroll.

## What Should Stay In Functions

Functions should keep ownership of:

1. Encounter lifecycle.
2. Context assembly.
3. Structured fact projections.
4. Scheduling and email tools.
5. Action preview and execution.
6. Audit logging.
7. PHI-aware policy enforcement.

The right move is to extend the backend into a capability plane, not bypass it.

## What Should Be Added

The ideal missing pieces are:

1. Assistant gateway endpoint.
   One streaming endpoint from SPA to backend.

2. Encounter context endpoint.
   A normalized read model for assistant retrieval.

3. Tool registry.
   Backend-defined tools for Foundry to call.

4. Action preview contracts.
   For mail, scheduling, treatment requests, and future prior auth.

5. Thread registry.
   Mapping between app encounter/session and Foundry thread.

6. Shared encounter context store in React.
   So all routes and surfaces work from one substrate.

## The Perfect Design Summary

The perfect design for this repo is a React workspace application centered on shared encounter context, with Foundry acting as the orchestration brain behind a backend assistant gateway, and Azure Functions acting as the governed tool, policy, and action execution layer.

That is the strongest version of the idea.