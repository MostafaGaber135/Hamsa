import { Languages, LockKeyhole, Mic, Moon, Smartphone, Sun, Users, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import { BrandMark } from '@/components/ui/BrandMark'
import { IconButton, focusRing } from '@/components/ui/Button'
import { Link } from '@/components/ui/Link'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import type { Theme } from '@/lib/theme'

interface LandingPageProps {
  theme: Theme
  onToggleTheme: () => void
}

const buttonBase = cn(
  'inline-flex h-12 items-center justify-center rounded-xl px-5 text-body font-semibold transition-colors duration-150',
  focusRing,
)

/** The public home page: what Hamsa is, before you sign in. */
export function LandingPage({ theme, onToggleTheme }: LandingPageProps) {
  const { t, lang, setLang } = useLocale()
  const icon = { size: 22, strokeWidth: 1.75, 'aria-hidden': true } as const
  const features: { icon: ReactNode; title: string; body: string }[] = [
    { icon: <Zap {...icon} />, ...t.landing.features.realtime },
    { icon: <Mic {...icon} />, ...t.landing.features.media },
    { icon: <LockKeyhole {...icon} />, ...t.landing.features.privacy },
    { icon: <Users {...icon} />, ...t.landing.features.people },
    { icon: <Languages {...icon} />, ...t.landing.features.bilingual },
    { icon: <Smartphone {...icon} />, ...t.landing.features.app },
  ]

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <span className="flex items-center gap-2">
          <BrandMark />
          <span className="text-title-3 font-extrabold">{lang === 'ar' ? 'همسة' : 'Hamsa'}</span>
        </span>
        <nav className="flex items-center gap-1">
          <IconButton label={theme === 'dark' ? t.themeToLight : t.themeToDark} onClick={onToggleTheme}>
            {theme === 'dark' ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
          </IconButton>
          <IconButton label={t.switchLanguage} onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
            <Languages size={18} strokeWidth={1.75} />
          </IconButton>
          <Link to={{ name: 'login' }} className={cn(buttonBase, 'ms-1 h-9 px-3 text-ink hover:bg-surface-hover')}>
            {t.landing.signIn}
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-3xl px-4 pt-10 pb-12 text-center sm:px-6 sm:pt-16">
          <h1 className={lang === 'ar' ? 'text-title-1 text-balance' : 'text-display text-balance sm:text-[44px] sm:leading-[52px]'}>
            {t.landing.headline}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-title-3 font-normal text-balance text-ink-muted">{t.landing.lead}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to={{ name: 'login' }} className={cn(buttonBase, 'bg-accent text-on-accent hover:bg-accent-strong')}>
              {t.landing.getStarted}
            </Link>
            <a href="#features" className={cn(buttonBase, 'bg-surface-raised text-ink ring-1 ring-line-strong ring-inset hover:bg-surface-hover')}>
              {t.landing.seeFeatures}
            </a>
          </div>
        </section>

        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <img
            src="/screenshots/desktop-light.png"
            alt={t.landing.screenshots.chat}
            width={2880}
            height={1920}
            fetchPriority="high"
            className="h-auto w-full rounded-2xl shadow-lg ring-1 ring-line sm:rounded-3xl"
          />
        </div>

        <section id="features" aria-labelledby="features-title" className="mx-auto max-w-6xl scroll-mt-4 px-4 py-16 sm:px-6">
          <h2 id="features-title" className="text-center text-title-1">{t.landing.featuresTitle}</h2>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <li key={feature.title} className="rounded-3xl bg-surface p-6 shadow-xs ring-1 ring-line">
                <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                  {feature.icon}
                </span>
                <h3 className="mt-4 text-title-3">{feature.title}</h3>
                <p className="mt-1 text-body text-ink-muted">{feature.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto grid max-w-5xl gap-4 px-4 pb-16 sm:grid-cols-2 sm:px-6">
          <img
            src="/screenshots/friends.png"
            alt={t.landing.screenshots.friends}
            width={2880}
            height={1800}
            loading="lazy"
            className="h-auto w-full rounded-2xl shadow-md ring-1 ring-line"
          />
          <img
            src="/screenshots/profile.png"
            alt={t.landing.screenshots.profile}
            width={2880}
            height={1800}
            loading="lazy"
            className="h-auto w-full rounded-2xl shadow-md ring-1 ring-line"
          />
        </section>

        <section className="mx-auto max-w-3xl px-4 pb-20 text-center sm:px-6">
          <h2 className="text-title-1 text-balance">{t.landing.closingTitle}</h2>
          <Link to={{ name: 'login' }} className={cn(buttonBase, 'mt-6 bg-accent text-on-accent hover:bg-accent-strong')}>
            {t.landing.getStarted}
          </Link>
        </section>
      </main>

      <footer className="border-t border-line py-6 text-center text-caption text-ink-muted">
        <Link to={{ name: 'privacy' }} className={cn('rounded-md hover:text-ink hover:underline', focusRing)}>
          {t.privacy}
        </Link>
      </footer>
    </div>
  )
}
