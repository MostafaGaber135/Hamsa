import { Check, CheckCheck, CircleAlert, Clock } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import type { MessageStatus } from '@/types/chat'

const icons = { sending: Clock, sent: Check, read: CheckCheck, failed: CircleAlert }

// Each state changes shape, not just colour, so it survives colour blindness.
const colors: Record<MessageStatus, string> = {
  sending: '',
  sent: '',
  read: 'text-accent',
  failed: 'text-danger',
}

export function MessageStatusIcon({ status, className }: { status: MessageStatus; className?: string }) {
  const { t } = useLocale()
  const Icon = icons[status]
  return (
    <Icon
      role="img"
      aria-label={t.status[status]}
      size={14}
      strokeWidth={1.75}
      className={cn('shrink-0', colors[status], className)}
    />
  )
}
