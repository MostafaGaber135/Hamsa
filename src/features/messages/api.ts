import { extensionFor, resizeImage } from '@/lib/image'
import { supabase, supabaseConfig } from '@/lib/supabase'
import type { Attachment, Message, MessageKind } from '@/types/chat'
import { fromAttachment, toMessage } from '../conversations/api'

export const PAGE_SIZE = 30
const IMAGES = 'chat-images'
const FILES = 'chat-files'
/** Signed links stay valid for a day; pages are refetched long before that. */
const SIGNED_URL_SECONDS = 60 * 60 * 24
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_FILE_BYTES = 50 * 1024 * 1024

const COLUMNS =
  'id, conversation_id, sender_id, content, image_path, created_at, kind, attachment, reply_to_id, edited_at, deleted_at, pinned_at, mentions, message_reactions(user_id, emoji)'

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

export type SharedTab = 'media' | 'files' | 'voice' | 'links' | 'saved'

/** Photos and videos, files, voice notes, links, or what you saved: for the chat's info panel. */
export async function fetchSharedItems(conversationId: string, tab: SharedTab, clearedAt?: string): Promise<Message[]> {
  let query = supabase
    .from('messages')
    .select(COLUMNS)
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(90)

  if (tab === 'media') query = query.in('kind', ['image', 'video'])
  if (tab === 'files') query = query.eq('kind', 'file')
  if (tab === 'voice') query = query.eq('kind', 'voice')
  if (tab === 'links') query = query.eq('kind', 'text').ilike('content', '%http%')
  if (tab === 'saved') query = query.in('id', await fetchSavedIds())
  if (clearedAt) query = query.gt('created_at', clearedAt)

  const { data, error } = await query
  if (error) throw error
  return withMediaUrls(data.map((row) => toMessage(row)))
}

/** The messages pinned to the top of a chat, newest first. */
export async function fetchPinnedMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select(COLUMNS)
    .eq('conversation_id', conversationId)
    .not('pinned_at', 'is', null)
    .order('pinned_at', { ascending: false })
  if (error) throw error
  return data.map((row) => toMessage(row))
}

export function kindForFile(file: File): MessageKind {
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'voice'
  return 'file'
}

// ---------- uploads with progress ----------

export interface UploadOptions {
  /** 0 to 1, as the file goes up. */
  onProgress?: (fraction: number) => void
  /** Aborting cancels the upload (and the message). */
  signal?: AbortSignal
}

/**
 * Uploads to Storage with XMLHttpRequest, which reports progress (fetch, and so
 * supabase-js, can't). Same endpoint and rules: Storage still checks you're a member.
 */
async function upload(bucket: string, path: string, body: Blob, contentType: string, { onProgress, signal }: UploadOptions) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token ?? supabaseConfig.key
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${supabaseConfig.url}/storage/v1/object/${bucket}/${encodedPath}`)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('apikey', supabaseConfig.key)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      // Already there: a retry of an upload that finished the first time.
      if (xhr.status < 300 || /exists|duplicate/i.test(xhr.responseText)) resolve()
      else reject(new Error(`Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new TypeError('Network error while uploading'))
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    if (signal?.aborted) xhr.abort()
    else xhr.send(body)
  })
}

async function uploadImage(conversationId: string, messageId: string, file: File, options: UploadOptions): Promise<string> {
  // GIFs keep their animation; everything else is resized to at most 1600 px.
  const blob = file.type === 'image/gif' ? file : await resizeImage(file, { maxSide: 1600 })
  const extension = file.type === 'image/gif' ? 'gif' : extensionFor(blob)
  const path = `${conversationId}/${messageId}.${extension}`
  await upload(IMAGES, path, blob, blob.type, options)
  return path
}

