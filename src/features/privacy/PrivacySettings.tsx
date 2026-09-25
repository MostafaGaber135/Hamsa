import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useLocale } from '@/lib/i18n'
import type { GroupInvites } from './api'
import { useBlockedUsers, useGroupInvites, useSetBlocked, useSetGroupInvites } from './queries'

/** The profile page's privacy section: who can add you to groups, and who you blocked. */
export function PrivacySettings({ userId }: { userId: string }) {
  return (
    <div className="flex flex-col gap-6">
      <GroupInvitesSetting userId={userId} />
      <BlockedPeople />
    </div>
  )
}

function GroupInvitesSetting({ userId }: { userId: string }) {
  const { t } = useLocale()
  const invites = useGroupInvites(userId)
  const set = useSetGroupInvites(userId)
  const options: { value: GroupInvites; label: string }[] = [
    { value: 'everyone', label: t.privacySettings.everyone },
    { value: 'friends', label: t.privacySettings.friendsOnly },
  ]

  return (
    <fieldset disabled={!invites.data}>
      <legend className="text-body font-semibold text-ink">{t.privacySettings.groupInvites}</legend>
      <div className="mt-2 flex flex-col gap-1">
        {options.map((option) => (
          <label key={option.value} className="flex w-fit cursor-pointer items-center gap-2 py-1 text-body text-ink">
            <input
              type="radio"
              name="group-invites"
              value={option.value}
              checked={invites.data === option.value}
              onChange={() => set.mutate(option.value)}
              className="size-4 accent-accent"
            />
            {option.label}
          </label>
        ))}
      </div>
      {invites.isError && <ErrorText>{t.loadError}</ErrorText>}
      {set.error && <ErrorText>{set.error.message}</ErrorText>}
    </fieldset>
  )
}

function BlockedPeople() {
  const { t } = useLocale()
  const blocked = useBlockedUsers()
  const setBlocked = useSetBlocked()

  let content
  if (blocked.isPending) content = <Spinner />
  else if (blocked.isError) content = <ErrorText>{t.loadError}</ErrorText>
  else if (blocked.data.length === 0) content = <p className="text-body text-ink-muted">{t.privacySettings.noBlocked}</p>
  else
    content = (
      <ul className="flex flex-col gap-1">
        {blocked.data.map((user) => (
          <li key={user.id} className="flex items-center gap-3 py-1">
            <Avatar id={user.id} name={user.name} src={user.avatarUrl} size="md" />
            <span className="min-w-0 flex-1">
              <span dir="auto" className="block truncate text-body font-semibold text-ink">{user.name}</span>
              <span dir="ltr" className="block truncate text-caption text-ink-muted rtl:text-right">@{user.username}</span>
            </span>
            <Button
              variant="secondary"
              size="sm"
              aria-label={t.block.unblock(user.name)}
              disabled={setBlocked.isPending && setBlocked.variables?.userId === user.id}
              onClick={() => setBlocked.mutate({ userId: user.id, blocked: false })}
            >
              {t.privacySettings.unblock}
            </Button>
          </li>
        ))}
      </ul>
    )

  return (
    <section>
      <h4 className="mb-2 text-body font-semibold text-ink">{t.privacySettings.blocked}</h4>
      {content}
      {setBlocked.error && <ErrorText>{setBlocked.error.message}</ErrorText>}
    </section>
  )
}

function ErrorText({ children }: { children: string }) {
  return (
    <p role="alert" dir="auto" className="mt-2 text-caption text-danger">
      {children}
    </p>
  )
}
