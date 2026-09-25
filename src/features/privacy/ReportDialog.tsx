import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { reportUser, type ReportReason } from '@/features/messages/api'
import { useLocale } from '@/lib/i18n'
import type { User } from '@/types/chat'

interface ReportDialogProps {
  user: User
  /** Report this message (its text is kept for review), or the person in general. */
  messageId?: string
  onClose: () => void
}

const REASONS: ReportReason[] = ['spam', 'harassment', 'inappropriate', 'other']

/** Tell whoever runs Hamsa about a person or a message. Reports can't be read from the app. */
export function ReportDialog({ user, messageId, onClose }: ReportDialogProps) {
  const { t } = useLocale()
  const [reason, setReason] = useState<ReportReason>('spam')
  const [details, setDetails] = useState('')
  const send = useMutation({ mutationFn: () => reportUser(user.id, messageId ?? null, reason, details.trim()) })

  return (
    <Dialog
      title={t.report.title(user.name)}
      closeLabel={t.report.close}
      onClose={onClose}
      footer={
        send.isSuccess ? (
          <Button onClick={onClose}>{t.report.close}</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t.report.cancel}
            </Button>
            <Button variant="danger" disabled={send.isPending} onClick={() => send.mutate()}>
              {t.report.send}
            </Button>
          </>
        )
      }
    >
      {send.isSuccess ? (
        <p role="status" className="text-body text-ink">
          {t.report.sent}
        </p>
      ) : (
        <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4">
          <fieldset>
            <legend className="text-body font-semibold">{t.report.reason}</legend>
            <div className="mt-2 flex flex-col gap-1">
              {REASONS.map((value) => (
                <label key={value} className="flex w-fit cursor-pointer items-center gap-2 py-1 text-body">
                  <input
                    type="radio"
                    name="report-reason"
                    value={value}
                    checked={reason === value}
                    onChange={() => setReason(value)}
                    className="size-4 accent-accent"
                  />
                  {t.report.reasons[value]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1.5 text-body font-semibold">
            {t.report.details}
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={500}
              rows={3}
              dir="auto"
              className="resize-none rounded-xl bg-surface-sunken px-3 py-2 font-normal ring-1 ring-line outline-none focus:ring-2 focus:ring-focus-ring"
            />
          </label>
          {send.error && (
            <p role="alert" dir="auto" className="text-caption text-danger">
              {send.error.message}
            </p>
          )}
        </form>
      )}
    </Dialog>
  )
}
