import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MenuAnchor } from '@/components/ui/Menu'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const

const EDGE = 8
const GAP = 6

interface ReactionBarProps {
  anchor: MenuAnchor
  /** Your current reaction, shown selected (choosing it again takes it back). */
  current?: string
  onPick: (emoji: string | null) => void
  onClose: () => void
}

/** A row of quick reactions, above the message. ←/→ move, Enter picks, Esc closes. */
export function ReactionBar({ anchor, current, onPick, onClose }: ReactionBarProps) {
  const { t } = useLocale()
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const bar = ref.current
    if (!bar) return
    const { width, height } = bar.getBoundingClientRect()
    const r = 'element' in anchor ? anchor.element.getBoundingClientRect() : { top: anchor.y, left: anchor.x, width: 0 }
    const top = r.top - GAP - height < EDGE ? r.top + GAP : r.top - GAP - height
    const left = r.left + r.width / 2 - width / 2
    setPosition({ top, left: Math.min(Math.max(EDGE, left), window.innerWidth - width - EDGE) })
  }, [anchor])

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={t.msg.react}
      onKeyDown={(e) => {
        const buttons = [...(ref.current?.querySelectorAll('button') ?? [])]
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
        if (e.key === 'Escape') onClose()
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault()
          const step = (e.key === 'ArrowRight') === (document.dir !== 'rtl') ? 1 : -1
          buttons[(i + step + buttons.length) % buttons.length]?.focus()
        }
      }}
      style={position ?? { visibility: 'hidden' }}
      className="fixed z-50 flex gap-0.5 rounded-full bg-surface-raised p-1 shadow-lg ring-1 ring-line"
    >
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          role="menuitemradio"
          aria-checked={current === emoji}
          onClick={() => {
            onPick(current === emoji ? null : emoji)
            onClose()
          }}
          className={cn(
            'inline-flex size-9 items-center justify-center rounded-full text-[22px] transition-transform hover:scale-115 focus-visible:outline-2 focus-visible:outline-focus-ring motion-reduce:hover:scale-100',
            current === emoji && 'bg-accent-soft',
          )}
        >
          {emoji}
        </button>
      ))}
    </div>,
    document.body,
  )
}
