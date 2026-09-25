import { BrandMark } from '@/components/ui/BrandMark'
import { Button } from '@/components/ui/Button'
import { useLocale } from '@/lib/i18n'

/** Last-resort screen when the app itself fails to render. */
export function AppCrashed() {
  const { t } = useLocale()
  return (
    <div role="alert" className="flex h-dvh flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
      <BrandMark size={48} />
      <p className="text-title-3 text-ink">{t.appCrashed}</p>
      <Button onClick={() => window.location.reload()}>{t.reload}</Button>
    </div>
  )
}
