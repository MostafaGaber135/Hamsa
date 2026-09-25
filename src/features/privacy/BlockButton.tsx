import { Ban } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import type { User } from '@/types/chat'
import { useBlockedUsers, useSetBlocked } from './queries'

/** "Block Sara" / "Unblock Sara", for a one-to-one chat's info panel. */
export function BlockButton({ user }: { user: User }) {
  const { t } = useLocale()
  const blocked = useBlockedUsers()
  const setBlocked = useSetBlocked()
  const isBlocked = blocked.data?.some((u) => u.id === user.id) ?? false

  function toggle() {
    if (isBlocked) setBlocked.mutate({ userId: user.id, blocked: false })
    else if (window.confirm(t.block.confirm(user.name))) setBlocked.mutate({ userId: user.id, blocked: true })
  }

  return (
    <>
      <Button
        variant="ghost"
        className={cn('w-full justify-start', !isBlocked && 'text-danger hover:text-danger')}
        disabled={blocked.isPending || setBlocked.isPending}
        onClick={toggle}
        icon={<Ban size={18} strokeWidth={1.75} aria-hidden />}
      >
        {isBlocked ? t.block.unblock(user.name) : t.block.block(user.name)}
      </Button>
      {setBlocked.error && (
        <p role="alert" dir="auto" className="mt-2 text-caption text-danger">
          {setBlocked.error.message}
        </p>
      )}
    </>
  )
}
