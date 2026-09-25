import { SquarePen } from 'lucide-react'
import { BrandMark } from '@/components/ui/BrandMark'
import { Button } from '@/components/ui/Button'
import { useLocale } from '@/lib/i18n'

/** The main pane when no chat is open: a welcome and a "New chat" button. */
export function EmptyState({ onNewChat }: { onNewChat: () => void }) {
  const { t } = useLocale()
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <BrandMark size={56} />
      <h2 className="mt-2 text-title-3 text-ink">{t.emptyTitle}</h2>
      <p className="max-w-xs text-body text-ink-muted">{t.emptyBody}</p>
      <Button
        variant="secondary"
        className="mt-2"
        onClick={onNewChat}
        icon={<SquarePen size={16} strokeWidth={1.75} aria-hidden />}
      >
        {t.newChat}
      </Button>
    </div>
  )
}
