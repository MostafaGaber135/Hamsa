import { useQuery } from '@tanstack/react-query'
import { Camera, Check, CircleAlert, LogOut, MoreHorizontal, Pencil, Search, Shield, Trash2, UserMinus, UserPlus, X } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Button, IconButton, focusRing } from '@/components/ui/Button'
import { Menu, type MenuAnchor } from '@/components/ui/Menu'
import { Spinner } from '@/components/ui/Spinner'
import { TextField } from '@/components/ui/TextField'
import { fetchSharedItems } from '@/features/messages/api'
import { FileCard, VoicePlayer } from '@/features/messages/MessageContent'
import { BlockButton } from '@/features/privacy/BlockButton'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import { useDebounced } from '@/lib/useDebounced'
import { WALLPAPERS, wallpaperStyle } from '@/lib/wallpapers'
import type { Conversation, ConversationAction, Member, Message, User } from '@/types/chat'
import { useGroupAdmin, useProfileSearch, useSetWallpaper } from './queries'

type Tab = 'media' | 'files' | 'voice' | 'links'

interface ConversationDetailsProps {
  conversation: Conversation
  title: string
  me: User
  onClose: () => void
  onOpenMedia: (items: Message[], startId: string) => void
  onAction: (action: ConversationAction) => void
  className?: string
}

/** The "chat info" panel: shared media and files, wallpaper, and group settings. */
export function ConversationDetails({ conversation, title, me, onClose, onOpenMedia, onAction, className }: ConversationDetailsProps) {
  const { t, fmt } = useLocale()
  const [editing, setEditing] = useState(false)
  const peer = conversation.isGroup ? undefined : conversation.members.find((m) => m.id !== me.id)
  const isAdmin = conversation.isGroup && conversation.myRole === 'admin'

  return (
    <aside
      aria-label={t.details.open}
      className={cn('flex min-h-0 flex-col bg-surface', className)}
    >
      <header className="flex h-18 shrink-0 items-center justify-between border-b border-line px-4">
        <h2 className="text-title-3 text-ink">{t.details.open}</h2>
        <IconButton label={t.details.close} onClick={onClose}>
          <X size={20} strokeWidth={1.75} />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {editing ? (
          <GroupEditor conversation={conversation} onDone={() => setEditing(false)} />
        ) : (
          <section className="flex flex-col items-center gap-2 px-5 pt-6 pb-5 text-center">
            <Avatar
              id={peer?.id ?? conversation.id}
              name={title}
              src={conversation.isGroup ? conversation.avatarUrl : peer?.avatarUrl}
              size="xl"
              group={conversation.isGroup}
              online={peer?.online}
            />
            <h3 dir="auto" className="mt-2 text-title-3 text-ink">{title}</h3>
            <p className="text-body text-ink-muted" dir={peer ? 'ltr' : undefined}>
              {conversation.isGroup ? t.details.members(fmt.number(conversation.members.length)) : `@${peer?.username ?? ''}`}
            </p>
            {isAdmin && (
              <Button variant="secondary" size="sm" className="mt-2" onClick={() => setEditing(true)} icon={<Pencil size={14} strokeWidth={1.75} aria-hidden />}>
                {t.details.editGroup}
              </Button>
            )}
          </section>
        )}

        <SharedItems conversation={conversation} onOpenMedia={onOpenMedia} />
        <WallpaperPicker conversation={conversation} />
        {conversation.isGroup && <Members conversation={conversation} me={me} isAdmin={isAdmin} />}

        {peer && (
          <div className="border-t border-line p-4">
            <BlockButton user={peer} />
          </div>
        )}

        {conversation.isGroup && (
          <div className="border-t border-line p-4">
            <Button
              variant="ghost"
              className="w-full justify-start text-danger hover:text-danger"
              onClick={() => window.confirm(t.menu.leaveConfirm(title)) && onAction('leave')}
              icon={<LogOut size={18} strokeWidth={1.75} className="rtl:-scale-x-100" aria-hidden />}
            >
              {t.menu.leave}
            </Button>
          </div>
        )}
      </div>
    </aside>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-4">
      <h3 className="text-overline text-ink-muted uppercase">{title}</h3>
      {hint && <p className="mt-0.5 text-caption text-ink-subtle">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function SharedItems({ conversation, onOpenMedia }: { conversation: Conversation; onOpenMedia: (items: Message[], id: string) => void }) {
  const { t, fmt } = useLocale()
  const [tab, setTab] = useState<Tab>('media')
  const query = useQuery({
    queryKey: ['shared', conversation.id, tab, conversation.clearedAt],
    queryFn: () => fetchSharedItems(conversation.id, tab, conversation.clearedAt),
    staleTime: 15_000,
  })
  const items = query.data ?? []
  const tabs: { id: Tab; label: string }[] = [
    { id: 'media', label: t.details.media },
    { id: 'files', label: t.details.files },
    { id: 'voice', label: t.details.voice },
    { id: 'links', label: t.details.links },
  ]

  return (
    <section className="border-t border-line px-4 py-4">
      <div role="tablist" className="flex gap-1">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              'h-8 flex-1 rounded-full text-caption font-semibold transition-colors duration-150',
              focusRing,
              tab === item.id ? 'bg-ink text-canvas' : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="mt-3">
        {query.isPending ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-body text-ink-muted">{t.details.nothingHere}</p>
        ) : tab === 'media' ? (
          <div className="grid grid-cols-3 gap-1">
            {items.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onOpenMedia(items, m.id)}
                className="relative aspect-square overflow-hidden rounded-lg bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                {m.kind === 'image' ? (
                  <img src={m.imageUrl} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <video src={m.fileUrl ? `${m.fileUrl}#t=0.1` : undefined} muted preload="metadata" className="size-full object-cover" />
                )}
                <span className="sr-only">{fmt.day(m.createdAt)}</span>
              </button>
            ))}
          </div>
        ) : tab === 'files' ? (
          <ul className="flex flex-col gap-2">
            {items.map((m) => (
              <li key={m.id} className="rounded-xl bg-surface-raised px-2 ring-1 ring-line">
                <FileCard message={m} out={false} onOpen={() => onOpenMedia(items, m.id)} />
              </li>
            ))}
          </ul>
        ) : tab === 'voice' ? (
          <ul className="flex flex-col gap-2">
            {items.map((m) => (
              <li key={m.id} className="rounded-xl bg-surface-raised px-3 py-1 ring-1 ring-line">
                <VoicePlayer message={m} out={false} />
                <p className="pb-1 text-meta text-ink-subtle">{fmt.day(m.createdAt)} · {fmt.time(m.createdAt)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.flatMap((m) =>
              (m.content?.match(/https?:\/\/[^\s]+/g) ?? []).map((url, i) => (
                <li key={`${m.id}-${i}`}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    dir="ltr"
                    className="block truncate rounded-xl bg-surface-raised px-3 py-2 text-body text-accent ring-1 ring-line hover:underline"
                  >
                    {url}
                  </a>
                </li>
              )),
            )}
          </ul>
        )}
      </div>
    </section>
  )
}

