import { CircleAlert, Languages, MailCheck, Moon, Sun } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { BrandMark } from '@/components/ui/BrandMark'
import { Button, IconButton } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { useLocale } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import type { Theme } from '@/lib/theme'

type Mode = 'signIn' | 'signUp'

interface LoginPageProps {
  theme: Theme
  onToggleTheme: () => void
}

export function LoginPage({ theme, onToggleTheme }: LoginPageProps) {
  const { t, lang, setLang } = useLocale()
  const [mode, setMode] = useState<Mode>('signIn')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const errorId = useId()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)

    const { data, error } =
      mode === 'signIn'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            // Read by the handle_new_user trigger to fill in profiles.full_name.
            options: { data: { full_name: fullName.trim() } },
          })

    setBusy(false)
    if (error) return setError(error.message)
    // With "Confirm email" on, sign-up returns no session until the link is clicked.
    if (mode === 'signUp' && !data.session) setSentTo(email)
  }

  async function signInWithGoogle() {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) setError(error.message)
  }

  function switchMode() {
    setMode((m) => (m === 'signIn' ? 'signUp' : 'signIn'))
    setError(null)
    setSentTo(null)
  }

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
          <BrandMark size={40} />
          <h1 className={lang === 'ar' ? 'mt-5 text-title-ar text-ink' : 'mt-5 text-title-2 text-ink'}>
            {mode === 'signIn' ? t.auth.signInTitle : t.auth.signUpTitle}
          </h1>
          <p className="mt-1 text-body text-ink-muted">{t.auth.subtitle}</p>

          {sentTo ? (
            <div role="status" className="mt-6 flex gap-3 rounded-2xl bg-accent-soft p-4 text-body text-ink">
              <MailCheck size={20} strokeWidth={1.75} className="shrink-0 text-accent" aria-hidden />
              <p>{t.auth.checkEmail(sentTo)}</p>
            </div>
          ) : (
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

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
                <TextField
                  label={t.auth.email}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  dir="ltr"
                  required
                />
                <TextField
                  label={t.auth.password}
                  hint={mode === 'signUp' ? t.auth.passwordHint : undefined}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                  minLength={mode === 'signUp' ? 8 : undefined}
                  dir="ltr"
                  required
                  aria-describedby={error ? errorId : undefined}
                />

                {error && (
                  <p id={errorId} role="alert" className="flex gap-2 rounded-xl bg-danger-soft px-3 py-2 text-body text-danger">
                    <CircleAlert size={18} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden />
                    <span dir="auto">{error}</span>
                  </p>
                )}

                <Button type="submit" size="lg" disabled={busy} className="mt-1 w-full">
                  {mode === 'signIn' ? t.auth.signIn : t.auth.signUp}
                </Button>
              </form>
            </>
          )}

          <p className="mt-6 text-center text-body text-ink-muted">
            {mode === 'signIn' ? t.auth.toSignUp : t.auth.toSignIn}{' '}
            <button
              type="button"
              onClick={switchMode}
              className="rounded-md font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              {mode === 'signIn' ? t.auth.switchToSignUp : t.auth.switchToSignIn}
            </button>
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

/** Placeholder glyph. Swap in Google's official sign-in mark before shipping. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  )
}
