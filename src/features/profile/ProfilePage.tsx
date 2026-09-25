import { ArrowLeft, Bell, BellOff, Camera, Check, CircleAlert, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Button, IconButton } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { TextField } from '@/components/ui/TextField'
import { PrivacySettings } from '@/features/privacy/PrivacySettings'
import { useLocale } from '@/lib/i18n'
import { PushServiceError, disablePush, enablePush, getPushStatus, type PushStatus } from '@/lib/push'
import { useDebounced } from '@/lib/useDebounced'
import type { User } from '@/types/chat'
import { USERNAME_PATTERN, UsernameTakenError, validateImage } from './api'
import { useAvatar, useChangePassword, useDeleteAccount, useUpdateProfile, useUsernameAvailability } from './queries'

/** Checks the username once you've stopped typing for this long. */
const USERNAME_CHECK_DELAY_MS = 400
/** How long "Saved" shows after saving. */
const SAVED_NOTE_MS = 3000

interface ProfilePageProps {
  user: User
  email?: string
  /** False for people who only ever signed in with Google. */
  hasPassword: boolean
  onBack: () => void
}

export function ProfilePage({ user, email, hasPassword, onBack }: ProfilePageProps) {
  const { t, lang } = useLocale()
  // Lives here, not in the form: the form remounts after a save (see key below).
  const [detailsSaved, flashDetailsSaved] = useFlash()

  return (
    <>
      <header className="flex h-18 shrink-0 items-center gap-3 border-b border-line px-3 md:px-5">
        <IconButton label={t.back} onClick={onBack} className="md:hidden">
          <ArrowLeft size={20} strokeWidth={1.75} className="rtl:-scale-x-100" />
        </IconButton>
        <h2 className={lang === 'ar' ? 'text-title-ar text-ink' : 'text-title-3 text-ink'}>{t.profile.title}</h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5 md:px-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <PhotoCard user={user} />
          {/* key: after a save, the form restarts from the saved values. */}
          <DetailsCard
            key={`${user.name}|${user.username}`}
            user={user}
            email={email}
            saved={detailsSaved}
            onSaved={flashDetailsSaved}
          />
          <NotificationsCard />
          <Card title={t.privacySettings.title} description={t.privacySettings.description}>
            <PrivacySettings userId={user.id} />
          </Card>
          <PasswordCard hasPassword={hasPassword} />
          <DeleteAccountCard username={user.username ?? ''} />
        </div>
      </div>
    </>
  )
}

function PhotoCard({ user }: { user: User }) {
  const { t } = useLocale()
  const inputRef = useRef<HTMLInputElement>(null)
  const { upload, remove } = useAvatar(user.id)
  const [localError, setLocalError] = useState<string | null>(null)
  const busy = upload.isPending || remove.isPending
  const error = localError ?? upload.error?.message ?? remove.error?.message

  function handleFile(file: File | undefined) {
    if (!file) return
    const problem = validateImage(file)
    setLocalError(
      problem === 'tooBig' ? t.profile.photoTooBig : problem === 'wrongType' ? t.profile.photoWrongType : null,
    )
    if (!problem) upload.mutate({ file, previousUrl: user.avatarUrl })
  }

  return (
    <Card title={t.profile.photo}>
      <div className="flex flex-wrap items-center gap-5">
        <span className="relative">
          <Avatar id={user.id} name={user.name} src={user.avatarUrl} size="xl" />
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-scrim">
              <Spinner className="border-white border-t-transparent" />
            </span>
          )}
        </span>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              icon={<Camera size={16} strokeWidth={1.75} aria-hidden />}
            >
              {t.profile.changePhoto}
            </Button>
            {user.avatarUrl && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => remove.mutate(user.avatarUrl)}
                icon={<Trash2 size={16} strokeWidth={1.75} aria-hidden />}
              >
                {t.profile.removePhoto}
              </Button>
            )}
          </div>
          <p className="text-caption text-ink-muted">{t.profile.photoHint}</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            handleFile(e.target.files?.[0])
            e.target.value = '' // lets you pick the same file again
          }}
        />
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </Card>
  )
}

interface DetailsCardProps {
  user: User
  email?: string
  saved: boolean
  onSaved: () => void
}

