import type { Message } from '@/types/chat'
import { downloadUrl } from './api'

/** Photos, videos and documents that can be shown full screen. */
export function isViewable(m: Message) {
  return m.kind === 'image' || m.kind === 'video' || m.kind === 'file'
}

/** Downloads the attachment under its original file name. */
export async function saveFile(message: Message) {
  const url = await downloadUrl(message)
  if (!url) return
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
}
