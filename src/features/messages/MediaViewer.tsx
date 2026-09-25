import { ChevronLeft, ChevronRight, Download, FileText, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { formatBytes } from '@/lib/bidi'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import type { Message, User } from '@/types/chat'
import { saveFile } from './media'

interface MediaViewerProps {
  items: Message[]
  startId: string
  users: Record<string, User>
  onClose: () => void
}

/**
 * Full-screen preview. ←/→ move between items (mirrored in Arabic), Esc closes.
 * PDFs open in the browser's own viewer; other documents offer a download.
 */
export function MediaViewer({ items, startId, users, onClose }: MediaViewerProps) {
  const { t, fmt, locale, dir } = useLocale()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      items.findIndex((m) => m.id === startId),
    ),
  )
  const item = items[index]
  const sender = item ? users[item.senderId] : undefined

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  const go = (step: number) => setIndex((i) => Math.min(items.length - 1, Math.max(0, i + step)))

  function handleKey(e: React.KeyboardEvent) {
    const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
    const back = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
    if (e.key === forward) go(1)
    if (e.key === back) go(-1)
  }

  if (!item) return null
  const url = item.imageUrl ?? item.fileUrl
  const mime = item.attachment?.mime ?? ''
  const isPdf = item.kind === 'file' && mime === 'application/pdf'
  const isImageFile = item.kind === 'file' && mime.startsWith('image/')

  const nav =
    'inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-30'

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onKeyDown={handleKey}
      aria-label={t.rich.photosVideos}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-black/92 p-0 text-white backdrop:bg-black/80"
    >
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 items-center gap-3 px-3 py-2 md:px-5">
          {sender && <Avatar id={sender.id} name={sender.name} src={sender.avatarUrl} size="md" />}
          <div className="min-w-0 flex-1">
            <p dir="auto" className="truncate text-name">
              {sender?.name}
            </p>
            <p className="text-caption text-white/70">
              {fmt.day(item.createdAt)} · {fmt.time(item.createdAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => saveFile(item)}
            aria-label={t.rich.download}
            title={t.rich.download}
            className={nav}
          >
            <Download size={20} strokeWidth={1.75} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label={t.rich.close}
            title={t.rich.close}
            className={nav}
          >
            <X size={22} strokeWidth={1.75} aria-hidden />
          </button>
        </header>

        <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-2 md:px-20">
          {item.kind === 'image' || isImageFile ? (
            <img key={item.id} src={url} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
          ) : item.kind === 'video' ? (
            <video
              key={item.id}
              src={url}
              controls
              autoPlay
              playsInline
              className="max-h-full max-w-full rounded-lg bg-black"
            />
          ) : isPdf ? (
            <iframe
              key={item.id}
              src={url}
              title={item.attachment?.name ?? t.rich.document}
              className="h-full w-full max-w-5xl rounded-lg bg-white"
            />
          ) : (
            <div className="flex flex-col items-center gap-4 text-center">
              <span className="inline-flex size-24 items-center justify-center rounded-3xl bg-white/10">
                <FileText size={44} strokeWidth={1.5} aria-hidden />
              </span>
              <div>
                <p dir="auto" className="text-title-3">
                  {item.attachment?.name}
                </p>
                <p className="text-body text-white/70">{formatBytes(item.attachment?.size, locale)}</p>
              </div>
              <Button onClick={() => saveFile(item)} icon={<Download size={18} strokeWidth={1.75} aria-hidden />}>
                {t.rich.download}
              </Button>
            </div>
          )}

          {items.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                disabled={index === 0}
                aria-label={t.rich.previous}
                className={cn(nav, 'absolute inset-s-2 top-1/2 -translate-y-1/2 md:inset-s-5')}
              >
                <ChevronLeft size={24} strokeWidth={1.75} className="rtl:-scale-x-100" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                disabled={index === items.length - 1}
                aria-label={t.rich.next}
                className={cn(nav, 'absolute inset-e-2 top-1/2 -translate-y-1/2 md:inset-e-5')}
              >
                <ChevronRight size={24} strokeWidth={1.75} className="rtl:-scale-x-100" aria-hidden />
              </button>
            </>
          )}
        </div>

        {item.content && (
          <p dir="auto" className="mx-auto max-w-2xl shrink-0 px-4 pb-2 text-center text-body text-white/90">
            {item.content}
          </p>
        )}
        {items.length > 1 && (
          <p className="shrink-0 pb-3 text-center text-caption text-white/60 tabular-nums">
            {fmt.number(index + 1)} / {fmt.number(items.length)}
          </p>
        )}
      </div>
    </dialog>
  )
}
