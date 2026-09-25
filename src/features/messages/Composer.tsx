import { ArrowRight, CircleAlert, FileText, Image as ImageIcon, MapPin, Mic, Paperclip, Smile, Trash2, X } from 'lucide-react'
import {
  lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent,
} from 'react'
import { IconButton, focusRing } from '@/components/ui/Button'
import { Menu, type MenuAnchor } from '@/components/ui/Menu'
import { Spinner } from '@/components/ui/Spinner'
import { formatBytes, formatDuration, textDirection } from '@/lib/bidi'
import { locate, type LocationProblem } from '@/lib/geolocation'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import type { Attachment, MessageKind } from '@/types/chat'
import { MAX_FILE_BYTES, MAX_IMAGE_BYTES, kindForFile } from './api'
import { peekShare, takeShare } from './sharedIn'
import { useVoiceRecorder } from './useVoiceRecorder'

// The emoji list is large: it loads the first time you open the picker.
const ExpressionPicker = lazy(() => import('./ExpressionPicker').then((m) => ({ default: m.ExpressionPicker })))

const MAX_LINES = 6

// Unsent text per conversation, so switching chats doesn't lose what you were writing.
const drafts = new Map<string, string>()

export interface Draft {
  kind: MessageKind
  content?: string
  file?: File
  attachment?: Attachment
}

interface Pending {
  file: File
  kind: MessageKind
  url?: string
}

interface ComposerProps {
  conversationId: string
  recipientName: string
  onSend: (draft: Draft) => void
  /** Called on every keystroke (the typing hook throttles it). */
  onTyping?: () => void
}