function WallpaperPicker({ conversation }: { conversation: Conversation }) {
  const { t } = useLocale()
  const set = useSetWallpaper()
  const current = conversation.wallpaper ?? 'default'
  return (
    <Section title={t.details.wallpaper} hint={t.details.wallpaperHint}>
      <div role="radiogroup" aria-label={t.details.wallpaper} className="grid grid-cols-3 gap-2">
        {WALLPAPERS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={current === id}
            onClick={() => set.mutate({ id: conversation.id, wallpaper: id })}
            style={wallpaperStyle(id) ?? { backgroundColor: 'var(--surface)' }}
            className={cn(
              'relative flex h-16 items-end rounded-xl p-1.5 text-start ring-1 ring-line transition-shadow',
              focusRing,
              current === id && 'ring-2 ring-accent',
            )}
          >
            <span className="rounded-md bg-surface-raised/85 px-1.5 text-meta font-semibold text-ink">{t.wallpapers[id]}</span>
            {current === id && (
              <span className="absolute inset-e-1.5 top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-accent text-on-accent">
                <Check size={12} strokeWidth={3} aria-hidden />
              </span>
            )}
          </button>
        ))}
      </div>
    </Section>
  )
}

function GroupEditor({ conversation, onDone }: { conversation: Conversation; onDone: () => void }) {
  const { t } = useLocale()
  const { update } = useGroupAdmin(conversation.id)
  const [name, setName] = useState(conversation.name ?? '')
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null)
  const [removed, setRemoved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const shown = photo?.url ?? (removed ? undefined : conversation.avatarUrl)

  return (
    <section className="flex flex-col gap-4 px-5 pt-6 pb-5">
      <div className="flex flex-col items-center gap-3">
        <Avatar id={conversation.id} name={name || '?'} src={shown} size="xl" group />
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} icon={<Camera size={14} strokeWidth={1.75} aria-hidden />}>
            {t.details.changePhoto}
          </Button>
          {shown && (
            <Button variant="ghost" size="sm" onClick={() => { setPhoto(null); setRemoved(true) }} icon={<Trash2 size={14} strokeWidth={1.75} aria-hidden />}>
              {t.details.removePhoto}
            </Button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) setPhoto({ file, url: URL.createObjectURL(file) })
            e.target.value = ''
          }}
        />
      </div>
      <TextField label={t.details.groupName} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
      {update.error && (
        <p role="alert" className="flex gap-2 rounded-xl bg-danger-soft px-3 py-2 text-body text-danger">
          <CircleAlert size={18} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden />
          <span dir="auto">{update.error.message}</span>
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>{t.details.cancel}</Button>
        <Button
          disabled={!name.trim() || update.isPending}
          onClick={() =>
            update.mutate(
              { name, photo: photo?.file, avatarUrl: removed ? null : (conversation.avatarUrl ?? null) },
              { onSuccess: onDone },
            )
          }
        >
          {t.details.save}
        </Button>
      </div>
    </section>
  )
}

