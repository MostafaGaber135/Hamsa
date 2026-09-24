import { extensionFor, resizeImage } from '@/lib/image'
import { supabase } from '@/lib/supabase'
import type { Attachment, Message, MessageKind } from '@/types/chat'
import { fromAttachment, toMessage } from '../conversations/api'

export const PAGE_SIZE = 30
const IMAGES = 'chat-images'
const FILES = 'chat-files'
/** Signed links stay valid for a day; pages are refetched long before that. */
const SIGNED_URL_SECONDS = 60 * 60 * 24
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_FILE_BYTES = 50 * 1024 * 1024

const COLUMNS = 'id, conversation_id, sender_id, content, image_path, created_at, kind, attachment'

async function sign(bucket: string, paths: string[]) {
  if (paths.length === 0) return new Map<string, string>()
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_SECONDS)
  if (error) throw error
  return new Map(data.flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as const] : [])))
}

/**
 * Both buckets are private, so images, voice notes and files are shown through
 * short-lived signed links. Storage checks you're a member of the conversation first.
 */
export async function withMediaUrls(messages: Message[]): Promise<Message[]> {
  const imagePaths = messages.flatMap((m) => (m.imagePath && !m.imageUrl ? [m.imagePath] : []))
  const filePaths = messages.flatMap((m) => (m.attachment?.path && !m.fileUrl ? [m.attachment.path] : []))
  const [images, files] = await Promise.all([sign(IMAGES, imagePaths), sign(FILES, filePaths)])

  return messages.map((m) => {
    const next = { ...m }
    if (m.imagePath && images.has(m.imagePath)) next.imageUrl = images.get(m.imagePath)
    if (m.attachment?.path && files.has(m.attachment.path)) next.fileUrl = files.get(m.attachment.path)
    return next
  })
}

/** A link that downloads the file under its original name instead of opening it. */
export async function downloadUrl(message: Message): Promise<string | undefined> {
  const bucket = message.imagePath ? IMAGES : FILES
  const path = message.imagePath ?? message.attachment?.path
  if (!path) return undefined
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 10, { download: message.attachment?.name ?? true })
  if (error) throw error
  return data.signedUrl
}

/** One page of messages, oldest first. `before` is the createdAt of the oldest message already loaded. */
export async function fetchMessagePage(conversationId: string, before?: string, clearedAt?: string): Promise<Message[]> {
  let query = supabase
    .from('messages')
    .select(COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE)

  if (before) query = query.lt('created_at', before)
  // After "Delete chat", only messages newer than that moment are shown to you.
  if (clearedAt) query = query.gt('created_at', clearedAt)

  const { data, error } = await query
  if (error) throw error
  return withMediaUrls(data.map((row) => toMessage(row)).reverse())
}

/** Photos and videos, files, voice notes, or messages with links: for the chat's info panel. */
export async function fetchSharedItems(
  conversationId: string,
  tab: 'media' | 'files' | 'voice' | 'links',
  clearedAt?: string,
): Promise<Message[]> {
  let query = supabase
    .from('messages')
    .select(COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(90)

  if (tab === 'media') query = query.in('kind', ['image', 'video'])
  if (tab === 'files') query = query.eq('kind', 'file')
  if (tab === 'voice') query = query.eq('kind', 'voice')
  if (tab === 'links') query = query.eq('kind', 'text').ilike('content', '%http%')
  if (clearedAt) query = query.gt('created_at', clearedAt)

  const { data, error } = await query
  if (error) throw error
  return withMediaUrls(data.map((row) => toMessage(row)))
}

export function kindForFile(file: File): MessageKind {
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'voice'
  return 'file'
}

async function uploadImage(conversationId: string, messageId: string, file: File): Promise<string> {
  // GIFs keep their animation; everything else is resized to at most 1600 px.
  const blob = file.type === 'image/gif' ? file : await resizeImage(file, { maxSide: 1600 })
  const extension = file.type === 'image/gif' ? 'gif' : extensionFor(blob)
  const path = `${conversationId}/${messageId}.${extension}`
  const { error } = await supabase.storage.from(IMAGES).upload(path, blob, { contentType: blob.type })
  if (error && !/exists|duplicate/i.test(error.message)) throw error
  return path
}

async function uploadFile(conversationId: string, messageId: string, file: File): Promise<string> {
  // The message id as the folder keeps names unique and makes a retry safe.
  const safeName = file.name.replace(/[^\w.-]+/g, '_').slice(-80) || 'file'
  const path = `${conversationId}/${messageId}/${safeName}`
  const { error } = await supabase.storage.from(FILES).upload(path, file, { contentType: file.type || 'application/octet-stream' })
  if (error && !/exists|duplicate/i.test(error.message)) throw error
  return path
}

export interface OutgoingMessage {
  id: string
  conversationId: string
  kind: MessageKind
  content?: string
  file?: File
  attachment?: Attachment
}

export async function insertMessage(message: OutgoingMessage) {
  let imagePath: string | null = null
  let attachment: Attachment | undefined = message.attachment

  if (message.file && message.kind === 'image') {
    imagePath = await uploadImage(message.conversationId, message.id, message.file)
  } else if (message.file) {
    const path = await uploadFile(message.conversationId, message.id, message.file)
    attachment = { ...attachment, path, name: message.file.name, size: message.file.size, mime: message.file.type }
  }

  const { error } = await supabase.from('messages').insert({
    id: message.id,
    conversation_id: message.conversationId,
    kind: message.kind,
    content: message.content || null,
    image_path: imagePath,
    attachment: attachment ? fromAttachment(attachment) : null,
  })
  // 23505 = duplicate key: a retry of a message that actually reached the server
  // the first time. The message exists, so that's a success.
  if (error && error.code !== '23505') throw error
}
