import type { AssistantMode } from '../state/assistantTypes'

export interface AgentSurfaceConfig {
  surfaceId: string
  kind: 'chat-panel' | 'voice-panel' | 'context-inspector' | 'action-composer'
  placement: 'sidebar' | 'overlay' | 'panel'
  enabled: boolean
  priority: number
  featureFlags: string[]
  renderConditions: string[]
}

export interface AgentDefinition {
  id: 'chat-agent' | 'voice-agent'
  title: string
  description: string
  defaultMode: AssistantMode
  capabilities: string[]
  enabledTools: string[]
  requiredContexts: string[]
  defaultSurfaces: AgentSurfaceConfig[]
  streaming: boolean
  actionPolicy: 'preview-first'
  visibilityRules: string[]
}

export const agentRegistry: AgentDefinition[] = [
  {
    id: 'chat-agent',
    title: 'Visit Helper',
    description: 'On-demand helper for the current visit, final review, and preview-only follow-up actions.',
    defaultMode: 'docked',
    capabilities: ['chat', 'encounter-context', 'operational-context', 'action-preview'],
    enabledTools: ['patient_follow_up_email', 'treatment_request', 'prior_auth_packet'],
    requiredContexts: ['encounter-context', 'operational-context'],
    defaultSurfaces: [
      {
        surfaceId: 'chat-panel',
        kind: 'chat-panel',
        placement: 'sidebar',
        enabled: true,
        priority: 1,
        featureFlags: ['shared-session'],
        renderConditions: ['mode!=ambient'],
      },
      {
        surfaceId: 'context-inspector',
        kind: 'context-inspector',
        placement: 'panel',
        enabled: true,
        priority: 2,
        featureFlags: ['encounter-context', 'operational-context'],
        renderConditions: ['always'],
      },
      {
        surfaceId: 'action-composer',
        kind: 'action-composer',
        placement: 'panel',
        enabled: true,
        priority: 3,
        featureFlags: ['preview-first'],
        renderConditions: ['always'],
      },
    ],
    streaming: true,
    actionPolicy: 'preview-first',
    visibilityRules: ['available-when-assistant-open'],
  },
  {
    id: 'voice-agent',
    title: 'Ambient Helper',
    description: 'Live capture helper sharing the same visit context while keeping the recording surface calm.',
    defaultMode: 'ambient',
    capabilities: ['voice', 'encounter-context', 'operational-context', 'action-preview'],
    enabledTools: ['patient_follow_up_email', 'treatment_request', 'prior_auth_packet'],
    requiredContexts: ['encounter-context', 'operational-context'],
    defaultSurfaces: [
      {
        surfaceId: 'voice-panel',
        kind: 'voice-panel',
        placement: 'overlay',
        enabled: true,
        priority: 1,
        featureFlags: ['ambient-voice'],
        renderConditions: ['mode==ambient'],
      },
      {
        surfaceId: 'context-inspector',
        kind: 'context-inspector',
        placement: 'panel',
        enabled: true,
        priority: 2,
        featureFlags: ['encounter-context', 'operational-context'],
        renderConditions: ['always'],
      },
    ],
    streaming: true,
    actionPolicy: 'preview-first',
    visibilityRules: ['available-when-assistant-open'],
  },
]

export function getPreferredAgentIdForMode(mode: AssistantMode): AgentDefinition['id'] {
  return mode === 'ambient' ? 'voice-agent' : 'chat-agent'
}