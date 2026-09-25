import { CircleAlert, Languages, MailCheck, Moon, Sun } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { BrandMark } from '@/components/ui/BrandMark'
import { Button, IconButton } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import type { Theme } from '@/lib/theme'

type Mode = 'signIn' | 'signUp' | 'verify' | 'forgot' | 'reset'

interface LoginPageProps {
  theme: Theme
  onToggleTheme: () => void
}

const linkButton =
  'rounded-md font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'

export function LoginPage({ theme, onToggleTheme }: LoginPageProps) {
  const { t, lang, setLang } = useLocale()
  const [mode, setMode] = useState<Mode>('signIn')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function go(next: Mode) {
    setMode(next)
    setError(null)
    setInfo(null)
    setCode('')
    setPassword('')
    setConfirm('')
  }

  async function run(action: () => Promise<void>) {
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const fail = (e: { message: string } | null) => {
    if (e) throw new Error(e.message)
  }

  // ---- each screen's submit ----

  const signIn = () =>
    run(async () => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error?.code === 'email_not_confirmed') {
        // Send a fresh code and take them straight to the code screen.
        await supabase.auth.resend({ type: 'signup', email })
        setMode('verify')
        setInfo(t.authFlow.notConfirmed)
        return
      }
      fail(error)
    })

  const signUp = () =>
    run(async () => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        // Read by the handle_new_user trigger to fill in profiles.full_name.
        options: { data: { full_name: fullName.trim() }, emailRedirectTo: window.location.origin },
      })
      fail(error)
      // With "Confirm email" on, there's no session until the code is entered.
      if (!data.session) go('verify')
    })

  const verify = () =>
    run(async () => {
      const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'email' })
      fail(error)
    })

  const resend = () =>
    run(async () => {
      const { error } =
        mode === 'reset'
          ? await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
          : await supabase.auth.resend({ type: 'signup', email })
      fail(error)
      setInfo(t.authFlow.resent)
    })

  const sendResetCode = () =>
    run(async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
      fail(error)
      go('reset')
    })

  const resetPassword = () =>
    run(async () => {
      if (password !== confirm) throw new Error(t.authFlow.mismatch)
      // The code signs you in for this one purpose; then the new password is saved.
      const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'recovery' })
      fail(error)
      const { error: updateError } = await supabase.auth.updateUser({ password })
      fail(updateError)
    })

  function submit(e: FormEvent) {
    e.preventDefault()
    ;({ signIn, signUp, verify, forgot: sendResetCode, reset: resetPassword })[mode]()
  }

  async function signInWithGoogle() {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) setError(error.message)
  }

  // ---- what each screen shows ----

  const titles: Record<Mode, string> = {
    signIn: t.auth.signInTitle,
    signUp: t.auth.signUpTitle,
    verify: t.authFlow.verifyTitle,
    forgot: t.authFlow.forgotTitle,
    reset: t.authFlow.resetTitle,
  }
  const subtitles: Record<Mode, string> = {
    signIn: t.auth.subtitle,
    signUp: t.auth.subtitle,
    verify: t.authFlow.verifyBody(email),
    forgot: t.authFlow.forgotBody,
    reset: t.authFlow.resetBody(email),
  }
  const submitLabels: Record<Mode, string> = {
    signIn: t.auth.signIn,
    signUp: t.auth.signUp,
    verify: t.authFlow.verify,
    forgot: t.authFlow.sendCode,
    reset: t.authFlow.savePassword,
  }

  const codeField = (
    <TextField
      label={t.authFlow.code}
      hint={t.authFlow.codeHint}
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={10}
      dir="ltr"
      required
      autoFocus
      className="text-center font-mono text-title-3 tracking-[0.4em] rtl:text-center"
    />
  )

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <div className="flex justify-end gap-1 p-3">
        <IconButton label={theme === 'dark' ? t.themeToLight : t.themeToDark} onClick={onToggleTheme}>
          {theme === 'dark' ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
        </IconButton>
        <IconButton label={t.switchLanguage} onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
          <Languages size={18} strokeWidth={1.75} />
        </IconButton>
      </div>

      <main className="flex flex-1 items-center justify-center px-4 pb-10">
        <div className="w-full max-w-sm rounded-3xl bg-surface p-6 shadow-md sm:p-8">
          {mode === 'verify' ? (
            <MailCheck size={40} strokeWidth={1.5} className="text-accent" aria-hidden />
          ) : (
            <BrandMark size={40} />
          )}
          <h1 className={lang === 'ar' ? 'mt-5 text-title-ar text-ink' : 'mt-5 text-title-2 text-ink'}>
            {titles[mode]}
          </h1>
          <p className="mt-1 text-body text-ink-muted">{subtitles[mode]}</p>

          {(mode === 'signIn' || mode === 'signUp') && (
            <>
              <Button variant="secondary" size="lg" className="mt-6 w-full" onClick={signInWithGoogle}>
                <GoogleMark />
                {t.auth.google}
              </Button>
              <div className="my-5 flex items-center gap-3 text-caption text-ink-subtle" aria-hidden>
                <span className="h-px flex-1 bg-line" />
                {t.auth.or}
                <span className="h-px flex-1 bg-line" />
              </div>
            </>
          )}

          <form
            onSubmit={submit}
            className={cn('flex flex-col gap-4', mode !== 'signIn' && mode !== 'signUp' && 'mt-6')}
          >
            {mode === 'signUp' && (
              <TextField
                label={t.auth.fullName}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                required
                maxLength={60}
              />
            )}

            {(mode === 'signIn' || mode === 'signUp' || mode === 'forgot') && (
              <TextField
                label={t.auth.email}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                dir="ltr"
                required
              />
            )}

            {(mode === 'verify' || mode === 'reset') && codeField}

            {(mode === 'signIn' || mode === 'signUp' || mode === 'reset') && (
              <div className="flex flex-col gap-1.5">
                <TextField
                  label={mode === 'reset' ? t.authFlow.newPassword : t.auth.password}
                  hint={mode !== 'signIn' ? t.auth.passwordHint : undefined}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                  minLength={mode === 'signIn' ? undefined : 8}
                  dir="ltr"
                  required
                />
                {mode === 'signIn' && (
                  <button
                    type="button"
                    onClick={() => go('forgot')}
                    className={cn(linkButton, 'self-end text-caption')}
                  >
                    {t.authFlow.forgot}
                  </button>
                )}
              </div>
            )}

            {mode === 'reset' && (
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
            )}

            {error && <Note tone="danger">{error}</Note>}
            {info && !error && <Note tone="info">{info}</Note>}

            <Button type="submit" size="lg" disabled={busy} className="mt-1 w-full">
              {submitLabels[mode]}
            </Button>

            {(mode === 'verify' || mode === 'reset') && (
              <button
                type="button"
                onClick={resend}
                disabled={busy}
                className={cn(linkButton, 'self-center text-body')}
              >
                {t.authFlow.resend}
              </button>
            )}
          </form>

          <p className="mt-6 text-center text-body text-ink-muted">
            {mode === 'signIn' ? (
              <>
                {t.auth.toSignUp}{' '}
                <button type="button" onClick={() => go('signUp')} className={linkButton}>
                  {t.auth.switchToSignUp}
                </button>
              </>
            ) : mode === 'signUp' ? (
              <>
                {t.auth.toSignIn}{' '}
                <button type="button" onClick={() => go('signIn')} className={linkButton}>
                  {t.auth.switchToSignIn}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => go('signIn')} className={linkButton}>
                {t.authFlow.backToSignIn}
              </button>
            )}
          </p>
        </div>
      </main>

      <footer className="pb-6 text-center">
        <a
          href="/privacy"
          className="rounded-md text-caption text-ink-muted hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {t.privacy}
        </a>
      </footer>
    </div>
  )
}

function Note({ tone, children }: { tone: 'danger' | 'info'; children: ReactNode }) {
  return (
    <p
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex gap-2 rounded-xl px-3 py-2 text-body',
        tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-ink',
      )}
    >
      <CircleAlert size={18} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden />
      <span dir="auto">{children}</span>
    </p>
  )
}

/** Google's "G" in its brand colours, as Google's sign-in branding guidelines require. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"
      />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  )
}
