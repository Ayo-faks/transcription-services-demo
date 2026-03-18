import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { AssistantTransport } from '../../assistant/transport/AssistantTransport'
import { useRuntimeConfig } from './RuntimeConfigProvider'

const AssistantWorkspaceContext = createContext<AssistantTransport | null>(null)

export function AssistantWorkspaceProvider({ children }: { children: ReactNode }) {
  const { apiBaseUrl, voiceLive } = useRuntimeConfig()
  const transport = useMemo(() => new AssistantTransport(apiBaseUrl, voiceLive), [apiBaseUrl, voiceLive])

  return (
    <AssistantWorkspaceContext.Provider value={transport}>{children}</AssistantWorkspaceContext.Provider>
  )
}

export function useAssistantTransport() {
  const context = useContext(AssistantWorkspaceContext)
  if (!context) {
    throw new Error('useAssistantTransport must be used inside AssistantWorkspaceProvider')
  }

  return context
}