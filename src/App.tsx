import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import { lazy, Suspense, useEffect } from 'react'
import { BrandMark } from '@/components/ui/BrandMark'
import { UpdatePrompt } from '@/components/UpdatePrompt'
import { useSession } from '@/features/auth/useSession'
import { anonymousPageView } from '@/lib/monitoring'
import { navigate, useRoute } from '@/lib/router'
import { useTheme } from '@/lib/theme'

// Each screen is its own download: signing in doesn't load the chat app, and the other way round.
const LoginPage = lazy(() => import('@/features/auth/LoginPage').then((m) => ({ default: m.LoginPage })))
const ChatApp = lazy(() => import('@/features/chat/ChatApp').then((m) => ({ default: m.ChatApp })))
const PrivacyPage = lazy(() => import('@/features/legal/PrivacyPage').then((m) => ({ default: m.PrivacyPage })))
const LandingPage = lazy(() => import('@/features/landing/LandingPage').then((m) => ({ default: m.LandingPage })))

export default function App() {
  return (
    <>
      <Suspense fallback={<Splash />}>
        <Screen />
      </Suspense>
      <UpdatePrompt />
      {/* Anonymous page views and speed (turn them on in the Vercel project). */}
      <Analytics beforeSend={anonymousPageView} />
      <SpeedInsights beforeSend={anonymousPageView} />
    </>
  )
}

function Splash() {
  return (
    <div className="flex h-dvh items-center justify-center bg-canvas">
      <BrandMark size={48} />
    </div>
  )
}

function Screen() {
  const { theme, toggleTheme } = useTheme()
  const { session, loading } = useSession()
  const route = useRoute()
  const signedIn = Boolean(session)

  // Signed in on the sign-in page (e.g. just signed in): go to your chats.
  useEffect(() => {
    if (signedIn && route.name === 'login') navigate({ name: 'home' }, { replace: true })
  }, [signedIn, route.name])

  // Public page, reachable without signing in (Google requires a privacy policy link).
  if (route.name === 'privacy') return <PrivacyPage />

  if (loading) return <Splash />

  if (!session) {
    // The home page introduces Hamsa; any other link (e.g. to a chat) asks you to sign in first.
    if (route.name === 'home') return <LandingPage theme={theme} onToggleTheme={toggleTheme} />
    return <LoginPage theme={theme} onToggleTheme={toggleTheme} />
  }

  // key: a different account gets a completely fresh app state.
  return (
    <ChatApp
      key={session.user.id}
      userId={session.user.id}
      email={session.user.email}
      hasPassword={session.user.identities?.some((i) => i.provider === 'email') ?? false}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
  )
}
