# Agentic Platform Contracts

## Purpose

This document defines the exact target contracts for the post-MVP architecture evolution of HealthTranscribe.

It is intentionally future-facing.

The current production MVP should focus on hardening the working audio-to-results product first.

After MVP hardening, these contracts define the target shape for:

1. client agent and remote agents
2. agent cards
3. assistant gateway
4. A2A delegation
5. MCP tool registry
6. Foundry-hosted orchestrator and task agents

## Architectural Roles

### Client Agent

The client agent lives in the React SPA and is responsible for:

1. streaming turn rendering
2. UI state and thread state
3. approval interactions
4. local route and encounter context injection
5. interruption and cancellation UX

The client agent is not the main reasoning engine.

### Remote Orchestrator Agent

The remote orchestrator agent is the primary backend agent entrypoint.

Its responsibilities are:

1. intent classification
2. thread continuity
3. tool selection
4. delegation to task agents
5. result synthesis

This is the natural place for a Foundry-hosted orchestrator.

### Remote Task Agents

Task agents are specialist agents with bounded responsibilities, for example:

1. clinical-scribe-agent
2. clinical-summary-agent
3. scheduling-agent
4. email-agent
5. eligibility-agent
6. prior-auth-agent
7. treatment-request-agent

### MCP Capability Layer

MCP servers expose governed tools and capability surfaces to the agent system.

### A2A Layer

The A2A layer governs remote agent discovery, invocation, delegation, and response contracts between orchestrator and task agents.

## Agent Card Contract

Each remote agent should expose a machine-readable agent card.

### TypeScript contract

```ts
export interface AgentCard {
  id: string
  name: string
  description: string
  version: string
  kind: 'client' | 'remote'
  role: 'orchestrator' | 'task' | 'tool-proxy'
  endpoint: string
  protocol: 'a2a'
  auth: AgentCardAuth
  skills: AgentSkillDescriptor[]
  inputModes: Array<'text' | 'audio' | 'json' | 'event-stream'>
  outputModes: Array<'text' | 'audio' | 'json' | 'event-stream'>
  supportedTools: string[]
  requiredContexts: string[]
  approvalSensitivity: 'none' | 'low' | 'high'
  observability: AgentObservability
}

export interface AgentCardAuth {
  scheme: 'entra-id' | 'managed-identity' | 'api-key'
  audience?: string
  scopes?: string[]
}

export interface AgentSkillDescriptor {
  id: string
  title: string
  description: string
  intents: string[]
}

export interface AgentObservability {
  traceNamespace: string
  metricsNamespace: string
}
```

### JSON example

```json
{
  "id": "platform-orchestrator",
  "name": "Platform Orchestrator",
  "description": "Primary remote agent for clinical and operational task routing.",
  "version": "1.0.0",
  "kind": "remote",
  "role": "orchestrator",
  "endpoint": "https://api.example.com/agents/platform-orchestrator",
  "protocol": "a2a",
  "auth": {
    "scheme": "entra-id",
    "audience": "api://healthtranscribe-agent-gateway"
  },
  "skills": [
    {
      "id": "clinical-routing",
      "title": "Clinical Routing",
      "description": "Routes summarization, Q&A, and action workflows.",
      "intents": ["summarize", "answer_question", "schedule", "draft_email"]
    }
  ],
  "inputModes": ["text", "json", "event-stream"],
  "outputModes": ["text", "json", "event-stream"],
  "supportedTools": ["encounter-context.get", "email.preview", "schedule.preview"],
  "requiredContexts": ["encounter-context"],
  "approvalSensitivity": "high",
  "observability": {
    "traceNamespace": "healthtranscribe.orchestrator",
    "metricsNamespace": "healthtranscribe.agents"
  }
}
```

## Assistant Gateway Contract

The assistant gateway is the single backend contract the React app should use for assistant turns.

### Responsibilities

1. authenticate the caller
2. resolve encounter and thread context
3. load the current context snapshot
4. forward the request to the orchestrator agent
5. stream normalized events back to the client
6. enforce approval and policy controls for actions

### Request contract

```ts
export interface AssistantGatewayRequest {
  threadId?: string
  encounterId: string
  userMessage: string
  mode: 'chat' | 'voice-followup'
  clientContext: ClientContextEnvelope
  requestedAgentId?: string
}

export interface ClientContextEnvelope {
  route: string
  surface: 'docked' | 'expanded' | 'ambient'
  selectedFacts?: string[]
  selectedEntityIds?: string[]
  uiLanguage?: string
}
```

### Streaming response contract