async function uploadFile(conversationId: string, messageId: string, file: File, options: UploadOptions): Promise<string> {
  // The message id as the folder keeps names unique and makes a retry safe.
  const safeName = file.name.replace(/[^\w.-]+/g, '_').slice(-80) || 'file'
  const path = `${conversationId}/${messageId}/${safeName}`
  await upload(FILES, path, file, file.type || 'application/octet-stream', options)
  return path
}

export interface OutgoingMessage {
  id: string
  conversationId: string
  kind: MessageKind
  content?: string
  file?: File
  attachment?: Attachment
  replyToId?: string
}

/** Where the attachment ended up, so the app can show it from the server. */
export interface SavedMessage {
  imagePath?: string
  attachment?: Attachment
}

export async function insertMessage(message: OutgoingMessage, options: UploadOptions = {}): Promise<SavedMessage> {
  let imagePath: string | null = null
  let attachment: Attachment | undefined = message.attachment

  if (message.file && message.kind === 'image') {
    imagePath = await uploadImage(message.conversationId, message.id, message.file, options)
  } else if (message.file) {
    const path = await uploadFile(message.conversationId, message.id, message.file, options)
    attachment = { ...attachment, path, name: message.file.name, size: message.file.size, mime: message.file.type }
  }

  const { error } = await supabase.from('messages').insert({
    id: message.id,
    conversation_id: message.conversationId,
    kind: message.kind,
    content: message.content || null,
    image_path: imagePath,
    attachment: attachment ? fromAttachment(attachment) : null,
    reply_to_id: message.replyToId ?? null,
  })
  // 23505 = duplicate key: a retry of a message that actually reached the server
  // the first time. The message exists, so that's a success.
  if (error && error.code !== '23505') throw error
  return { imagePath: imagePath ?? undefined, attachment }
}

// ---------- what you can do with a message ----------

export async function editMessage(id: string, content: string) {
  const { error } = await supabase.rpc('edit_message', { msg_id: id, new_content: content })
  if (error) throw error
}

export async function deleteMessage(id: string) {
  const { error } = await supabase.rpc('delete_message', { msg_id: id })
  if (error) throw error
}

/** emoji null removes your reaction. */
export async function reactToMessage(id: string, emoji: string | null) {
  const { error } = await supabase.rpc('react', { msg_id: id, emoji })
  if (error) throw error
}

export async function pinMessage(id: string, pinned: boolean) {
  const { error } = await supabase.rpc('pin_message', { msg_id: id, pinned })
  if (error) throw error
}

export async function fetchSavedIds(): Promise<string[]> {
  const { data, error } = await supabase.from('saved_messages').select('message_id')
  if (error) throw error
  return data.map((row) => row.message_id)
}

export async function setSaved(id: string, saved: boolean) {
  const { error } = saved
    ? await supabase.from('saved_messages').insert({ message_id: id })
    : await supabase.from('saved_messages').delete().eq('message_id', id)
  // Already saved (a double click): fine.
  if (error && error.code !== '23505') throw error
}

export type ReportReason = 'spam' | 'harassment' | 'inappropriate' | 'other'

export async function reportUser(userId: string, messageId: string | null, reason: ReportReason, details?: string) {
  const { error } = await supabase.rpc('report', {
    target_user: userId,
    msg_id: messageId,
    reason,
    details: details || null,
  })
  if (error) throw error
}

export interface SearchResult {
  id: string
  conversationId: string
  senderId: string
  content: string
  createdAt: string
}

/** Your messages containing the text, in every chat you're in, newest first. */
export async function searchMessages(query: string): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc('search_messages', { query })
  if (error) throw error
  return data.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    content: row.content,
    createdAt: row.created_at,
  }))
}

export interface LinkPreview {
  title: string | null
  description: string | null
  siteName: string | null
}

/** Fetched by the link-preview Edge Function, so the site never sees who's reading. */
export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  const { data, error } = await supabase.functions.invoke<LinkPreview>('link-preview', { body: { url } })
  if (error || !data || (!data.title && !data.description)) return null
  return data
}
