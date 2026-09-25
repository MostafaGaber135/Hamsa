import { lazy, Suspense } from 'react'
import { BrandMark } from '@/components/ui/BrandMark'
import { useSession } from '@/features/auth/useSession'
import { useTheme } from '@/lib/theme'

// Each screen is its own download: signing in doesn't load the chat app, and the other way round.
const LoginPage = lazy(() => import('@/features/auth/LoginPage').then((m) => ({ default: m.LoginPage })))
const SetNewPasswordPage = lazy(() =>
  import('@/features/auth/SetNewPasswordPage').then((m) => ({ default: m.SetNewPasswordPage })),
)
const ChatApp = lazy(() => import('@/features/chat/ChatApp').then((m) => ({ default: m.ChatApp })))
const PrivacyPage = lazy(() => import('@/features/legal/PrivacyPage').then((m) => ({ default: m.PrivacyPage })))

export default function App() {
  return (
    <Suspense fallback={<Splash />}>
      <Screen />
    </Suspense>
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
  const { session, loading, recovering, doneRecovering } = useSession()

  // Public page, reachable without signing in (Google requires a privacy policy link).
  if (window.location.pathname === '/privacy') return <PrivacyPage />

  if (loading) return <Splash />

  if (!session) return <LoginPage theme={theme} onToggleTheme={toggleTheme} />

  // Arrived from the "reset password" email link: choose a new password first.
  if (recovering) return <SetNewPasswordPage onDone={doneRecovering} />

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
