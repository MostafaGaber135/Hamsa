import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button, IconButton } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useLocale } from '@/lib/i18n'
import { navigate } from '@/lib/router'
import { fetchGroupInvite, joinGroupByInvite } from './api'
import { conversationKeys } from './queries'

/** /join/<code>: what the group is, and a button to join it. */
export function JoinPage({ code, onBack }: { code: string; onBack: () => void }) {
  const { t, lang, fmt } = useLocale()
  const qc = useQueryClient()
  const invite = useQuery({ queryKey: ['group-invite', code], queryFn: () => fetchGroupInvite(code) })
  const join = useMutation({
    mutationFn: () => joinGroupByInvite(code),
    onSuccess: async (conversationId) => {
      await qc.invalidateQueries({ queryKey: conversationKeys.all })
      navigate({ name: 'chat', id: conversationId }, { replace: true })
    },
  })
  const group = invite.data

  return (
    <>
      <header className="flex h-18 shrink-0 items-center gap-3 border-b border-line px-3 md:px-5">
        <IconButton label={t.back} onClick={onBack} className="md:hidden">
          <ArrowLeft size={20} strokeWidth={1.75} className="rtl:-scale-x-100" />
        </IconButton>
        <h2 className={lang === 'ar' ? 'text-title-ar text-ink' : 'text-title-3 text-ink'}>{t.join.title}</h2>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
        {invite.isPending ? (
          <Spinner />
        ) : !group ? (
          <p className="max-w-sm text-center text-body text-ink-muted">{invite.isError ? t.loadError : t.join.invalid}</p>
        ) : (
          <div className="flex max-w-sm flex-col items-center gap-3 text-center">
            <Avatar id={group.conversationId} name={group.name} src={group.avatarUrl} size="xl" group />
            <h3 dir="auto" className="mt-2 text-title-2 text-ink">{group.name}</h3>
            <p className="text-body text-ink-muted">{t.join.members(fmt.number(group.memberCount))}</p>
            {group.description && <p dir="auto" className="text-body whitespace-pre-wrap text-ink">{group.description}</p>}
            {group.alreadyMember ? (
              <Button className="mt-3" onClick={() => navigate({ name: 'chat', id: group.conversationId }, { replace: true })}>
                {t.join.open}
              </Button>
            ) : (
              <Button className="mt-3" disabled={join.isPending} onClick={() => join.mutate()}>
                {t.join.join}
              </Button>
            )}
            {join.error && <p role="alert" dir="auto" className="text-caption text-danger">{join.error.message}</p>}
          </div>
        )}
      </div>
    </>
  )
}
