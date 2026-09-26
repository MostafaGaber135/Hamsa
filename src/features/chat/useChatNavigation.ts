import { useEffect, useState } from 'react'
import type { JumpTarget } from '@/features/messages/MessageThread'
import { navigate, parseRoute, useRoute } from '@/lib/router'

type ChatView = 'chat' | 'friends' | 'profile' | 'share' | 'join'

/**
 * What's on screen, from the URL (/c/<id>, /friends, /add/<username>, /profile, /share, /join/<code>),
 * and the ways to move around: open a chat, jump to a message, close the chat.
 * Also opens the chat of a notification you clicked.
 */
export function useChatNavigation() {
  const route = useRoute()
  const selectedId = route.name === 'chat' ? route.id : null
  // An invite link (/add/<username>) is the friends page, searching for that person.
  const view: ChatView =
    route.name === 'add'
      ? 'friends'
      : route.name === 'friends' || route.name === 'profile' || route.name === 'share' || route.name === 'join'
        ? route.name
        : 'chat'
  const [detailsOpen, setDetailsOpen] = useState(false)
  // A message to scroll to once its chat is open (from search).
  const [jump, setJump] = useState<{ conversationId: string; target: JumpTarget } | null>(null)

  function openConversation(id: string) {
    if (id !== selectedId) setDetailsOpen(false)
    // Switching between chats replaces the entry, so Back returns to the list, not the previous chat.
    navigate({ name: 'chat', id }, { replace: selectedId !== null })
  }

  function openMessage(conversationId: string, messageId: string) {
    openConversation(conversationId)
    setJump({ conversationId, target: { id: messageId, key: Date.now() } })
  }

  function closeConversation() {
    navigate({ name: 'home' }, { replace: true })
  }

  // Clicking a notification opens its chat: /c/<id> in a new tab, or a message from the
  // service worker for a tab that was already open. (?c=<id> is the older link form.)
  useEffect(() => {
    const legacy = new URLSearchParams(window.location.search).get('c')
    if (legacy) navigate({ name: 'chat', id: legacy }, { replace: true })
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'open-conversation' && typeof e.data.conversationId === 'string') {
        navigate({ name: 'chat', id: e.data.conversationId })
      }
      // A bell event that isn't about a chat, e.g. a friend request: /friends.
      if (e.data?.type === 'open-path' && typeof e.data.path === 'string') navigate(parseRoute(e.data.path))
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [])

  return {
    route,
    selectedId,
    view,
    detailsOpen,
    setDetailsOpen,
    /** The jump for this chat, if one is waiting. */
    jumpFor: (conversationId: string) => (jump?.conversationId === conversationId ? jump.target : undefined),
    openConversation,
    openMessage,
    closeConversation,
  }
}
