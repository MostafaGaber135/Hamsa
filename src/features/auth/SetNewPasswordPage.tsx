import { CircleAlert, KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { useLocale } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'

/** Shown after someone opens the password-reset link from the email (instead of typing the code). */
export function SetNewPasswordPage({ onDone }: { onDone: () => void }) {
  const { t, lang } = useLocale()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (password !== confirm) return setError(t.authFlow.mismatch)
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(error.message)
    onDone()
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-3xl bg-surface p-6 shadow-md sm:p-8">
        <KeyRound size={40} strokeWidth={1.5} className="text-accent" aria-hidden />
        <div>
          <h1 className={lang === 'ar' ? 'text-title-ar text-ink' : 'text-title-2 text-ink'}>{t.authFlow.setNewTitle}</h1>
          <p className="mt-1 text-body text-ink-muted">{t.authFlow.setNewBody}</p>
        </div>
        <TextField
          label={t.authFlow.newPassword}
          hint={t.auth.passwordHint}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          dir="ltr"
          required
          autoFocus
        />
        <TextField
          label={t.authFlow.confirmPassword}
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          dir="ltr"
          required
        />
        {error && (
          <p role="alert" className="flex gap-2 rounded-xl bg-danger-soft px-3 py-2 text-body text-danger">
            <CircleAlert size={18} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden />
            <span dir="auto">{error}</span>
          </p>
        )}
        <Button type="submit" size="lg" disabled={busy} className="w-full">
          {t.authFlow.savePassword}
        </Button>
      </form>
    </div>
  )
}
