import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'

/** The three dots bob one after another. */
const DOT_DELAYS_MS = [0, 150, 300]

function Dots({ size }: { size: 'sm' | 'md' }) {
  return (
    <span aria-hidden className="inline-flex items-center gap-0.5">
      {DOT_DELAYS_MS.map((delay) => (
        <span
          key={delay}
          style={{ animationDelay: `${delay}ms` }}
          className={cn('animate-typing rounded-full', size === 'md' ? 'size-1.5 bg-ink-muted' : 'size-1 bg-accent')}
        />
      ))}
    </span>
  )
}

/** Inline form for the conversation list and chat header: accent "typing" + small dots. */
export function TypingInline() {
  const { t } = useLocale()
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold text-accent">
      {t.typing}
      <Dots size="sm" />
    </span>
  )
}

/** Thread form: dots in a received-style bubble, with "Sara is typing…" beside it. */
export function TypingBubble({ name }: { name: string }) {
  const { t } = useLocale()
  return (
    <div className="flex items-center gap-2" role="status">
      <span className="inline-flex h-8 items-center rounded-2xl rounded-es-sm bg-bubble-in px-3 shadow-xs">
        <Dots size="md" />
      </span>
      <span className="text-preview text-ink-muted">{t.isTyping(name)}</span>
    </div>
  )
}
