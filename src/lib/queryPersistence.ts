import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import type { Query } from '@tanstack/react-query'
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client'
import { del, get, set } from 'idb-keyval'

/**
 * Your chat list and recent messages are kept in this browser's IndexedDB, so
 * Hamsa opens instantly (and shows your chats while offline), then refreshes
 * from the server. Everything is wiped when you sign out.
 */

const STORAGE_KEY = 'hamsa:cache'
const OWNER_KEY = 'hamsa:cache-owner'
/** Change this when the shape of cached data changes, to drop old caches. */
const CACHE_VERSION = '1'
/** Photos and files are shown through links that expire after 24 hours. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000

// IndexedDB can be missing or blocked (private windows, strict settings):
// then there's simply no saved cache, and the app works as before.
async function attempt<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action()
  } catch {
    return undefined
  }
}

const persister = createAsyncStoragePersister({
  storage: {
    getItem: (key) => attempt(() => get<string>(key)).then((value) => value ?? null),
    setItem: (key, value) => attempt(() => set(key, value)).then(() => undefined),
    removeItem: (key) => attempt(() => del(key)).then(() => undefined),
  },
  key: STORAGE_KEY,
  throttleTime: 1000,
})

/** Only data worth showing at start-up, and never a message that's still sending. */
const PERSISTED = new Set(['conversations', 'messages', 'profile', 'friends', 'blocks', 'privacy-settings'])

function shouldPersist(query: Query) {
  if (query.state.status !== 'success' || !PERSISTED.has(String(query.queryKey[0]))) return false
  if (query.queryKey[0] !== 'messages') return true
  // A sending or failed message holds a picked file and a temporary preview link.
  const pages = (query.state.data as { pages?: { pending?: unknown; file?: unknown }[][] } | undefined)?.pages ?? []
  return !pages.some((page) => page.some((m) => m.pending || m.file))
}

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  maxAge: MAX_AGE_MS,
  buster: CACHE_VERSION,
  dehydrateOptions: { shouldDehydrateQuery: shouldPersist },
}

/** Forget everything saved in this browser (on sign-out). */
export function clearPersistedCache() {
  persister.removeClient()
  try {
    localStorage.removeItem(OWNER_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * The saved cache belongs to one account. Returns true when someone else signed in
 * on this browser since it was saved, so the caller can clear it.
 */
export function claimPersistedCache(userId: string): boolean {
  try {
    const owner = localStorage.getItem(OWNER_KEY)
    localStorage.setItem(OWNER_KEY, userId)
    return owner !== null && owner !== userId
  } catch {
    return false
  }
}
