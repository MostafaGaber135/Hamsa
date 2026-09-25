import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { AppCrashed } from './components/AppCrashed.tsx'
import { ErrorBoundary } from './components/ui/ErrorBoundary.tsx'
import { LocaleProvider } from './lib/i18n.tsx'
import { registerServiceWorker } from './lib/push.ts'
import { queryClient } from './lib/queryClient.ts'
import './styles/index.css'

registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <ErrorBoundary fallback={<AppCrashed />}>
          <App />
        </ErrorBoundary>
      </LocaleProvider>
    </QueryClientProvider>
  </StrictMode>,
)
