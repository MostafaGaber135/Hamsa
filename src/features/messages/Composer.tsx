import {
  ArrowRight,
  Check,
  CircleAlert,
  FileText,
  Image as ImageIcon,
  MapPin,
  Mic,
  Paperclip,
  Pencil,
  Reply,
  Smile,
  Trash2,
  X,
} from 'lucide-react'
import {
  lazy,
  Suspense,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { IconButton, focusRing } from '@/components/ui/Button'
import { Menu, type MenuAnchor } from '@/components/ui/Menu'
import { Spinner } from '@/components/ui/Spinner'
import { messagePreview } from '@/features/conversations/preview'
import { formatBytes, formatDuration, textDirection } from '@/lib/bidi'
import { locate, type LocationProblem } from '@/lib/geolocation'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import type { Attachment, Message, MessageKind, User } from '@/types/chat'
import { MAX_FILE_BYTES, MAX_IMAGE_BYTES, kindForFile } from './api'
import { getDraft, setDraft } from './drafts'
import { peekShare, takeShare } from './sharedIn'
import { useVoiceRecorder } from './useVoiceRecorder'

// The emoji list is large: it loads the first time you open the picker.
const ExpressionPicker = lazy(() => import('./ExpressionPicker').then((m) => ({ default: m.ExpressionPicker })))

const MAX_LINES = 6
/** Live loudness bars never shrink below this height (%), so silence still shows. */
const MIN_LEVEL_HEIGHT = 12
/** Photos, videos and files you can add to one send. */
const MAX_FILES = 10
/** "@" and the start of a username, right before the caret. */
const MENTION_QUERY = /(^|\s)@([a-z0-9_]{0,24})$/i

export interface Draft {
  kind: MessageKind
  content?: string
  file?: File
  attachment?: Attachment
  replyToId?: string
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
  /** The message you're replying to, and who wrote it. */
  replyTo?: { message: Message; senderName: string }
  onCancelReply?: () => void
  /** Your message being edited: the box holds its text until you save or cancel. */
  editing?: Message
  onSaveEdit?: (message: Message, content: string) => void
  onCancelEdit?: () => void
  /** Group members you can @mention (not you). Empty in one-to-one chats. */
  mentionable?: User[]
}

export function Composer({
  conversationId,
  recipientName,
  onSend,
  onTyping,
  replyTo,
  onCancelReply,
  editing,
  onSaveEdit,
  onCancelEdit,
  mentionable = [],
}: ComposerProps) {
  const { t, lang, dir, locale } = useLocale()
  const [shared] = useState(() => peekShare(conversationId))
  const [text, setText] = useState(() => shared?.text || getDraft(conversationId))
  const [pending, setPending] = useState<Pending[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [attachMenu, setAttachMenu] = useState<MenuAnchor | null>(null)
  const [locating, setLocating] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [caret, setCaret] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionClosed, setMentionClosed] = useState(false)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const mediaRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<HTMLInputElement>(null)
  const [draftBeforeEdit, setDraftBeforeEdit] = useState('')
  const [editingShown, setEditingShown] = useState<string>()

  const recorder = useVoiceRecorder((recording) =>
    onSend({
      kind: 'voice',
      file: recording.file,
      attachment: { durationMs: recording.durationMs, waveform: recording.waveform },
    }),
  )
  const canSend = text.trim().length > 0 || pending.length > 0
  const shownError =
    error ??
    (recorder.error === 'blocked'
      ? t.rich.micBlocked
      : recorder.error === 'unsupported'
        ? t.rich.micUnsupported
        : recorder.error === 'insecure'
          ? t.needsHttps
          : null)
  // The field follows the language you type in; empty, it follows the interface.
  const textDir = textDirection(text, dir)

  // @mentions: suggest members whose username or name starts with what you typed.
  const mentionMatch = mentionable.length > 0 && !mentionClosed ? text.slice(0, caret).match(MENTION_QUERY) : null
  const mentionQuery = mentionMatch?.[2].toLowerCase() ?? ''
  const suggestions = mentionMatch
    ? mentionable
        .filter((u) => u.username?.startsWith(mentionQuery) || u.name.toLowerCase().startsWith(mentionQuery))
        .slice(0, 6)
    : []

  // Grow with the content up to 6 lines, then scroll.
  useLayoutEffect(() => {
    const el = fieldRef.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight)
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * MAX_LINES)}px`
  }, [text, lang, pending])

  // A shared file goes through the same checks as one you pick, once, on arrival.
  const onArrival = useEffectEvent(() => {
    if (!shared) return
    takeShare(conversationId)
    if (shared.file) attach([shared.file])
  })
  useEffect(() => {
    onArrival()
  }, [])

  // Editing: the box shows the message's text; cancelling brings your draft back.
  // Adjusted while rendering, only when a different message starts being edited.
  const editingId = editing?.id
  if (editingId !== editingShown) {
    setEditingShown(editingId)
    if (editing) {
      setDraftBeforeEdit(getDraft(conversationId))
      setText(editing.content ?? '')
    }
  }
  useEffect(() => {
    if (editingId) fieldRef.current?.focus()
  }, [editingId])

  // Replying puts you straight in the box.
  const replyId = replyTo?.message.id
  useEffect(() => {
    if (replyId) fieldRef.current?.focus()
  }, [replyId])

  // Free the previews' memory when they're replaced or the composer goes away.
  useEffect(
    () => () => {
      for (const p of pending) if (p.url) URL.revokeObjectURL(p.url)
    },
    [pending],
  )

  function updateText(value: string) {
    setText(value)
    setMentionClosed(false)
    // While editing, the box holds the message, not your draft.
    if (!editing) setDraft(conversationId, value)
  }

  function attach(files: File[]) {
    const accepted: Pending[] = []
    for (const file of files.slice(0, MAX_FILES - pending.length)) {
      const kind = kindForFile(file)
      if (kind === 'image' && file.size > MAX_IMAGE_BYTES) {
        setError(t.composer.imageTooBig)
        continue
      }
      if (file.size > MAX_FILE_BYTES) {
        setError(t.rich.fileTooBig)
        continue
      }
      accepted.push({ file, kind, url: kind === 'image' || kind === 'video' ? URL.createObjectURL(file) : undefined })
    }
    if (accepted.length === 0) return
    if (accepted.length === files.length) setError(null)
    setPending((current) => [...current, ...accepted])
    fieldRef.current?.focus()
  }

  function stopEditing() {
    setText(draftBeforeEdit)
    onCancelEdit?.()
  }

  function send() {
    if (!canSend) return
    const content = text.trim() || undefined

    if (editing) {
      if (content && content !== editing.content) onSaveEdit?.(editing, content)
      stopEditing()
      return
    }

    const replyToId = replyTo?.message.id
    if (pending.length === 0) {
      onSend({ kind: 'text', content, replyToId })
    } else {
      // One message per file; the text becomes the first one's caption.
      pending.forEach((p, i) =>
        onSend({
          kind: p.kind,
          file: p.file,
          content: i === 0 ? content : undefined,
          replyToId: i === 0 ? replyToId : undefined,
        }),
      )
    }
    updateText('')
    setPending([])
    setError(null)
    onCancelReply?.()
    fieldRef.current?.focus()
  }

  function insertMention(user: User) {
    if (!mentionMatch || !user.username) return
    const before = text.slice(0, caret).replace(MENTION_QUERY, `$1@${user.username} `)
    const next = before + text.slice(caret)
    updateText(next)
    requestAnimationFrame(() => {
      fieldRef.current?.setSelectionRange(before.length, before.length)
      setCaret(before.length)
    })
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
    if (result)
      onSend({
        kind: 'voice',
        file: result.file,
        attachment: { durationMs: result.durationMs, waveform: result.waveform },
      })
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // The mention list takes ↑/↓, Enter/Tab and Esc while it's open.
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setMentionIndex((i) => (i + step + suggestions.length) % suggestions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(suggestions[Math.min(mentionIndex, suggestions.length - 1)])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionClosed(true)
        return
      }
    }
    // isComposing: don't send while an IME (e.g. Arabic on some keyboards) is mid-word.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
    if (e.key === 'Escape') {
      if (editing) stopEditing()
      else if (replyTo) onCancelReply?.()
      else fieldRef.current?.blur()
    }
  }

  // Pasting a screenshot or copied files attaches them.
  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (editing || e.clipboardData.files.length === 0) return
    e.preventDefault()
    attach([...e.clipboardData.files])
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    if (!editing) attach([...e.dataTransfer.files])
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
  const trackCaret = () => setCaret(fieldRef.current?.selectionStart ?? 0)

  return (
    <div className="relative">
      {(shownError || locating) && (
        <p
          role={shownError ? 'alert' : 'status'}
          className={cn(
            'mb-2 flex items-center gap-2 px-2 text-caption',
            shownError ? 'text-danger' : 'text-ink-muted',
          )}
        >
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

      {/* @mention suggestions, above the box. */}
      {suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label={t.msg.mention}
          className="absolute inset-x-2 bottom-full z-20 mb-2 overflow-hidden rounded-2xl bg-surface-raised py-1 shadow-lg ring-1 ring-line"
        >
          {suggestions.map((user, i) => (
            <li key={user.id} role="option" aria-selected={i === mentionIndex}>
              <button
                type="button"
                // mousedown, so the text box keeps its focus and caret.
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertMention(user)
                }}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-1.5 text-start',
                  i === mentionIndex ? 'bg-surface-hover' : 'hover:bg-surface-hover',
                )}
              >
                <Avatar id={user.id} name={user.name} src={user.avatarUrl} size="xs" />
                <span dir="auto" className="min-w-0 truncate text-body font-semibold text-ink">
                  {user.name}
                </span>
                <span dir="ltr" className="truncate text-caption text-ink-muted">
                  @{user.username}
                </span>
              </button>
            </li>
          ))}
        </ul>
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
        {/* Replying to or editing a message. */}
        {(replyTo || editing) && (
          <div className="mx-1.5 mt-1 mb-1 flex items-center gap-2 rounded-xl border-s-4 border-accent bg-surface-sunken py-1.5 ps-2 pe-1">
            {editing ? (
              <Pencil size={16} strokeWidth={1.75} className="shrink-0 text-accent" aria-hidden />
            ) : (
              <Reply size={16} strokeWidth={1.75} className="shrink-0 text-accent rtl:-scale-x-100" aria-hidden />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-caption font-bold text-accent">
                {editing ? t.msg.editing : t.msg.replyingTo(replyTo!.senderName)}
              </span>
              <span dir="auto" className="block truncate text-caption text-ink-muted">
                {messagePreview(editing ?? replyTo!.message, t)}
              </span>
            </span>
            <IconButton
              size="sm"
              label={editing ? t.msg.cancelEdit : t.msg.cancelReply}
              onClick={editing ? stopEditing : onCancelReply}
            >
              <X size={16} strokeWidth={2} />
            </IconButton>
          </div>
        )}

        {/* The attachments waiting to be sent, with previews. */}
        {pending.length > 0 && (
          <div className="flex gap-3 overflow-x-auto px-2 pt-1.5 pb-1">
            {pending.map((p, i) => (
              <span key={`${p.file.name}-${i}`} className="relative inline-flex max-w-full shrink-0">
                {p.kind === 'image' ? (
                  <img src={p.url} alt="" className="size-20 rounded-xl object-cover ring-1 ring-line" />
                ) : p.kind === 'video' ? (
                  <video
                    src={p.url}
                    muted
                    playsInline
                    className="size-20 rounded-xl bg-black object-cover ring-1 ring-line"
                  />
                ) : (
                  <span className="flex max-w-72 items-center gap-3 rounded-xl bg-surface-sunken py-2 ps-2 pe-4 ring-1 ring-line">
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                      <FileText size={20} strokeWidth={1.75} aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span dir="auto" className="block truncate text-body font-semibold text-ink">
                        {p.file.name}
                      </span>
                      <span className="block text-caption text-ink-muted">{formatBytes(p.file.size, locale)}</span>
                    </span>
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setPending((current) => current.filter((_, j) => j !== i))}
                  aria-label={`${t.rich.removeAttachment} ${p.file.name}`}
                  className="absolute -inset-e-2 -top-2 inline-flex size-6 items-center justify-center rounded-full bg-ink text-canvas shadow-sm hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  <X size={14} strokeWidth={2.5} aria-hidden />
                </button>
              </span>
            ))}
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
              <span className="shrink-0 text-ink-muted tabular-nums">{formatDuration(recorder.elapsedMs, locale)}</span>
              {/* Live loudness: newest bar on the right, like a scrolling tape. */}
              <span
                dir="ltr"
                aria-hidden
                className="flex h-8 min-w-0 flex-1 items-center justify-end gap-0.75 overflow-hidden"
              >
                {recorder.levels.map((level, i) => (
                  <span
                    key={i}
                    className="w-0.75 shrink-0 rounded-full bg-accent transition-[height] duration-75"
                    style={{ height: `${Math.max(MIN_LEVEL_HEIGHT, level * 100)}%` }}
                  />
                ))}
              </span>
            </span>
            <button
              type="button"
              onClick={sendRecording}
              aria-label={t.rich.sendRecording}
              title={t.rich.sendRecording}
              className={cn(
                'inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent hover:bg-accent-strong',
                focusRing,
              )}
            >
              <ArrowRight size={20} strokeWidth={2} className="rtl:-scale-x-100" aria-hidden />
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-1">
            {!editing && (
              <IconButton
                label={t.rich.attach}
                active={attachMenu !== null}
                aria-haspopup="menu"
                onClick={(e) => setAttachMenu(attachMenu ? null : { element: e.currentTarget })}
              >
                <Paperclip size={20} strokeWidth={1.75} />
              </IconButton>
            )}
            {attachMenu && (
              <Menu
                anchor={attachMenu}
                label={t.rich.attach}
                onClose={() => setAttachMenu(null)}
                items={[
                  {
                    id: 'media',
                    label: t.rich.photosVideos,
                    icon: <ImageIcon {...icon} />,
                    onSelect: () => mediaRef.current?.click(),
                  },
                  {
                    id: 'doc',
                    label: t.rich.document,
                    icon: <FileText {...icon} />,
                    onSelect: () => docRef.current?.click(),
                  },
                  { id: 'location', label: t.rich.location, icon: <MapPin {...icon} />, onSelect: shareLocation },
                ]}
              />
            )}
            <input
              ref={mediaRef}
              type="file"
              accept="image/*,video/*"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                attach([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
            <input
              ref={docRef}
              type="file"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                attach([...(e.target.files ?? [])])
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
                setCaret(e.target.selectionStart)
                setMentionIndex(0)
                if (e.target.value && !editing) onTyping?.()
              }}
              onSelect={trackCaret}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={t.writeMessage}
              aria-label={t.messageTo(recipientName)}
              aria-autocomplete={mentionable.length > 0 ? 'list' : undefined}
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
                      onSend({ kind: 'sticker', content: id, replyToId: replyTo?.message.id })
                      onCancelReply?.()
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

            {canSend || editing ? (
              <button
                type="button"
                onClick={send}
                aria-label={editing ? t.details.save : t.send}
                title={editing ? t.details.save : t.send}
                className={cn(
                  'inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent transition-[background-color,transform] duration-150 hover:bg-accent-strong active:scale-94 motion-reduce:active:scale-100',
                  focusRing,
                )}
              >
                {editing ? (
                  <Check size={20} strokeWidth={2.25} aria-hidden />
                ) : (
                  <ArrowRight size={20} strokeWidth={2} className="rtl:-scale-x-100" aria-hidden />
                )}
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