function DetailsCard({ user, email, saved, onSaved }: DetailsCardProps) {
  const { t } = useLocale()
  const update = useUpdateProfile(user.id)
  const [fullName, setFullName] = useState(user.name)
  const [username, setUsername] = useState(user.username ?? '')

  const debouncedUsername = useDebounced(username, USERNAME_CHECK_DELAY_MS)
  const availability = useUsernameAvailability(debouncedUsername, user.username ?? '')

  const changed = fullName.trim() !== user.name || username !== user.username
  const validShape = USERNAME_PATTERN.test(username)
  const takenOnServer = update.error instanceof UsernameTakenError
  const taken = (availability.data === false && debouncedUsername === username) || takenOnServer
  const canSave = changed && fullName.trim().length > 0 && validShape && !taken && !update.isPending

  let usernameHint = t.profile.usernameHint
  if (username !== user.username && validShape) {
    if (availability.isFetching || debouncedUsername !== username) usernameHint = t.profile.usernameChecking
    else if (availability.data) usernameHint = t.profile.usernameAvailable
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (canSave) update.mutate({ fullName, username }, { onSuccess: onSaved })
  }

  return (
    <Card title={t.profile.details}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextField
          label={t.profile.fullName}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          maxLength={60}
          autoComplete="name"
          required
        />
        <TextField
          label={t.profile.username}
          value={username}
          // Usernames are lowercase; fix the case as you type instead of rejecting it.
          onChange={(e) => {
            setUsername(e.target.value.toLowerCase().replace(/\s/g, '_'))
            update.reset()
          }}
          maxLength={24}
          dir="ltr"
          autoComplete="username"
          spellCheck={false}
          hint={usernameHint}
          error={taken ? t.profile.usernameTaken : username && !validShape ? t.profile.usernameHint : undefined}
        />
        <TextField label={t.profile.email} value={email ?? ''} readOnly dir="ltr" hint={t.profile.emailHint} />

        {update.error && !takenOnServer && <ErrorNote>{update.error.message}</ErrorNote>}

        <div className="flex items-center justify-end gap-3">
          {saved && <SavedNote>{t.profile.saved}</SavedNote>}
          <Button type="submit" disabled={!canSave}>
            {t.profile.save}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function PasswordCard({ hasPassword }: { hasPassword: boolean }) {
  const { t } = useLocale()
  const change = useChangePassword()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const [saved, flashSaved] = useFlash()

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (password !== confirm) return setMismatch(true)
    change.mutate(password, {
      onSuccess: () => {
        setPassword('')
        setConfirm('')
        flashSaved()
      },
    })
  }

  return (
    <Card title={t.profile.password} description={hasPassword ? undefined : t.profile.setPasswordHint}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextField
          label={t.profile.newPassword}
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setMismatch(false)
          }}
          autoComplete="new-password"
          minLength={8}
          dir="ltr"
          hint={t.auth.passwordHint}
          required
        />
        <TextField
          label={t.profile.confirmPassword}
          type="password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value)
            setMismatch(false)
          }}
          autoComplete="new-password"
          minLength={8}
          dir="ltr"
          error={mismatch ? t.profile.passwordMismatch : undefined}
          required
        />

        {change.error && <ErrorNote>{change.error.message}</ErrorNote>}

        <div className="flex items-center justify-end gap-3">
          {saved && <SavedNote>{t.profile.passwordUpdated}</SavedNote>}
          <Button type="submit" variant="secondary" disabled={change.isPending || !password || !confirm}>
            {hasPassword ? t.profile.changePassword : t.profile.setPassword}
          </Button>
        </div>
      </form>
    </Card>
  )
}

/** Typing your username is the confirmation: this can't be undone. */
function DeleteAccountCard({ username }: { username: string }) {
  const { t } = useLocale()
  const remove = useDeleteAccount()
  const [typed, setTyped] = useState('')
  const confirmed = username !== '' && typed.trim().toLowerCase() === username

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (confirmed) remove.mutate()
  }

  return (
    <Card title={t.deleteAccount.title} description={t.deleteAccount.description}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextField
          label={t.deleteAccount.confirmLabel(username)}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
        />
        {remove.error && <ErrorNote>{t.deleteAccount.failed}</ErrorNote>}
        <div className="flex justify-end">
          <Button
            type="submit"
            variant="danger"
            disabled={!confirmed || remove.isPending}
            icon={remove.isPending ? <Spinner /> : <Trash2 size={16} strokeWidth={1.75} aria-hidden />}
          >
            {t.deleteAccount.button}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function NotificationsCard() {
  const { t } = useLocale()
  const [status, setStatus] = useState<PushStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getPushStatus().then(setStatus)
  }, [])

  async function toggle() {
    setBusy(true)
    setError(null)
    try {
      if (status === 'on') {
        await disablePush()
        setStatus('off')
      } else {
        setStatus(await enablePush())
      }
    } catch (e) {
      setError(e instanceof PushServiceError ? t.push.serviceError : e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const note: Partial<Record<PushStatus, string>> = {
    on: t.push.on,
    blocked: t.push.blocked,
    unsupported: t.push.unsupported,
    'needs-install': t.push.needsInstall,
    'not-configured': t.push.notConfigured,
  }
  const canToggle = status === 'on' || status === 'off'

  return (
    <Card title={t.push.title} description={t.push.description}>
      {status === null ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-3">
          {note[status] && (
            <p className={status === 'on' ? 'text-body text-presence' : 'text-body text-ink-muted'}>{note[status]}</p>
          )}
          {canToggle && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant={status === 'on' ? 'secondary' : 'primary'}
                disabled={busy}
                onClick={toggle}
                icon={
                  status === 'on' ? (
                    <BellOff size={16} strokeWidth={1.75} aria-hidden />
                  ) : (
                    <Bell size={16} strokeWidth={1.75} aria-hidden />
                  )
                }
              >
                {status === 'on' ? t.push.disable : t.push.enable}
              </Button>
              <span className="text-caption text-ink-subtle">{t.push.muted}</span>
            </div>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
      )}
    </Card>
  )
}

/** A "Saved" note that shows for a few seconds each time you call flash(). */
function useFlash(ms = SAVED_NOTE_MS) {
  const [visible, setVisible] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const flash = useCallback(() => {
    setVisible(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setVisible(false), ms)
  }, [ms])
  return [visible, flash] as const
}

function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl bg-surface-raised p-5 shadow-xs ring-1 ring-line sm:p-6">
      <h3 className="text-title-3 text-ink">{title}</h3>
      {description && <p className="mt-1 text-body text-ink-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-3 flex gap-2 rounded-xl bg-danger-soft px-3 py-2 text-body text-danger">
      <CircleAlert size={18} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden />
      <span dir="auto">{children}</span>
    </p>
  )
}

function SavedNote({ children }: { children: ReactNode }) {
  return (
    <span role="status" className="inline-flex items-center gap-1 text-caption font-semibold text-presence">
      <Check size={14} strokeWidth={2.5} aria-hidden />
      {children}
    </span>
  )
}
