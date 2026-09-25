import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { AppCrashed } from './components/AppCrashed.tsx'
import { ErrorBoundary } from './components/ui/ErrorBoundary.tsx'
import { LocaleProvider } from './lib/i18n.tsx'
import { registerServiceWorker } from './lib/push.ts'
import { queryClient } from './lib/queryClient.ts'
import { persistOptions } from './lib/queryPersistence.ts'
import './styles/index.css'

registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <LocaleProvider>
        <ErrorBoundary fallback={<AppCrashed />}>
          <App />
        </ErrorBoundary>
      </LocaleProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
)