function Members({ conversation, me, isAdmin }: { conversation: Conversation; me: User; isAdmin: boolean }) {
  const { t, fmt } = useLocale()
  const admin = useGroupAdmin(conversation.id)
  const [adding, setAdding] = useState(false)
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; member: Member } | null>(null)
  const error = admin.add.error ?? admin.remove.error ?? admin.role.error

  const members = [...conversation.members].sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : 0))

  return (
    <Section title={t.details.members(fmt.number(conversation.members.length))}>
      {isAdmin && (
        <Button variant="secondary" size="sm" className="mb-3 w-full" onClick={() => setAdding((v) => !v)} icon={<UserPlus size={16} strokeWidth={1.75} aria-hidden />}>
          {t.details.addPeople}
        </Button>
      )}
      {adding && <AddPeople conversation={conversation} me={me} onAdd={(ids) => admin.add.mutate(ids)} />}
      {error && <p role="alert" className="mb-2 text-caption text-danger" dir="auto">{error.message}</p>}

      <ul className="flex flex-col gap-0.5">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-3 rounded-xl px-1 py-1.5">
            <Avatar id={m.id} name={m.name} src={m.avatarUrl} online={m.online} size="md" />
            <span className="min-w-0 flex-1">
              <span dir="auto" className="block truncate text-body font-semibold text-ink">
                {m.id === me.id ? t.details.you : m.name}
              </span>
              <span dir="ltr" className="block truncate text-caption text-ink-muted rtl:text-right">@{m.username}</span>
            </span>
            {m.role === 'admin' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-meta font-bold text-accent">
                <Shield size={11} strokeWidth={2.5} aria-hidden />
                {t.details.admin}
              </span>
            )}
            {isAdmin && m.id !== me.id && (
              <IconButton
                size="sm"
                label={t.details.memberActions(m.name)}
                onClick={(e) => setMenu({ anchor: { element: e.currentTarget }, member: m })}
              >
                <MoreHorizontal size={16} strokeWidth={1.75} />
              </IconButton>
            )}
          </li>
        ))}
      </ul>

      {menu && (
        <Menu
          anchor={menu.anchor}
          label={t.details.memberActions(menu.member.name)}
          onClose={() => setMenu(null)}
          items={[
            menu.member.role === 'admin'
              ? { id: 'demote', label: t.details.removeAdmin, icon: <Shield size={18} strokeWidth={1.75} />, onSelect: () => admin.role.mutate({ id: menu.member.id, role: 'member' }) }
              : { id: 'promote', label: t.details.makeAdmin, icon: <Shield size={18} strokeWidth={1.75} />, onSelect: () => admin.role.mutate({ id: menu.member.id, role: 'admin' }) },
            {
              id: 'remove',
              label: t.details.removeFromGroup,
              danger: true,
              icon: <UserMinus size={18} strokeWidth={1.75} />,
              onSelect: () => window.confirm(t.details.removeConfirm(menu.member.name)) && admin.remove.mutate(menu.member.id),
            },
          ]}
        />
      )}
    </Section>
  )
}

function AddPeople({ conversation, me, onAdd }: { conversation: Conversation; me: User; onAdd: (ids: string[]) => void }) {
  const { t } = useLocale()
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query)
  const search = useProfileSearch(debounced, me.id)
  const results = (search.data ?? []).filter((u) => !conversation.memberIds.includes(u.id))

  return (
    <div className="mb-3 rounded-xl bg-surface-sunken p-2">
      <label className="flex h-9 items-center gap-2 rounded-lg bg-surface-raised px-2 ring-1 ring-line">
        <Search size={16} strokeWidth={1.75} className="text-ink-muted" aria-hidden />
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.newChatDialog.searchPeople}
          aria-label={t.newChatDialog.searchPeople}
          className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-muted"
        />
        {search.isFetching && <Spinner />}
      </label>
      <ul className="mt-1">
        {results.map((u) => (
          <li key={u.id} className="flex items-center gap-2 px-1 py-1.5">
            <Avatar id={u.id} name={u.name} src={u.avatarUrl} size="sm" />
            <span dir="auto" className="min-w-0 flex-1 truncate text-body text-ink">{u.name}</span>
            <Button size="sm" variant="secondary" onClick={() => onAdd([u.id])}>{t.details.add}</Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
