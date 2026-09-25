import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { focusRing } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import { STICKERS, stickerUrl } from './stickers'

const EMOJIS = [
  '😀',
  '😂',
  '🥹',
  '😊',
  '😍',
  '😘',
  '😎',
  '🤔',
  '😅',
  '😭',
  '😡',
  '😴',
  '🤯',
  '🥳',
  '😬',
  '🙈',
  '👍',
  '👎',
  '👏',
  '🙏',
  '💪',
  '🙌',
  '👋',
  '🤝',
  '❤️',
  '💚',
  '💙',
  '🔥',
  '✨',
  '🎉',
  '💯',
  '⭐',
  '✅',
  '❌',
  '👀',
  '☕',
  '🍕',
  '🎂',
  '🎁',
  '📌',
]

type Tab = 'emoji' | 'stickers'

interface ExpressionPickerProps {
  onEmoji: (emoji: string) => void
  onSticker: (id: string) => void
  onClose: () => void
}

/**
 * Emoji and stickers. It stays open while you pick several emoji; it closes when you
 * press Esc, click outside it, press the emoji button again, or send a sticker.
 */
export function ExpressionPicker({ onEmoji, onSticker, onClose }: ExpressionPickerProps) {
  const { t, lang } = useLocale()
  const [tab, setTab] = useState<Tab>('emoji')
  const ref = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  // Latest onClose without re-adding the listener on every render.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      // The wrapper also holds the emoji button, which toggles the picker itself.
      if (!ref.current?.parentElement?.contains(e.target as Node)) onCloseRef.current()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [])

  const columns = tab === 'emoji' ? 8 : 4

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    const buttons = [...(gridRef.current?.querySelectorAll('button') ?? [])]
    const i = buttons.findIndex((b) => b === document.activeElement)
    if (i < 0) return
    const rtl = document.documentElement.dir === 'rtl'
    const move: Record<string, number> = {
      ArrowRight: rtl ? -1 : 1,
      ArrowLeft: rtl ? 1 : -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    }
    if (e.key in move) {
      e.preventDefault()
      buttons[Math.min(buttons.length - 1, Math.max(0, i + move[e.key]))]?.focus()
    }
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t.composer.emojiPicker}
      onKeyDown={handleKeyDown}
      className="absolute inset-e-0 bottom-full z-20 mb-2 w-max max-w-[calc(100vw-1.5rem)] animate-rise rounded-2xl bg-surface-raised p-2 shadow-lg ring-1 ring-line"
    >
      <div role="tablist" className="mb-2 flex gap-1">
        {(['emoji', 'stickers'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'h-8 rounded-full px-3 text-caption font-semibold transition-colors duration-150',
              focusRing,
              tab === id ? 'bg-ink text-canvas' : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
            )}
          >
            {id === 'emoji' ? t.rich.emojiTab : t.rich.stickersTab}
          </button>
        ))}
      </div>

      <div
        ref={gridRef}
        role="tabpanel"
        className={cn('grid gap-0.5', tab === 'emoji' ? 'grid-cols-8' : 'grid-cols-4 gap-1')}
      >
        {tab === 'emoji'
          ? EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={t.composer.insert(emoji)}
                onClick={() => onEmoji(emoji)}
                className="inline-flex size-9 items-center justify-center rounded-xl text-[20px] outline-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                {emoji}
              </button>
            ))
          : STICKERS.map((sticker) => (
              <button
                key={sticker.id}
                type="button"
                aria-label={t.rich.sendSticker(lang === 'ar' ? sticker.ar : sticker.en)}
                onClick={() => onSticker(sticker.id)}
                className="inline-flex size-18 items-center justify-center rounded-xl transition-transform duration-150 outline-none hover:scale-105 hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:hover:scale-100"
              >
                <img src={stickerUrl(sticker.id)} alt="" className="size-16" draggable={false} />
              </button>
            ))}
      </div>
    </div>
  )
}
