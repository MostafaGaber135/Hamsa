import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { AppCrashed } from './components/AppCrashed.tsx'
import { ErrorBoundary } from './components/ui/ErrorBoundary.tsx'
import { LocaleProvider } from './lib/i18n.tsx'
import { registerMessageMutations } from './features/messages/queries.ts'
import { queryClient } from './lib/queryClient.ts'
import { startErrorMonitoring } from './lib/monitoring.ts'
import { persistOptions } from './lib/queryPersistence.ts'
import './styles/index.css'

// Before the saved cache is restored, so a message waiting in the outbox can resume.
registerMessageMutations(queryClient)
startErrorMonitoring()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
      onSuccess={() => queryClient.resumePausedMutations()}
    >
      <LocaleProvider>
        <ErrorBoundary fallback={<AppCrashed />}>
          <App />
        </ErrorBoundary>
      </LocaleProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
)
