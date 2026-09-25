/**
 * Unsent text per conversation, kept in localStorage so it survives switching chats,
 * reloading and closing Hamsa. Cleared when you sign out (see useSession).
 */

const STORAGE_KEY = 'hamsa:drafts'

function readAll(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAll(drafts: Record<string, string>) {
  try {
    if (Object.keys(drafts).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage full or blocked: the draft just isn't kept.
  }
}

export function getDraft(conversationId: string): string {
  const value = readAll()[conversationId]
  return typeof value === 'string' ? value : ''
}

export function setDraft(conversationId: string, text: string) {
  const drafts = readAll()
  if (text) drafts[conversationId] = text
  else delete drafts[conversationId]
  writeAll(drafts)
}

export function clearDrafts() {
  writeAll({})
}
