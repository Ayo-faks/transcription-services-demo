import { createBrowserRouter } from 'react-router-dom'
import { AmbientScribePage } from '../../features/ambient/AmbientScribePage'
import { EncounterReviewPage } from '../../features/encounters/EncounterReviewPage'
import { ResultsPage } from '../../features/results/ResultsPage'
import { UploadPage } from '../../features/upload/UploadPage'
import { AppShell } from '../../shell/layout/AppShell'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <UploadPage />,
      },
      {
        path: 'ambient-scribe',
        element: <AmbientScribePage />,
      },
      {
        path: 'jobs/:jobId',
        element: <ResultsPage />,
      },
      {
        path: 'encounters/:encounterId/review',
        element: <EncounterReviewPage />,
      },
    ],
  },
])