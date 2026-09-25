import { useCallback, useState, type ReactNode } from 'react'
import { useLocale } from '@/lib/i18n'
import { Button } from './Button'
import { ConfirmContext, type ConfirmOptions } from './confirm'
import { Dialog } from './Dialog'

interface Pending {
  options: ConfirmOptions
  resolve: (confirmed: boolean) => void
}

/** Shows one confirmation at a time; closing it any other way counts as "Cancel". */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useLocale()
  const [pending, setPending] = useState<Pending | null>(null)

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending((current) => {
          current?.resolve(false)
          return { options, resolve }
        })
      }),
    [],
  )

  function finish(confirmed: boolean) {
    pending?.resolve(confirmed)
    setPending(null)
  }

  return (
    <ConfirmContext value={confirm}>
      {children}
      {pending && (
        <Dialog
          title={t.confirm.title}
          closeLabel={t.confirm.cancel}
          onClose={() => finish(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => finish(false)}>
                {t.confirm.cancel}
              </Button>
              <Button variant={pending.options.danger ? 'danger' : 'primary'} onClick={() => finish(true)} autoFocus>
                {pending.options.confirmLabel}
              </Button>
            </>
          }
        >
          <p dir="auto" className="text-body text-ink">
            {pending.options.message}
          </p>
        </Dialog>
      )}
    </ConfirmContext>
  )
}
