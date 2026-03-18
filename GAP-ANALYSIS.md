# HealthTranscribe Gap Analysis

## Objective

This document captures the current gap between the implemented React + Azure Functions assistant workspace and the intended clinician-grade product.

## Summary

The platform is materially ahead on encounter-local retrieval and evidence-grounded review, but still behind on clinician workflow simplification, live operational context, and action execution.

The current implementation is strongest as:

1. an encounter-local review assistant
2. an ambient capture foundation
3. a platform scaffold for future clinical operations

It is not yet complete as:

1. a polished doctor-first ambient workflow
2. a patient-longitudinal clinical copilot
3. a production-ready operational agent with execution rails

## Gap Matrix

| Area | Current State | Target State | Main Gap | Next Slice |
|---|---|---|---|---|
| Doctor workflow | The shell exposes explicit Docked, Expanded, and Ambient assistant choices. | One assistant adapts to consult, review, and deep-work context automatically. | The UI exposes architecture instead of clinician workflow. | Replace surface selection with workflow-driven entry points such as Start Visit, Review Draft, and Ask About Results. |
| Ambient scribe | Ambient capture and review are present. | Ambient becomes the default in-room experience with minimal chrome. | The ambient experience still feels like an assistant panel rather than the primary consult mode. | Tighten the ambient surface into a consultation-first layout with simpler controls and clearer status transitions. |
| Review assistant | Docked review can query encounter context and render citations. | Clinician reviews draft and results with grounded assistance in-place. | Too many concerns are shown at once: chat, context, operations, actions, and transcript controls. | Split the review experience into clearer sections such as Ask, Evidence, and Actions. |
| Expanded workspace | Expanded mode exists as a technical overlay. | Expanded mode supports deep review for complex cases only. | Its role is not clearly differentiated from the primary review flow. | Reposition it as an advanced workspace launched from review, not a default mode choice. |
| Encounter-local retrieval | Strong. Encounter-local retrieval, citations, and regression coverage are in place. | Reliable grounded QA over transcript, entities, relations, and summaries. | Mostly solved for encounter scope. | Continue ranking, citation, and long-encounter quality hardening. |
| Clinical context layer | Encounter-scoped normalized context is partially real. | Full encounter read model with provenance and freshness. | Good encounter foundation, but no longitudinal model. | Improve normalization and provenance presentation before adding broader scope. |
| Patient longitudinal context | Not implemented. The system is still encounter-scoped only. | Cross-encounter history and continuity for clinician questions. | No durable patient key and no aggregated retrieval substrate. | Define subject identity first, then design patient-level context separately. |
| Operational context | Present in UI, but mostly mocked. | Real payer, scheme, treatment, and communications context. | The shape exists, but the data is not yet live or trusted. | Deliver one real operational integration path end to end. |
| Action layer | Action preview concepts exist. | Preview-first, approval-gated, auditable execution workflows. | Missing execution rails, audit, idempotency, and policy enforcement. | Implement one narrow action fully with preview, approval, audit log, and execution. |
| Agent platform model | Registry/runtime direction exists, but still sits on top of one shared session and shell. | Mature shared runtime for voice, chat, and task agents. | Today it is more agent-shaped than production-grade multi-agent runtime. | Keep only voice and chat real for now; defer more agents until operations and actions are real. |
| Voice/chat convergence | Shared encounter substrate direction exists. | Seamless handoff from consultation capture to review QA. | Architecture supports it better than the UX communicates it. | Make the handoff explicit and automatic after recording stops. |
| Results workspace | Results route and assistant coexist. | Results become the core review workspace. | The assistant still feels partially bolted on. | Bind assistant prompts and evidence directly to visible results sections. |
| Trust and evidence | Structured citations are present. | Clinician can quickly validate why an answer was given. | Evidence is still presented more like developer-facing citation blocks. | Upgrade citations into clinician-readable evidence cards with transcript anchors. |
| Compliance controls | Planned, not complete. | Approval, audit, and policy enforcement on retrieval and actions. | Still a platform gap. | Add audit records and approval state before enabling outbound actions. |
| Product simplicity | The architecture is getting stronger. | One smart clinical workspace. | Too much internal architecture is visible in the UI. | Collapse visible choices and let workflow state drive presentation. |

## Interpretation

The product is currently strongest as an encounter-local assistant. The next large gap is not more surface area, but better orchestration and one real operational workflow.

## Recommended Priority Order

1. Make ambient the primary consult mode.
2. Make docked the default review mode.
3. Hide explicit surface switching from the main clinician flow.
4. Finish one real operational integration end to end.
5. Defer patient-longitudinal intelligence until identity and aggregation are real.