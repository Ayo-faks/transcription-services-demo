import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ApiError } from '../../api/client'
import { useAssistantTransport } from '../../app/providers/AssistantWorkspaceProvider'
import { useAssistantSessionStore } from '../state/AssistantSessionStore'
import type {
  EncounterContextQuery,
  EncounterContextResponse,
} from '../../shared/types/api'

interface EncounterContextState {
  data: EncounterContextResponse | null
  isLoading: boolean
  error: string | null
}

interface EncounterContextValue extends EncounterContextState {
  refreshEncounterContext: (
    encounterId?: string | null,
    query?: EncounterContextQuery,
  ) => Promise<EncounterContextResponse | null>
  searchEncounterContext: (question: string) => Promise<EncounterContextResponse | null>
  clearEncounterContext: () => void
}

const EncounterContext = createContext<EncounterContextValue | null>(null)

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message
  }

  return 'Encounter context could not be loaded.'
}

export function EncounterContextProvider({ children }: { children: ReactNode }) {
  const transport = useAssistantTransport()
  const encounterId = useAssistantSessionStore((state) => state.encounterId)
  const [state, setState] = useState<EncounterContextState>({
    data: null,
    isLoading: false,
    error: null,
  })

  const clearEncounterContext = useMemo(
    () => () => {
      setState({ data: null, isLoading: false, error: null })
    },
    [],
  )

  const refreshEncounterContext = useMemo(
    () =>
      async (targetEncounterId?: string | null, query?: EncounterContextQuery) => {
        if (!targetEncounterId) {
          clearEncounterContext()
          return null
        }

        const shouldStoreResult = !query?.q && !query?.category && !query?.assertion
        if (shouldStoreResult) {
          setState((currentState) => ({ ...currentState, isLoading: true, error: null }))
        }

        try {
          const response = await transport.getEncounterContext(targetEncounterId, query)

          if (shouldStoreResult) {
            setState({ data: response, isLoading: false, error: null })
          }

          return response
        } catch (error) {
          const message = getErrorMessage(error)
          if (shouldStoreResult) {
            setState((currentState) => ({
              data: currentState.data,
              isLoading: false,
              error: message,
            }))
          }
          return null
        }
      },
    [clearEncounterContext, transport],
  )

  const searchEncounterContext = useMemo(
    () => async (question: string) => {
      const normalizedQuestion = question.trim()
      if (!encounterId || !normalizedQuestion) {
        return null
      }

      return refreshEncounterContext(encounterId, {
        q: normalizedQuestion,
        limit: 6,
      })
    },
    [encounterId, refreshEncounterContext],
  )

  useEffect(() => {
    let cancelled = false

    async function loadEncounterContext() {
      if (!encounterId) {
        clearEncounterContext()
        return
      }

      const response = await refreshEncounterContext(encounterId, { limit: 80 })
      if (cancelled || !response) {
        return
      }
    }

    void loadEncounterContext()

    return () => {
      cancelled = true
    }
  }, [clearEncounterContext, encounterId, refreshEncounterContext])

  const value = useMemo<EncounterContextValue>(
    () => ({
      ...state,
      refreshEncounterContext,
      searchEncounterContext,
      clearEncounterContext,
    }),
    [clearEncounterContext, refreshEncounterContext, searchEncounterContext, state],
  )

  return <EncounterContext.Provider value={value}>{children}</EncounterContext.Provider>
}

export function useEncounterContext() {
  const context = useContext(EncounterContext)
  if (!context) {
    throw new Error('useEncounterContext must be used inside EncounterContextProvider')
  }

  return context
}