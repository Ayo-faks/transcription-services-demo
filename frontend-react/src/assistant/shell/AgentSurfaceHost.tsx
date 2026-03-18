import { AssistantShell } from './AssistantShell'
import { useAgentRuntime } from '../runtime/AgentRuntimeProvider'
import type { AssistantMode } from '../state/assistantTypes'

interface AgentSurfaceHostProps {
  isOpen: boolean
  mode: AssistantMode
  onClose?: () => void
}

export function AgentSurfaceHost({ isOpen, mode, onClose }: AgentSurfaceHostProps) {
  const { activeAgent } = useAgentRuntime()

  if (!isOpen) {
    return null
  }

  if (mode === 'docked') {
    return <AssistantShell variant="docked" onClose={onClose} agentTitle={activeAgent.title} agentId={activeAgent.id} />
  }

  return (
    <div className="assistant-overlay">
      <button type="button" className="assistant-overlay-backdrop" onClick={onClose} aria-label="Close assistant overlay" />
      <AssistantShell variant={mode} onClose={onClose} agentTitle={activeAgent.title} agentId={activeAgent.id} />
    </div>
  )
}