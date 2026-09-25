import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { IconButton } from './Button'

interface DialogProps {
  title: string
  /** Label for the close button. */
  closeLabel: string
  onClose: () => void
  children: ReactNode
  /** Buttons at the bottom, e.g. Cancel and Send. */
  footer?: ReactNode
}

/**
 * A modal dialog on the native <dialog> element: focus is trapped inside,
 * Esc closes it, and the page behind can't be clicked.
 */
export function Dialog({ title, closeLabel, onClose, children, footer }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      // A click on the backdrop (the dialog element itself, outside its box) closes it.
      onClick={(e) => {
        if (e.target === ref.current) ref.current.close()
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-3xl bg-surface p-0 text-ink shadow-lg backdrop:bg-scrim"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 id={titleId} dir="auto" className="text-title-3">
          {title}
        </h2>
        <IconButton label={closeLabel} size="sm" onClick={() => ref.current?.close()}>
          <X size={18} strokeWidth={1.75} />
        </IconButton>
      </div>
      <div className="max-h-[60vh] overflow-y-auto px-5 py-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
    </dialog>
  )
}
