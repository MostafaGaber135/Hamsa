import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, CircleAlert, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Button, IconButton } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { TextField } from '@/components/ui/TextField'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import { useDebounced } from '@/lib/useDebounced'
import type { User } from '@/types/chat'
import { createGroup, openDirectConversation } from './api'
import { conversationKeys, useProfileSearch } from './queries'

interface NewChatDialogProps {
  open: boolean
  currentUserId: string
  onClose: () => void
  onCreated: (conversationId: string) => void
}

/**
 * Pick one person for a 1:1 chat, or several (plus a name) for a group.
 * Uses the native <dialog>: focus is trapped, Esc closes, and the page behind is inert.
 */
export function NewChatDialog({ open, currentUserId, onClose, onCreated }: NewChatDialogProps) {
  const { t, lang } = useLocale()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<User[]>([])
  const [groupName, setGroupName] = useState('')
  const debounced = useDebounced(query)
  const search = useProfileSearch(debounced, currentUserId)
  const isGroup = selected.length > 1

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const create = useMutation({
    mutationFn: () =>
      isGroup
        ? createGroup(groupName, selected.map((u) => u.id))
        : openDirectConversation(selected[0].id),
    onSuccess: async (conversationId) => {
      await qc.invalidateQueries({ queryKey: conversationKeys.all })
      onCreated(conversationId)
      reset()
    },
  })

  function reset() {
    setQuery('')
    setSelected([])
    setGroupName('')
    create.reset()
  }

  function toggle(user: User) {
    setSelected((list) => (list.some((u) => u.id === user.id) ? list.filter((u) => u.id !== user.id) : [...list, user]))
  }

  const canSubmit = selected.length === 1 || (isGroup && groupName.trim().length > 0)

  return (
    <dialog
      ref={dialogRef}
      onClose={() => {
        reset()
        onClose()
      }}
      aria-labelledby="new-chat-title"
      className={cn(
        'm-auto w-[calc(100%-2rem)] max-w-md rounded-3xl bg-surface-raised p-0 text-ink shadow-lg',
        'backdrop:bg-scrim',
      )}
    >
      <div className="flex max-h-[min(640px,85dvh)] flex-col">
        <header className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 id="new-chat-title" className={lang === 'ar' ? 'text-title-ar text-ink' : 'text-title-3 text-ink'}>
            {t.newChatDialog.title}
          </h2>
          <IconButton label={t.newChatDialog.cancel} size="sm" onClick={() => dialogRef.current?.close()}>
            <X size={18} strokeWidth={1.75} />
          </IconButton>
        </header>

        <div className="px-5">
          <label className="flex h-10 items-center gap-2 rounded-xl bg-surface-sunken px-3 ring-inset has-[input:focus]:shadow-[0_0_0_4px_var(--accent-soft)] has-[input:focus]:ring-[1.5px] has-[input:focus]:ring-focus-ring">
            <Search size={16} strokeWidth={1.75} className="shrink-0 text-ink-muted" aria-hidden />
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

          {selected.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t.newChatDialog.title}>
              {selected.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => toggle(u)}
                    aria-label={t.newChatDialog.remove(u.name)}
                    className="inline-flex h-7 items-center gap-1.5 rounded-full bg-accent-soft ps-1 pe-2 text-caption font-semibold text-ink hover:bg-surface-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    <Avatar id={u.id} name={u.name} src={u.avatarUrl} size="xs" />
                    <bdi>{u.name}</bdi>
                    <X size={12} strokeWidth={2} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-3 min-h-40 flex-1 overflow-y-auto px-3">
          {!debounced.trim() ? (
            <p className="px-2 py-6 text-center text-body text-ink-muted">{t.newChatDialog.typeToSearch}</p>
          ) : search.data?.length === 0 ? (
            <p className="px-2 py-6 text-center text-body text-ink-muted">{t.newChatDialog.noPeople}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {search.data?.map((user) => {
                const isSelected = selected.some((u) => u.id === user.id)
                return (
                  <li key={user.id}>
                    <button
                      type="button"
                      onClick={() => toggle(user)}
                      aria-pressed={isSelected}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-start transition-colors duration-150',
                        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
                        isSelected ? 'bg-surface-selected' : 'hover:bg-surface-hover',
                      )}
                    >
                      <Avatar id={user.id} name={user.name} src={user.avatarUrl} />
                      <span className="min-w-0 flex-1">
                        <span dir="auto" className="block truncate text-name text-ink">{user.name}</span>
                        <span dir="ltr" className="block truncate text-caption text-ink-muted rtl:text-right">@{user.username}</span>
                      </span>
                      <span
                        aria-hidden
                        className={cn(
                          'inline-flex size-5 items-center justify-center rounded-full ring-1 ring-inset',
                          isSelected ? 'bg-accent text-on-accent ring-accent' : 'ring-line-strong',
                        )}
                      >
                        {isSelected && <Check size={12} strokeWidth={3} />}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <footer className="flex flex-col gap-3 border-t border-line px-5 py-4">
          {isGroup && (
            <TextField
              label={t.newChatDialog.groupName}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              maxLength={60}
              required
            />
          )}
          {create.error && (
            <p role="alert" className="flex gap-2 rounded-xl bg-danger-soft px-3 py-2 text-body text-danger">
              <CircleAlert size={18} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden />
              <span dir="auto">{create.error.message}</span>
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => dialogRef.current?.close()}>
              {t.newChatDialog.cancel}
            </Button>
            <Button disabled={!canSubmit || create.isPending} onClick={() => create.mutate()}>
              {isGroup ? t.newChatDialog.createGroup : t.newChatDialog.startChat}
            </Button>
          </div>
        </footer>
      </div>
    </dialog>
  )
}
