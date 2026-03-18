import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { AssistantMode } from '../state/assistantTypes'
import { agentRegistry, getPreferredAgentIdForMode, type AgentDefinition } from './agentRuntimeTypes'

interface AgentRuntimeValue {
  agents: AgentDefinition[]
  activeAgentId: AgentDefinition['id']
  activeAgent: AgentDefinition
  setActiveAgentId: (agentId: AgentDefinition['id']) => void
  syncAgentToMode: (mode: AssistantMode) => void
}

const AgentRuntimeContext = createContext<AgentRuntimeValue | null>(null)

export function AgentRuntimeProvider({ children }: { children: ReactNode }) {
  const [activeAgentId, setActiveAgentId] = useState<AgentDefinition['id']>('chat-agent')

  const value = useMemo<AgentRuntimeValue>(() => {
    const activeAgent = agentRegistry.find((agent) => agent.id === activeAgentId) || agentRegistry[0]

    return {
      agents: agentRegistry,
      activeAgentId,
      activeAgent,
      setActiveAgentId,
      syncAgentToMode: (mode) => {
        setActiveAgentId(getPreferredAgentIdForMode(mode))
      },
    }
  }, [activeAgentId])

  return <AgentRuntimeContext.Provider value={value}>{children}</AgentRuntimeContext.Provider>
}

export function useAgentRuntime() {
  const context = useContext(AgentRuntimeContext)
  if (!context) {
    throw new Error('useAgentRuntime must be used inside AgentRuntimeProvider')
  }

  return context
}