```ts
export interface AssistantGatewayEvent {
  type:
    | 'turn.started'
    | 'turn.delta'
    | 'turn.reasoning_summary'
    | 'turn.tool_started'
    | 'turn.tool_completed'
    | 'turn.action_preview'
    | 'turn.citation'
    | 'turn.completed'
    | 'turn.failed'
    | 'turn.cancelled'
  turnId: string
  threadId: string
  timestamp: string
  payload: Record<string, unknown>
}
```

### Example endpoint

```text
POST /api/assistant/stream
Accept: text/event-stream
Content-Type: application/json
```

## A2A Delegation Contract

This contract represents orchestrator-to-task-agent delegation.

### Request contract

```ts
export interface A2ADelegationRequest {
  delegationId: string
  parentTurnId: string
  sourceAgentId: string
  targetAgentId: string
  skillId: string
  authContext: DelegationAuthContext
  contextSnapshot: DelegationContextSnapshot
  task: DelegationTask
}

export interface DelegationAuthContext {
  tenantId?: string
  userId: string
  scopes: string[]
}

export interface DelegationContextSnapshot {
  encounterId?: string
  threadId: string
  contextVersion: string
  summary: string
  structuredContext: Record<string, unknown>
}

export interface DelegationTask {
  intent: string
  instructions: string
  inputs: Record<string, unknown>
  toolAllowList: string[]
}
```

### Response contract

```ts
export interface A2ADelegationResponse {
  delegationId: string
  targetAgentId: string
  status: 'completed' | 'failed' | 'needs-approval'
  result?: Record<string, unknown>
  actionPreview?: ActionPreview
  error?: {
    code: string
    message: string
  }
}
```

## MCP Tool Registry Contract

The MCP registry is the formal set of tools exposed to the orchestrator and task agents.

### TypeScript contract

```ts
export interface ToolRegistryEntry {
  id: string
  title: string
  description: string
  kind: 'lookup' | 'command'
  mcpServer: string
  mcpTool: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  approvalRequired: boolean
  auditLevel: 'standard' | 'sensitive' | 'critical'
  allowedAgents: string[]
}
```

### Recommended initial registry

```ts
export const toolRegistry: ToolRegistryEntry[] = [
  {
    id: 'encounter-context.get',
    title: 'Get Encounter Context',
    description: 'Returns normalized encounter-scoped clinical context.',
    kind: 'lookup',
    mcpServer: 'healthtranscribe-core',
    mcpTool: 'getEncounterContext',
    inputSchema: { encounterId: 'string' },
    outputSchema: { context: 'EncounterContextState' },
    approvalRequired: false,
    auditLevel: 'standard',
    allowedAgents: ['platform-orchestrator', 'clinical-summary-agent', 'clinical-scribe-agent']
  },
  {
    id: 'schedule.preview',
    title: 'Preview Follow-up Scheduling',
    description: 'Returns candidate slots and scheduling constraints.',
    kind: 'lookup',
    mcpServer: 'healthtranscribe-ops',
    mcpTool: 'previewSchedule',
    inputSchema: { encounterId: 'string', followUpWindow: 'string' },
    outputSchema: { slots: 'array' },
    approvalRequired: false,
    auditLevel: 'standard',
    allowedAgents: ['platform-orchestrator', 'scheduling-agent']
  },
  {
    id: 'email.preview',
    title: 'Preview Email Draft',
    description: 'Builds a clinician- or patient-facing email draft for approval.',
    kind: 'command',
    mcpServer: 'healthtranscribe-communications',
    mcpTool: 'previewEmail',
    inputSchema: { encounterId: 'string', audience: 'string', purpose: 'string' },
    outputSchema: { preview: 'ActionPreview' },
    approvalRequired: true,
    auditLevel: 'sensitive',
    allowedAgents: ['platform-orchestrator', 'email-agent']
  }
]
```

## Action Preview Contract

```ts
export interface ActionPreview {
  actionId: string
  toolId: string
  title: string
  target: string
  summary: string
  payloadPreview: Record<string, unknown>
  approvalRequirements: {
    required: boolean
    approverRole?: string
  }
  idempotencyKey: string
  riskFlags: string[]
  auditMetadata: {
    initiatedBy: string
    encounterId?: string
    createdAt: string
  }
}
```

## Recommended Evolution Sequence

These contracts should be introduced only after the production MVP is stable.

### Step 1

Ship the current working app to production with:

1. auth
2. validation
3. audit
4. observability
5. encounter context endpoint

### Step 2

Add the assistant gateway contract.

### Step 3

Add agent cards and the orchestrator agent.

### Step 4

Add task-agent delegation over A2A contracts.

### Step 5

Move capability access behind MCP tool registry entries.

### Step 6

Expand remote agent composition and approval-governed actions.