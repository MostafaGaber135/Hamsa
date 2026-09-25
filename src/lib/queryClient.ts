import { QueryClient } from '@tanstack/react-query'

/** Data is fresh for this long; live updates patch it in between, so refetches are rare. */
const STALE_MS = 30_000
/** A failed request is tried once more before showing an error. */
const RETRIES = 1

/** The app's one cache for server data (TanStack Query), saved to IndexedDB (see queryPersistence). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_MS,
      retry: RETRIES,
    },
  },
})