export function Composer({ conversationId, recipientName, onSend, onTyping }: ComposerProps) {
  const { t, lang, dir, locale } = useLocale()
  const [shared] = useState(() => peekShare(conversationId))
  const [text, setText] = useState(() => shared?.text || drafts.get(conversationId) || '')
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [attachMenu, setAttachMenu] = useState<MenuAnchor | null>(null)
  const [locating, setLocating] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const mediaRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<HTMLInputElement>(null)

  const recorder = useVoiceRecorder((recording) =>
    onSend({ kind: 'voice', file: recording.file, attachment: { durationMs: recording.durationMs, waveform: recording.waveform } }),
  )
  const canSend = text.trim().length > 0 || pending !== null
  const shownError =
    error ?? (recorder.error === 'blocked' ? t.rich.micBlocked : recorder.error === 'unsupported' ? t.rich.micUnsupported : null)
  // The field follows the language you type in; empty, it follows the interface.
  const textDir = textDirection(text, dir)

  // Grow with the content up to 6 lines, then scroll.
  useLayoutEffect(() => {
    const el = fieldRef.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight)
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * MAX_LINES)}px`
  }, [text, lang, pending])

  // A shared file goes through the same checks as one you pick, once.
  useEffect(() => {
    if (!shared) return
    takeShare(conversationId)
    if (shared.file) attach(shared.file)
    // Only on arrival; attach is stable enough for this one-off use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Free the preview's memory when it's replaced or the composer goes away.
  useEffect(() => () => {
    if (pending?.url) URL.revokeObjectURL(pending.url)
  }, [pending])

  function updateText(value: string) {
    setText(value)
    if (value) drafts.set(conversationId, value)
    else drafts.delete(conversationId)
  }

  function attach(file: File | undefined) {
    if (!file) return
    const kind = kindForFile(file)
    if (kind === 'image' && file.size > MAX_IMAGE_BYTES) return setError(t.composer.imageTooBig)
    if (file.size > MAX_FILE_BYTES) return setError(t.rich.fileTooBig)
    setError(null)
    setPending({ file, kind, url: kind === 'image' || kind === 'video' ? URL.createObjectURL(file) : undefined })
    fieldRef.current?.focus()
  }

  function send() {
    if (!canSend) return
    const content = text.trim() || undefined
    onSend(pending ? { kind: pending.kind, file: pending.file, content } : { kind: 'text', content })
    updateText('')
    setPending(null)
    setError(null)
    fieldRef.current?.focus()
  }

  async function shareLocation() {
    setLocating(true)
    setError(null)
    try {
      const { lat, lng } = await locate()
      onSend({ kind: 'location', attachment: { lat, lng } })
    } catch (problem) {
      const messages: Record<LocationProblem, string> = {
        unsupported: t.rich.locationUnsupported,
        denied: t.geo.denied,
        deviceOff: t.geo.deviceOff,
        unavailable: t.geo.unavailable,
        timeout: t.geo.timeout,
      }
      setError(messages[problem as LocationProblem] ?? t.geo.unavailable)
    } finally {
      setLocating(false)
    }
  }

  async function sendRecording() {
    const result = await recorder.stop()
    if (result) onSend({ kind: 'voice', file: result.file, attachment: { durationMs: result.durationMs, waveform: result.waveform } })
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: don't send while an IME (e.g. Arabic on some keyboards) is mid-word.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
    if (e.key === 'Escape') fieldRef.current?.blur()
  }

  // Pasting a screenshot or a copied file attaches it.
  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const file = e.clipboardData.files[0]
    if (file) {
      e.preventDefault()
      attach(file)
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    attach(e.dataTransfer.files[0])
  }

  function insertEmoji(emoji: string) {
    const el = fieldRef.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    updateText(text.slice(0, start) + emoji + text.slice(end))
    // Keep the caret right after the emoji, ready for the next one.
    requestAnimationFrame(() => el?.setSelectionRange(start + emoji.length, start + emoji.length))
  }

  const icon = { size: 18, strokeWidth: 1.75 }

  return (
    <div>
      {(shownError || locating) && (
        <p role={shownError ? 'alert' : 'status'} className={cn('mb-2 flex items-center gap-2 px-2 text-caption', shownError ? 'text-danger' : 'text-ink-muted')}>
          {locating ? <Spinner /> : <CircleAlert size={14} strokeWidth={2} aria-hidden />}
          {locating ? t.rich.gettingLocation : shownError}
          {shownError && (
            <button
              type="button"
              onClick={() => {
                setError(null)
                recorder.clearError()
              }}
              aria-label={t.rich.close}
              className="ms-auto rounded p-0.5 hover:bg-surface-hover"
            >
              <X size={14} aria-hidden />
            </button>
          )}
        </p>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'rounded-3xl bg-surface-raised p-1.5 shadow-sm ring-1 ring-line ring-inset',
          'transition-shadow duration-150 hover:ring-line-strong',
          'has-[textarea:focus]:shadow-[0_0_0_4px_var(--accent-soft)] has-[textarea:focus]:ring-[1.5px] has-[textarea:focus]:ring-focus-ring',
          'forced-colors:has-[textarea:focus]:outline-2 forced-colors:has-[textarea:focus]:outline-[Highlight]',
          dragging && 'shadow-[0_0_0_4px_var(--accent-soft)] ring-[1.5px] ring-accent',
        )}
      >
        {/* The attachment waiting to be sent, with a preview. */}
        {pending && (
          <div className="px-2 pt-1.5 pb-1">
            <span className="relative inline-flex max-w-full">
              {pending.kind === 'image' ? (
                <img src={pending.url} alt="" className="size-20 rounded-xl object-cover ring-1 ring-line" />
              ) : pending.kind === 'video' ? (
                <video src={pending.url} muted playsInline className="size-20 rounded-xl bg-black object-cover ring-1 ring-line" />
              ) : (
                <span className="flex max-w-72 items-center gap-3 rounded-xl bg-surface-sunken py-2 ps-2 pe-4 ring-1 ring-line">
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <FileText size={20} strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span dir="auto" className="block truncate text-body font-semibold text-ink">{pending.file.name}</span>
                    <span className="block text-caption text-ink-muted">{formatBytes(pending.file.size, locale)}</span>
                  </span>
                </span>
              )}
              <button
                type="button"
                onClick={() => setPending(null)}
                aria-label={t.rich.removeAttachment}
                className="absolute -end-2 -top-2 inline-flex size-6 items-center justify-center rounded-full bg-ink text-canvas shadow-sm hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                <X size={14} strokeWidth={2.5} aria-hidden />
              </button>
            </span>
          </div>
        )}

        {recorder.recording ? (
          <div className="flex items-center gap-2" role="status">
            <IconButton label={t.rich.cancelRecording} onClick={recorder.cancel}>
              <Trash2 size={20} strokeWidth={1.75} className="text-danger" />
            </IconButton>
            <span className="flex min-w-0 flex-1 items-center gap-3 px-2 text-body text-ink">
              <span aria-hidden className="size-2.5 shrink-0 animate-pulse rounded-full bg-danger" />
              <span className="sr-only">{t.rich.recording}</span>
              <span className="shrink-0 tabular-nums text-ink-muted">{formatDuration(recorder.elapsedMs, locale)}</span>
              {/* Live loudness: newest bar on the right, like a scrolling tape. */}
              <span dir="ltr" aria-hidden className="flex h-8 min-w-0 flex-1 items-center justify-end gap-[3px] overflow-hidden">
                {recorder.levels.map((level, i) => (
                  <span
                    key={i}
                    className="w-[3px] shrink-0 rounded-full bg-accent transition-[height] duration-75"
                    style={{ height: `${Math.max(12, level * 100)}%` }}
                  />
                ))}
              </span>
            </span>
            <button
              type="button"
              onClick={sendRecording}
              aria-label={t.rich.sendRecording}
              title={t.rich.sendRecording}
              className={cn('inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent hover:bg-accent-strong', focusRing)}
            >
              <ArrowRight size={20} strokeWidth={2} className="rtl:-scale-x-100" aria-hidden />
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-1">
            <IconButton
              label={t.rich.attach}
              active={attachMenu !== null}
              aria-haspopup="menu"
              onClick={(e) => setAttachMenu(attachMenu ? null : { element: e.currentTarget })}
            >
              <Paperclip size={20} strokeWidth={1.75} />
            </IconButton>
            {attachMenu && (
              <Menu
                anchor={attachMenu}
                label={t.rich.attach}
                onClose={() => setAttachMenu(null)}
                items={[
                  { id: 'media', label: t.rich.photosVideos, icon: <ImageIcon {...icon} />, onSelect: () => mediaRef.current?.click() },
                  { id: 'doc', label: t.rich.document, icon: <FileText {...icon} />, onSelect: () => docRef.current?.click() },
                  { id: 'location', label: t.rich.location, icon: <MapPin {...icon} />, onSelect: shareLocation },
                ]}
              />
            )}
            <input
              ref={mediaRef}
              type="file"
              accept="image/*,video/*"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                attach(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <input
              ref={docRef}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                attach(e.target.files?.[0])
                e.target.value = ''
              }}
            />

            <textarea
              ref={fieldRef}
              rows={1}
              dir={textDir}
              value={text}
              onChange={(e) => {
                updateText(e.target.value)
                if (e.target.value) onTyping?.()
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={t.writeMessage}
              aria-label={t.messageTo(recipientName)}
              className={cn(
                'min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-ink caret-accent outline-none placeholder:text-ink-muted',
                // The placeholder follows the interface even when dir flips for the text.
                dir === 'rtl' ? 'placeholder-shown:text-right' : 'placeholder-shown:text-left',
                lang === 'ar' ? 'text-message-ar' : 'text-message',
              )}
            />

            <span className="relative">
              <IconButton
                label={t.emoji}
                active={pickerOpen}
                aria-haspopup="dialog"
                aria-expanded={pickerOpen}
                onClick={() => setPickerOpen((open) => !open)}
              >
                <Smile size={20} strokeWidth={1.75} />
              </IconButton>
              {pickerOpen && (
                <Suspense fallback={null}>
                  <ExpressionPicker
                    onEmoji={insertEmoji}
                    onSticker={(id) => {
                      onSend({ kind: 'sticker', content: id })
                      setPickerOpen(false)
                    }}
                    onClose={() => {
                      setPickerOpen(false)
                      fieldRef.current?.focus()
                    }}
                  />
                </Suspense>
              )}
            </span>

            {canSend ? (
              <button
                type="button"
                onClick={send}
                aria-label={t.send}
                title={t.send}
                className={cn(
                  'inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent transition-[background-color,transform] duration-150 hover:bg-accent-strong active:scale-94 motion-reduce:active:scale-100',
                  focusRing,
                )}
              >
                <ArrowRight size={20} strokeWidth={2} className="rtl:-scale-x-100" aria-hidden />
              </button>
            ) : (
              <IconButton label={t.rich.record} onClick={recorder.start}>
                <Mic size={20} strokeWidth={1.75} />
              </IconButton>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
