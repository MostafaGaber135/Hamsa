import { useMutation, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { CallOverlay } from '@/features/calls/CallOverlay'
import { openDirectConversation } from '@/features/conversations/api'
import { EmptyState } from '@/features/conversations/EmptyState'
import {
  conversationKeys,
  useConversationAction,
  useConversations,
  useMarkRead,
  useProfile,
} from '@/features/conversations/queries'
import { Sidebar, type Filter } from '@/features/conversations/Sidebar'
import { useFriendships } from '@/features/friends/queries'
import { setAppBadge } from '@/lib/appBadge'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import { detachPush, resyncPush } from '@/lib/push'
import { goBack, navigate } from '@/lib/router'
import { supabase } from '@/lib/supabase'
import type { Theme } from '@/lib/theme'
import { useDocumentVisible } from '@/lib/useDocumentVisible'
import type { ConversationAction, Message, User } from '@/types/chat'
import { OpenConversation } from './OpenConversation'
import { CenteredLoading, LoadError } from './Placeholders'
import { useChatNavigation } from './useChatNavigation'
import { useConversationItems } from './useConversationItems'
import { useLiveConversations } from './useLiveConversations'

// Screens and panels you open now and then load on first use, not with the app.
const ConversationDetails = lazy(() =>
  import('@/features/conversations/ConversationDetails').then((m) => ({ default: m.ConversationDetails })),
)
const NewChatDialog = lazy(() =>
  import('@/features/conversations/NewChatDialog').then((m) => ({ default: m.NewChatDialog })),
)
const FriendsPage = lazy(() => import('@/features/friends/FriendsPage').then((m) => ({ default: m.FriendsPage })))
const ProfilePage = lazy(() => import('@/features/profile/ProfilePage').then((m) => ({ default: m.ProfilePage })))
const MediaViewer = lazy(() => import('@/features/messages/MediaViewer').then((m) => ({ default: m.MediaViewer })))
const SharePage = lazy(() => import('@/features/share/SharePage').then((m) => ({ default: m.SharePage })))
const JoinPage = lazy(() => import('@/features/conversations/JoinPage').then((m) => ({ default: m.JoinPage })))

interface ChatAppProps {
  userId: string
  email?: string
  hasPassword: boolean
  theme: Theme
  onToggleTheme: () => void
}

/** The signed-in app: the chat list beside whatever's open (a chat, friends, profile…). */
export function ChatApp({ userId, email, hasPassword, theme, onToggleTheme }: ChatAppProps) {
  const { t } = useLocale()
  const conversationsQuery = useConversations()
  const profileQuery = useProfile(userId)
  const { mutate: markRead } = useMarkRead()
  const nav = useChatNavigation()
  const { route, selectedId, view, detailsOpen, setDetailsOpen, openConversation } = nav
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [viewer, setViewer] = useState<{ items: Message[]; startId: string } | null>(null)
  const friendships = useFriendships()
  const friendRequests = (friendships.data ?? []).filter((f) => f.status === 'incoming').length
  const qc = useQueryClient()

  const me = useMemo<User>(
    () => ({ ...(profileQuery.data ?? { id: userId, name: '' }), online: true }),
    [profileQuery.data, userId],
  )

  const live = useLiveConversations({
    userId,
    me,
    serverConversations: conversationsQuery.data,
    openConversationId: view === 'chat' ? selectedId : null,
    markRead,
  })
  const { conversations, users, call } = live
  const { items, messageResults, searchingMessages, unreadTotal, requestCount } = useConversationItems(
    conversations,
    me,
    users,
    query,
    filter,
  )

  // "Message" on the friends page: open (or create) the 1:1 chat, then show it.
  const messageFriend = useMutation({
    mutationFn: (user: User) => openDirectConversation(user.id),
    onSuccess: async (conversationId) => {
      await qc.invalidateQueries({ queryKey: conversationKeys.all })
      navigate({ name: 'chat', id: conversationId })
    },
  })

  const conversationAction = useConversationAction()

  function handleConversationAction(id: string, action: ConversationAction) {
    // Close the chat if it's going away, or if you just marked it unread
    // (keeping it open would mark it read again straight away).
    if (id === selectedId && (action === 'delete' || action === 'leave' || action === 'markUnread'))
      nav.closeConversation()
    conversationAction.mutate({ id, action })
  }

  const selected = conversations.find((c) => c.id === selectedId)
  // On mobile the sidebar and the main pane take turns filling the screen.
  const mainOpen = view !== 'chat' || Boolean(selected)

  // Opening a conversation with unread messages marks it read, but only while you can see it.
  const visible = useDocumentVisible()
  const selectedUnread = (selected?.unreadCount ?? 0) > 0 || Boolean(selected?.markedUnread)
  const reading = view === 'chat' && visible
  const { openIsRequest } = live
  useEffect(() => {
    if (selectedId && selectedUnread && reading && !openIsRequest) markRead(selectedId)
  }, [selectedId, selectedUnread, reading, openIsRequest, markRead])

  // Notifications: this device notifies whoever is signed in now.
  useEffect(() => {
    resyncPush()
  }, [])

  // "(3) Hamsa" in the browser tab, and a 3 on the installed app's icon, when chats are waiting.
  useEffect(() => {
    document.title = unreadTotal > 0 ? `(${unreadTotal}) Hamsa` : 'Hamsa'
    setAppBadge(unreadTotal)
    return () => {
      document.title = 'Hamsa'
      setAppBadge(0)
    }
  }, [unreadTotal])

  let listPlaceholder = null
  if (conversationsQuery.isPending) listPlaceholder = <CenteredLoading label={t.loading} />
  else if (conversationsQuery.isError) listPlaceholder = <LoadError onRetry={() => conversationsQuery.refetch()} />
  else if (conversations.length === 0)
    listPlaceholder = <p className="px-4 py-8 text-center text-body text-ink-muted">{t.noConversations}</p>

  return (
    <div className="flex h-dvh gap-3 bg-canvas md:p-3">
      <Sidebar
        className={cn('w-full md:w-80 lg:w-88', mainOpen ? 'hidden md:flex' : 'flex')}
        items={items}
        unreadTotal={unreadTotal}
        requestCount={requestCount}
        selectedId={selectedId}
        currentUser={me}
        query={query}
        filter={filter}
        theme={theme}
        listPlaceholder={listPlaceholder}
        onQueryChange={setQuery}
        onFilterChange={setFilter}
        onSelect={openConversation}
        onConversationAction={handleConversationAction}
        onToggleTheme={onToggleTheme}
        onNewChat={() => setNewChatOpen(true)}
        onSignOut={async () => {
          await detachPush().catch(() => undefined)
          await supabase.auth.signOut()
        }}
        onOpenFriends={() => (view === 'friends' ? goBack() : navigate({ name: 'friends' }))}
        friendsActive={view === 'friends'}
        onOpenProfile={() => (view === 'profile' ? goBack() : navigate({ name: 'profile' }))}
        profileActive={view === 'profile'}
        friendRequests={friendRequests}
        messageResults={messageResults}
        searchingMessages={searchingMessages}
        onOpenMessage={nav.openMessage}
      />

      <main
        className={cn(
          'min-w-0 flex-1 flex-col bg-surface md:rounded-3xl md:shadow-xs',
          mainOpen ? 'flex' : 'hidden md:flex',
        )}
      >
        <Suspense fallback={<CenteredLoading label={t.loading} />}>
          {view === 'profile' ? (
            <ProfilePage user={me} email={email} hasPassword={hasPassword} onBack={goBack} />
          ) : view === 'share' ? (
            <SharePage conversations={conversations} me={me} onBack={goBack} />
          ) : route.name === 'join' ? (
            <JoinPage code={route.code} onBack={goBack} />
          ) : view === 'friends' ? (
            <FriendsPage
              // A new invite link starts a fresh search.
              key={route.name === 'add' ? route.username : 'friends'}
              myUsername={me.username}
              inviteUsername={route.name === 'add' ? route.username : undefined}
              onBack={goBack}
              onMessage={(user) => messageFriend.mutate(user)}
              messagingUserId={messageFriend.isPending ? messageFriend.variables?.id : null}
            />
          ) : selected ? (
            <OpenConversation
              key={selected.id}
              conversation={selected}
              me={me}
              users={users}
              connection={live.connection}
              onTyping={() => live.sendTyping(selected.id)}
              onSent={() => live.stopTyping(selected.id)}
              detailsOpen={detailsOpen}
              onToggleDetails={() => setDetailsOpen((open) => !open)}
              onBack={goBack}
              onAction={(action) => handleConversationAction(selected.id, action)}
              jumpTarget={nav.jumpFor(selected.id)}
              onCall={selected.isGroup ? undefined : (video) => call.start(selected.id, video)}
            />
          ) : (
            <EmptyState onNewChat={() => setNewChatOpen(true)} />
          )}
        </Suspense>
      </main>

      {/* Chat info: a third column on wide screens, full screen on smaller ones. */}
      <Suspense fallback={null}>
        {view === 'chat' && selected && detailsOpen && (
          <ConversationDetails
            key={selected.id}
            conversation={selected}
            title={selected.name ?? selected.members.find((m) => m.id !== me.id)?.name ?? ''}
            me={me}
            onClose={() => setDetailsOpen(false)}
            onOpenMedia={(items, startId) => setViewer({ items, startId })}
            onAction={(action) => {
              setDetailsOpen(false)
              handleConversationAction(selected.id, action)
            }}
            className="fixed inset-0 z-30 lg:static lg:inset-auto lg:z-auto lg:w-88 lg:shrink-0 lg:rounded-3xl lg:shadow-xs"
          />
        )}
        {viewer && (
          <MediaViewer items={viewer.items} startId={viewer.startId} users={users} onClose={() => setViewer(null)} />
        )}

        {/* Mounted only while open, so its code loads the first time you start a chat. */}
        {newChatOpen && (
          <NewChatDialog
            open
            onClose={() => setNewChatOpen(false)}
            onCreated={(id) => {
              setNewChatOpen(false)
              openConversation(id)
            }}
          />
        )}
      </Suspense>

      <CallOverlay call={call} />
    </div>
  )
}
