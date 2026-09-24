import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'

export interface MenuItem {
  id: string
  label: string
  icon: ReactNode
  danger?: boolean
  onSelect: () => void
}

/** Where the menu opens: under an element (the "more" button), or at the pointer (right-click). */
export type MenuAnchor = { element: HTMLElement } | { x: number; y: number }

interface MenuProps {
  anchor: MenuAnchor
  items: MenuItem[]
  label: string
  onClose: () => void
  /** Runs after Esc closes the menu, e.g. to put focus back on the row. */
  onEscape?: () => void
}

const GAP = 4
const EDGE = 8

/**
 * A small popup menu, rendered into <body> so a scrolling list can't clip it.
 * ↑/↓/Home/End move, Enter selects, Esc or clicking outside closes.
 */
export function Menu({ anchor, items, label, onClose, onEscape }: MenuProps) {
  const { dir } = useLocale()
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  // Measure after render, then place it: below the anchor (or above if there's no room),
  // aligned to the anchor's end side, and kept inside the window.
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    let top: number
    let left: number
    if ('element' in anchor) {
      const r = anchor.element.getBoundingClientRect()
      top = r.bottom + GAP + height > window.innerHeight - EDGE ? r.top - GAP - height : r.bottom + GAP
      left = dir === 'rtl' ? r.left : r.right - width
    } else {
      top = anchor.y + height > window.innerHeight - EDGE ? anchor.y - height : anchor.y
      left = dir === 'rtl' ? anchor.x - width : anchor.x
    }
    setPosition({
      top: Math.max(EDGE, top),
      left: Math.min(Math.max(EDGE, left), window.innerWidth - width - EDGE),
    })
  }, [anchor, dir])

  // Keep the latest onClose without re-running the listeners below on every render.
  const onCloseRef = useRef(onClose)
  const anchorRef = useRef(anchor)
  useEffect(() => {
    onCloseRef.current = onClose
    anchorRef.current = anchor
  })

  // Focus the first item once the menu is placed (hidden elements can't take focus).
  const placed = position !== null
  useEffect(() => {
    if (placed) itemRefs.current[0]?.focus()
  }, [placed])

  useEffect(() => {
    const close = () => onCloseRef.current()
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      const a = anchorRef.current
      // Pressing the button that opened the menu lets that button toggle it closed.
      const onAnchor = 'element' in a && a.element.contains(target)
      if (!menuRef.current?.contains(target) && !onAnchor) close()
    }
    // The menu is placed once; if the page moves under it, just close it.
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [])

  function handleKeyDown(e: KeyboardEvent) {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement)
    const focus = (i: number) => itemRefs.current[(i + items.length) % items.length]?.focus()
    switch (e.key) {
      case 'ArrowDown': focus(current + 1); break
      case 'ArrowUp': focus(current - 1); break
      case 'Home': focus(0); break
      case 'End': focus(items.length - 1); break
      case 'Escape':
        onClose()
        onEscape?.()
        break
      case 'Tab':
        onClose()
        return
      default:
        // Enter/Space activate the focused item; keep them from reaching the list below.
        e.stopPropagation()
        return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      dir={dir}
      onKeyDown={handleKeyDown}
      // React passes events from a portal up to the component that opened it.
      // Without this, clicking "Mark as unread" also clicks the conversation row
      // underneath, which opens the chat and marks it read again.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      style={{ top: position?.top ?? 0, left: position?.left ?? 0, visibility: position ? 'visible' : 'hidden' }}
      className="fixed z-50 min-w-52 animate-rise rounded-2xl bg-surface-raised p-1.5 shadow-lg ring-1 ring-line"
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          ref={(el) => {
            itemRefs.current[i] = el
          }}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            onClose()
            item.onSelect()
          }}
          className={cn(
            'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-body font-medium outline-none',
            'hover:bg-surface-hover focus-visible:bg-surface-hover',
            item.danger ? 'text-danger' : 'text-ink',
          )}
        >
          <span className={cn('shrink-0', item.danger ? 'text-danger' : 'text-ink-muted')} aria-hidden>
            {item.icon}
          </span>
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
