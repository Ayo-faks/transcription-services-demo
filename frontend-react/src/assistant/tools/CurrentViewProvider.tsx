import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export interface CurrentViewContextValue {
  route: string
  title: string
  summary: string
  facts: string[]
  outcomes?: string[]
  nextSteps?: string[]
  raw: Record<string, unknown>
}

interface CurrentViewProviderValue {
  view: CurrentViewContextValue | null
  setView: (view: CurrentViewContextValue | null) => void
  queryView: (question: string) => string
}

const CurrentViewContext = createContext<CurrentViewProviderValue | null>(null)

function areViewsEqual(left: CurrentViewContextValue | null, right: CurrentViewContextValue | null) {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return JSON.stringify(left) === JSON.stringify(right)
}

export function CurrentViewProvider({ children }: { children: ReactNode }) {
  const [view, setViewState] = useState<CurrentViewContextValue | null>(null)

  const setView = useMemo(
    () => (nextView: CurrentViewContextValue | null) => {
      setViewState((currentView) => (areViewsEqual(currentView, nextView) ? currentView : nextView))
    },
    [],
  )

  const value = useMemo<CurrentViewProviderValue>(
    () => ({
      view,
      setView,
      queryView: (question: string) => {
        if (!view) {
          return 'There is no structured view context registered for this route yet.'
        }

        const normalizedQuestion = question.toLowerCase()
        const tokens = normalizedQuestion.split(/\W+/).filter(Boolean)
        const matchedFacts = view.facts.filter((fact) => {
          return tokens.some((token) => fact.toLowerCase().includes(token))
        })
        const matchedOutcomes = (view.outcomes || []).filter((outcome) =>
          tokens.some((token) => outcome.toLowerCase().includes(token)),
        )
        const matchedSteps = (view.nextSteps || []).filter((step) =>
          tokens.some((token) => step.toLowerCase().includes(token)),
        )

        if (matchedFacts.length > 0 || matchedOutcomes.length > 0 || matchedSteps.length > 0) {
          return `${view.title}: ${[...matchedOutcomes.slice(0, 2), ...matchedFacts.slice(0, 4), ...matchedSteps.slice(0, 1)].join(' ')}`
        }

        const nextStepSummary = view.nextSteps && view.nextSteps.length > 0
          ? ` Next steps: ${view.nextSteps.slice(0, 2).join(' ')}`
          : ''

        return `${view.title}: ${view.summary}${nextStepSummary}`
      },
    }),
    [setView, view],
  )

  return <CurrentViewContext.Provider value={value}>{children}</CurrentViewContext.Provider>
}

export function useCurrentView() {
  const context = useContext(CurrentViewContext)
  if (!context) {
    throw new Error('useCurrentView must be used inside CurrentViewProvider')
  }

  return context
}

export function useRegisterCurrentView(view: CurrentViewContextValue | null) {
  const { setView } = useCurrentView()

  useEffect(() => {
    setView(view)

    return undefined
  }, [setView, view])

  useEffect(() => {
    return () => {
      setView(null)
    }
  }, [setView])
}