import { extensionFor, resizeImage } from '@/lib/image'
import { supabase } from '@/lib/supabase'

export const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/
const BUCKET = 'avatars'
const AVATAR_SIZE = 256
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export class UsernameTakenError extends Error {}

export async function updateProfile(userId: string, fields: { fullName: string; username: string }) {
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: fields.fullName.trim(), username: fields.username })
    .eq('id', userId)
  // 23505 = unique violation: someone else has this username.
  if (error?.code === '23505') throw new UsernameTakenError()
  if (error) throw error
}

export async function isUsernameAvailable(username: string, userId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('username', username)
    .neq('id', userId)
  if (error) throw error
  return count === 0
}

export function validateImage(file: File): 'tooBig' | 'wrongType' | null {
  if (!file.type.startsWith('image/')) return 'wrongType'
  if (file.size > MAX_UPLOAD_BYTES) return 'tooBig'
  return null
}

/** Path inside the bucket if the URL points at one of our uploaded avatars. */
function ownFilePath(url: string | null | undefined): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const index = url?.indexOf(marker) ?? -1
  return index >= 0 ? decodeURIComponent(url!.slice(index + marker.length)) : null
}

async function deleteOldFile(previousUrl: string | null | undefined) {
  const path = ownFilePath(previousUrl)
  // Best effort: a leftover file is harmless, so don't fail the whole change over it.
  if (path) await supabase.storage.from(BUCKET).remove([path])
}

export async function uploadAvatar(userId: string, file: File, previousUrl?: string | null): Promise<string> {
  // Cropped to a centred square and scaled to 256×256: a ~15 KB avatar.
  const blob = await resizeImage(file, { maxSide: AVATAR_SIZE, square: true })
  const extension = extensionFor(blob)
  // A new file name each time, so browsers never show a cached old photo.
  const path = `${userId}/${Date.now()}.${extension}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: blob.type, cacheControl: '31536000' })
  if (uploadError) throw uploadError

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  const { error } = await supabase.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', userId)
  if (error) throw error

  await deleteOldFile(previousUrl)
  return data.publicUrl
}

export async function removeAvatar(userId: string, previousUrl?: string | null) {
  const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId)
  if (error) throw error
  await deleteOldFile(previousUrl)
}

export async function changePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}
