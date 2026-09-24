import { extensionFor, resizeImage } from '@/lib/image'
import { supabase } from '@/lib/supabase'
import type { Message } from '@/types/chat'
import { toMessage } from '../conversations/api'

export const PAGE_SIZE = 30
const BUCKET = 'chat-images'
/** Signed links stay valid for a day; pages are refetched long before that. */
const SIGNED_URL_SECONDS = 60 * 60 * 24
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/**
 * The bucket is private, so images are shown through short-lived signed links.
 * Storage checks you're a member of the conversation before signing.
 */
export async function withImageUrls(messages: Message[]): Promise<Message[]> {
  const paths = messages.flatMap((m) => (m.imagePath && !m.imageUrl ? [m.imagePath] : []))
  if (paths.length === 0) return messages

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS)
  if (error) throw error

  const urls = new Map(data.flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as const] : [])))
  return messages.map((m) => (m.imagePath && urls.has(m.imagePath) ? { ...m, imageUrl: urls.get(m.imagePath) } : m))
}

/** One page of messages, oldest first. `before` is the createdAt of the oldest message already loaded. */
export async function fetchMessagePage(conversationId: string, before?: string, clearedAt?: string): Promise<Message[]> {
  let query = supabase
    .from('messages')
    .select('id, conversation_id, sender_id, content, image_path, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE)

  if (before) query = query.lt('created_at', before)
  // After "Delete chat", only messages newer than that moment are shown to you.
  if (clearedAt) query = query.gt('created_at', clearedAt)

  const { data, error } = await query
  if (error) throw error
  return withImageUrls(data.map((row) => toMessage(row)).reverse())
}

/**
 * Resizes and uploads a chat image to "<conversation_id>/<message_id>.<ext>".
 * Using the message id as the file name makes a retry safe: the same file is never uploaded twice.
 */
async function uploadChatImage(conversationId: string, messageId: string, file: File): Promise<string> {
  const blob = await resizeImage(file, { maxSide: 1600 })
  const path = `${conversationId}/${messageId}.${extensionFor(blob)}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type })
  // "Already exists" on a retry means the first upload did reach the server.
  if (error && !/exists|duplicate/i.test(error.message)) throw error
  return path
}

export async function insertMessage(message: { id: string; conversationId: string; content?: string; imageFile?: File }) {
  const imagePath = message.imageFile
    ? await uploadChatImage(message.conversationId, message.id, message.imageFile)
    : null

  const { error } = await supabase.from('messages').insert({
    id: message.id,
    conversation_id: message.conversationId,
    content: message.content || null,
    image_path: imagePath,
  })
  // 23505 = duplicate key: a retry of a message that actually reached the server
  // the first time. The message exists, so that's a success.
  if (error && error.code !== '23505') throw error
}
