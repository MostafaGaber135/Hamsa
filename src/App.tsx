import { BrandMark } from '@/components/ui/BrandMark'
import { LoginPage } from '@/features/auth/LoginPage'
import { SetNewPasswordPage } from '@/features/auth/SetNewPasswordPage'
import { useSession } from '@/features/auth/useSession'
import { ChatApp } from '@/features/chat/ChatApp'
import { PrivacyPage } from '@/features/legal/PrivacyPage'
import { useTheme } from '@/lib/theme'

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const { session, loading, recovering, doneRecovering } = useSession()

  // Public page, reachable without signing in (Google requires a privacy policy link).
  if (window.location.pathname === '/privacy') return <PrivacyPage />

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-canvas">
        <BrandMark size={48} />
      </div>
    )
  }

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
