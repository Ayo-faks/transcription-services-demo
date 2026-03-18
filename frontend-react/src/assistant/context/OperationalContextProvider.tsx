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
import type { ActionPreviewResponse, OperationalContextSnapshot } from '../../shared/types/api'

interface OperationalContextState {
  operationalContext: OperationalContextSnapshot | null
  actionPreviews: ActionPreviewResponse | null
  isLoadingOperationalContext: boolean
  isLoadingActionPreviews: boolean
  error: string | null
}

interface OperationalContextValue extends OperationalContextState {
  refreshOperationalContext: (encounterId?: string | null) => Promise<OperationalContextSnapshot | null>
  refreshActionPreviews: (encounterId?: string | null, toolId?: string) => Promise<ActionPreviewResponse | null>
  clearOperationalContext: () => void
}

const OperationalContext = createContext<OperationalContextValue | null>(null)

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message
  }

  return 'Operational context could not be loaded.'
}

export function OperationalContextProvider({ children }: { children: ReactNode }) {
  const transport = useAssistantTransport()
  const encounterId = useAssistantSessionStore((state) => state.encounterId)
  const [state, setState] = useState<OperationalContextState>({
    operationalContext: null,
    actionPreviews: null,
    isLoadingOperationalContext: false,
    isLoadingActionPreviews: false,
    error: null,
  })

  const clearOperationalContext = useMemo(
    () => () => {
      setState({
        operationalContext: null,
        actionPreviews: null,
        isLoadingOperationalContext: false,
        isLoadingActionPreviews: false,
        error: null,
      })
    },
    [],
  )

  const refreshOperationalContext = useMemo(
    () =>
      async (targetEncounterId?: string | null) => {
        if (!targetEncounterId) {
          clearOperationalContext()
          return null
        }

        setState((currentState) => ({ ...currentState, isLoadingOperationalContext: true, error: null }))
        try {
          const response = await transport.getOperationalContext(targetEncounterId)
          setState((currentState) => ({
            ...currentState,
            operationalContext: response,
            isLoadingOperationalContext: false,
            error: null,
          }))
          return response
        } catch (error) {
          const message = getErrorMessage(error)
          setState((currentState) => ({ ...currentState, isLoadingOperationalContext: false, error: message }))
          return null
        }
      },
    [clearOperationalContext, transport],
  )

  const refreshActionPreviews = useMemo(
    () =>
      async (targetEncounterId?: string | null, toolId?: string) => {
        if (!targetEncounterId) {
          setState((currentState) => ({ ...currentState, actionPreviews: null, isLoadingActionPreviews: false }))
          return null
        }

        setState((currentState) => ({ ...currentState, isLoadingActionPreviews: true, error: null }))
        try {
          const response = await transport.previewActions(targetEncounterId, toolId)
          setState((currentState) => ({
            ...currentState,
            actionPreviews: response,
            isLoadingActionPreviews: false,
            error: null,
          }))
          return response
        } catch (error) {
          const message = getErrorMessage(error)
          setState((currentState) => ({ ...currentState, isLoadingActionPreviews: false, error: message }))
          return null
        }
      },
    [transport],
  )

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!encounterId) {
        clearOperationalContext()
        return
      }

      const [operationalContext, actionPreviews] = await Promise.all([
        refreshOperationalContext(encounterId),
        refreshActionPreviews(encounterId),
      ])

      if (cancelled || (!operationalContext && !actionPreviews)) {
        return
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [clearOperationalContext, encounterId, refreshActionPreviews, refreshOperationalContext])

  const value = useMemo<OperationalContextValue>(
    () => ({
      ...state,
      refreshOperationalContext,
      refreshActionPreviews,
      clearOperationalContext,
    }),
    [clearOperationalContext, refreshActionPreviews, refreshOperationalContext, state],
  )

  return <OperationalContext.Provider value={value}>{children}</OperationalContext.Provider>
}

export function useOperationalContext() {
  const context = useContext(OperationalContext)
  if (!context) {
    throw new Error('useOperationalContext must be used inside OperationalContextProvider')
  }

  return context
}