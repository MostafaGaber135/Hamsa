import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'

interface BadgeProps {
  count: number
  muted?: boolean
  /** An 8px dot with no number, e.g. for "Mark as unread". */
  dot?: boolean
  className?: string
}

/** Unread count. Muted conversations use a quiet badge so they never compete. */
export function Badge({ count, muted, dot, className }: BadgeProps) {
  const { fmt } = useLocale()
  if (dot) {
    return <span aria-hidden className={cn('size-2.5 rounded-full', muted ? 'bg-ink-subtle' : 'bg-accent', className)} />
  }
  if (count <= 0) return null
  const label = count > 99 ? `${fmt.number(99)}+` : fmt.number(count)
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-meta font-bold tabular-nums',
        muted ? 'bg-surface-sunken text-ink-muted' : 'bg-accent text-on-accent',
        className,
      )}
    >
      {label}
    </span>
  )
}
