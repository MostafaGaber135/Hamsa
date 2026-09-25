import { X } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from '@/components/ui/Button'
import { useLocale } from '@/lib/i18n'

/**
 * Registers the service worker, and when a new version of Hamsa has downloaded,
 * offers to reload into it (instead of switching versions mid-conversation).
 */
export function UpdatePrompt() {
  const { t } = useLocale()
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink py-2.5 ps-4 pe-2 text-canvas shadow-lg"
    >
      <span className="min-w-0 flex-1 text-body">{t.update.ready}</span>
      <Button size="sm" onClick={() => updateServiceWorker(true)}>
        {t.update.reload}
      </Button>
      <button
        type="button"
        onClick={() => setNeedRefresh(false)}
        aria-label={t.update.later}
        className="inline-flex size-8 items-center justify-center rounded-full hover:bg-canvas/15 focus-visible:outline-2 focus-visible:outline-canvas"
      >
        <X size={16} strokeWidth={2} aria-hidden />
      </button>
    </div>
  )
}
