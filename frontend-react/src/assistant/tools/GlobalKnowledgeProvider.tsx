import { createContext, useContext, useMemo, type ReactNode } from 'react'

interface GlobalKnowledgeProviderValue {
  isAvailable: boolean
  queryGlobalKnowledge: (question: string) => Promise<string>
}

const GlobalKnowledgeContext = createContext<GlobalKnowledgeProviderValue | null>(null)

export function GlobalKnowledgeProvider({ children }: { children: ReactNode }) {
  const value = useMemo<GlobalKnowledgeProviderValue>(
    () => ({
      isAvailable: false,
      queryGlobalKnowledge: async (question: string) => {
        return `Global retrieval is not configured in this migration slice. Your question was recorded as an extension point: ${question}`
      },
    }),
    [],
  )

  return <GlobalKnowledgeContext.Provider value={value}>{children}</GlobalKnowledgeContext.Provider>
}

export function useGlobalKnowledge() {
  const context = useContext(GlobalKnowledgeContext)
  if (!context) {
    throw new Error('useGlobalKnowledge must be used inside GlobalKnowledgeProvider')
  }

  return context
}