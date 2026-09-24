import { ArrowRight, CircleAlert, ImagePlus, Smile, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { IconButton, focusRing } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import { MAX_IMAGE_BYTES } from './api'
import { EmojiPicker } from './EmojiPicker'

const MAX_LINES = 6

// Unsent text per conversation, so switching chats doesn't lose what you were writing.
const drafts = new Map<string, string>()

interface ComposerProps {
  conversationId: string
  recipientName: string
  onSend: (text: string, image?: File) => void
  /** Called on every keystroke (the typing hook throttles it). */
  onTyping?: () => void
}

export function Composer({ conversationId, recipientName, onSend, onTyping }: ComposerProps) {
  const { t, lang } = useLocale()
  const [text, setText] = useState(() => drafts.get(conversationId) ?? '')
  const [image, setImage] = useState<{ file: File; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const canSend = text.trim().length > 0 || image !== null

  // Grow with the content up to 6 lines, then scroll.
  useLayoutEffect(() => {
    const el = fieldRef.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight)
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * MAX_LINES)}px`
  }, [text, lang])

  // Free the preview's memory when it's replaced or the composer goes away.
  useEffect(() => () => {
    if (image) URL.revokeObjectURL(image.url)
  }, [image])

  function updateText(value: string) {
    setText(value)
    if (value) drafts.set(conversationId, value)
    else drafts.delete(conversationId)
  }

  function attach(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) return setError(t.composer.imageWrongType)
    if (file.size > MAX_IMAGE_BYTES) return setError(t.composer.imageTooBig)
    setError(null)
    setImage({ file, url: URL.createObjectURL(file) })
    fieldRef.current?.focus()
  }

  function send() {
    if (!canSend) return
    onSend(text.trim(), image?.file)
    updateText('')
    setImage(null)
    setError(null)
    fieldRef.current?.focus()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: don't send while an IME (e.g. Arabic on some keyboards) is mid-word.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
    if (e.key === 'Escape') fieldRef.current?.blur()
  }

  // Pasting a screenshot attaches it.
  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
    if (file) {
      e.preventDefault()
      attach(file)
    }
  }

  function insertEmoji(emoji: string) {
    const el = fieldRef.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    updateText(text.slice(0, start) + emoji + text.slice(end))
    setEmojiOpen(false)
    // Put the caret right after the emoji.
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + emoji.length, start + emoji.length)
    })
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-2 flex items-center gap-2 px-2 text-caption text-danger">
          <CircleAlert size={14} strokeWidth={2} aria-hidden />
          {error}
        </p>
      )}
      <div
        className={cn(
          'rounded-3xl bg-surface-raised p-1.5 shadow-sm ring-1 ring-line ring-inset',
          'transition-shadow duration-150 hover:ring-line-strong',
          'has-[textarea:focus]:shadow-[0_0_0_4px_var(--accent-soft)] has-[textarea:focus]:ring-[1.5px] has-[textarea:focus]:ring-focus-ring',
          'forced-colors:has-[textarea:focus]:outline-2 forced-colors:has-[textarea:focus]:outline-[Highlight]',
        )}
      >
        {image && (
          <div className="px-2 pt-1.5 pb-1">
            <span className="relative inline-block">
              <img src={image.url} alt="" className="size-20 rounded-xl object-cover ring-1 ring-line" />
              <button
                type="button"
                onClick={() => setImage(null)}
                aria-label={t.composer.removeImage}
                className="absolute -end-2 -top-2 inline-flex size-6 items-center justify-center rounded-full bg-ink text-canvas shadow-sm hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                <X size={14} strokeWidth={2.5} aria-hidden />
              </button>
            </span>
          </div>
        )}

        <div className="flex items-end gap-1">
          <IconButton label={t.attach} onClick={() => fileRef.current?.click()}>
            <ImagePlus size={20} strokeWidth={1.75} />
          </IconButton>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              attach(e.target.files?.[0])
              e.target.value = '' // lets you pick the same file again
            }}
          />

          <textarea
            ref={fieldRef}
            rows={1}
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
              '[unicode-bidi:plaintext]',
              lang === 'ar' ? 'text-message-ar' : 'text-message',
            )}
          />

          <span className="relative">
            <IconButton
              label={t.emoji}
              active={emojiOpen}
              aria-haspopup="dialog"
              aria-expanded={emojiOpen}
              onClick={() => setEmojiOpen((open) => !open)}
            >
              <Smile size={20} strokeWidth={1.75} />
            </IconButton>
            {emojiOpen && (
              <EmojiPicker
                onPick={insertEmoji}
                onClose={() => {
                  setEmojiOpen(false)
                  fieldRef.current?.focus()
                }}
              />
            )}
          </span>

          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            aria-label={t.send}
            title={t.send}
            className={cn(
              'inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-[background-color,transform] duration-150',
              focusRing,
              canSend
                ? 'bg-accent text-on-accent hover:bg-accent-strong active:scale-94 motion-reduce:active:scale-100'
                : 'bg-surface-sunken text-ink-muted',
            )}
          >
            <ArrowRight size={20} strokeWidth={2} className="rtl:-scale-x-100" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  )
}
