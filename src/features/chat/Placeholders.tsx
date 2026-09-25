import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useLocale } from '@/lib/i18n'

/** A spinner and a label, filling the space while something loads. */
export function CenteredLoading({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-1 items-center justify-center gap-2 py-10 text-body text-ink-muted">
      <Spinner />
      {label}
    </div>
  )
}

/** Couldn't load: say so, with a way to try again. */
export function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useLocale()
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <p className="text-body text-ink-muted">{t.loadError}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {t.tryAgain}
      </Button>
    </div>
  )
}
