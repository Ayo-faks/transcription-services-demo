import { RouterProvider } from 'react-router-dom'
import { AppErrorBoundary } from './app/errors/AppErrorBoundary'
import { AssistantWorkspaceProvider } from './app/providers/AssistantWorkspaceProvider'
import { AuthSessionProvider } from './app/providers/AuthSessionProvider'
import { PlatformShellProvider } from './app/providers/PlatformShellProvider'
import { RuntimeConfigProvider } from './app/providers/RuntimeConfigProvider'
import { router } from './app/router'
import { EncounterContextProvider } from './assistant/context/EncounterContextProvider'
import { OperationalContextProvider } from './assistant/context/OperationalContextProvider'
import { AgentRuntimeProvider } from './assistant/runtime/AgentRuntimeProvider'
import { GlobalKnowledgeProvider } from './assistant/tools/GlobalKnowledgeProvider'
import { CurrentViewProvider } from './assistant/tools/CurrentViewProvider'

function App() {
  return (
    <AppErrorBoundary>
      <RuntimeConfigProvider>
        <PlatformShellProvider>
          <GlobalKnowledgeProvider>
            <CurrentViewProvider>
              <AuthSessionProvider>
                <AssistantWorkspaceProvider>
                  <EncounterContextProvider>
                    <OperationalContextProvider>
                      <AgentRuntimeProvider>
                        <RouterProvider router={router} />
                      </AgentRuntimeProvider>
                    </OperationalContextProvider>
                  </EncounterContextProvider>
                </AssistantWorkspaceProvider>
              </AuthSessionProvider>
            </CurrentViewProvider>
          </GlobalKnowledgeProvider>
        </PlatformShellProvider>
      </RuntimeConfigProvider>
    </AppErrorBoundary>
  )
}

export default App
