/** What was shared to Hamsa from another app, waiting for a chat's message box. */
interface IncomingShare {
  text?: string
  file?: File
}

const waiting = new Map<string, IncomingShare>()

/** Puts shared text and a file into a chat's message box, ready for you to send. */
export function queueShare(conversationId: string, share: IncomingShare) {
  waiting.set(conversationId, share)
}

/** What's waiting for this chat, if anything (it stays until takeShare). */
export function peekShare(conversationId: string): IncomingShare | undefined {
  return waiting.get(conversationId)
}

export function takeShare(conversationId: string) {
  waiting.delete(conversationId)
}
