import { useEffect, useRef, type KeyboardEvent } from 'react'
import { useLocale } from '@/lib/i18n'

const EMOJIS = [
  '😀', '😂', '🥹', '😊', '😍', '😘', '😎', '🤔',
  '😅', '😭', '😡', '😴', '🤯', '🥳', '😬', '🙈',
  '👍', '👎', '👏', '🙏', '💪', '🙌', '👋', '🤝',
  '❤️', '💚', '💙', '🔥', '✨', '🎉', '💯', '⭐',
  '✅', '❌', '👀', '☕', '🍕', '🎂', '🎁', '📌',
]
const COLUMNS = 8

interface EmojiPickerProps {
  onPick: (emoji: string) => void
  onClose: () => void
}

/** A small grid of common emoji. Arrow keys move, Enter picks, Esc closes. */
export function EmojiPicker({ onPick, onClose }: EmojiPickerProps) {
  const { t } = useLocale()
  const ref = useRef<HTMLDivElement>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  // Latest onClose without re-adding the listener on every render.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    buttons.current[0]?.focus()
    function onPointerDown(e: PointerEvent) {
      // The wrapper also holds the emoji button, which toggles the picker itself.
      if (!ref.current?.parentElement?.contains(e.target as Node)) onCloseRef.current()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [])

  function handleKeyDown(e: KeyboardEvent) {
    const i = buttons.current.findIndex((b) => b === document.activeElement)
    const rtl = document.documentElement.dir === 'rtl'
    const move: Record<string, number> = {
      ArrowRight: rtl ? -1 : 1,
      ArrowLeft: rtl ? 1 : -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    }
    if (e.key in move) {
      e.preventDefault()
      buttons.current[Math.min(EMOJIS.length - 1, Math.max(0, i + move[e.key]))]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t.composer.emojiPicker}
      onKeyDown={handleKeyDown}
      className="absolute end-0 bottom-full z-20 mb-2 grid w-max animate-rise grid-cols-8 gap-0.5 rounded-2xl bg-surface-raised p-2 shadow-lg ring-1 ring-line"
    >
      {EMOJIS.map((emoji, i) => (
        <button
          key={emoji}
          ref={(el) => {
            buttons.current[i] = el
          }}
          type="button"
          aria-label={t.composer.insert(emoji)}
          onClick={() => onPick(emoji)}
          className="inline-flex size-9 items-center justify-center rounded-xl text-[20px] outline-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {emoji}
        </button>
      ))}
    </div>
  )
}
