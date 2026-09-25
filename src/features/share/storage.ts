import { del, get } from 'idb-keyval'

/**
 * What another app shared to Hamsa. The service worker saves it (it can't hand a
 * POST body to the page directly), and the /share page reads it once.
 */
export interface SharedItems {
  /** Title, text and link, joined with new lines. */
  text: string
  files: File[]
  /** When it was shared, so a stale share isn't picked up hours later. */
  at: number
}

export const SHARE_STORAGE_KEY = 'hamsa:share'
const FRESH_FOR_MS = 10 * 60 * 1000

let reading: Promise<SharedItems | null> | null = null

/**
 * Returns what was shared (once), or null if nothing recent is waiting. Calls made
 * at the same moment (React runs effects twice in development) share one read.
 */
export function takeSharedItems(): Promise<SharedItems | null> {
  reading ??= readOnce().finally(() => {
    reading = null
  })
  return reading
}

async function readOnce(): Promise<SharedItems | null> {
  try {
    const shared = await get<SharedItems>(SHARE_STORAGE_KEY)
    await del(SHARE_STORAGE_KEY)
    if (!shared || Date.now() - shared.at > FRESH_FOR_MS) return null
    return shared
  } catch {
    return null
  }
}
