import { useMutation, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import type { ConversationItem } from '@/features/conversations/ConversationList'
import { openDirectConversation } from '@/features/conversations/api'
import { EmptyState } from '@/features/conversations/EmptyState'
import { conversationKeys, useConversationAction, useConversations, useMarkRead, useProfile } from '@/features/conversations/queries'
import { useFriendships } from '@/features/friends/queries'
import { Sidebar, type Filter } from '@/features/conversations/Sidebar'
import { CallOverlay } from '@/features/calls/CallOverlay'
import { useCall } from '@/features/calls/useCall'
import { ChatPane } from '@/features/messages/ChatPane'
import type { Draft } from '@/features/messages/Composer'
import type { JumpTarget } from '@/features/messages/MessageThread'
import { useMessageSearch, useMessages, useSendMessage } from '@/features/messages/queries'
import { useBlockState, usePrivacySettings, useSetBlocked } from '@/features/privacy/queries'
import { useLiveUpdates, type Connection } from '@/features/realtime/useLiveUpdates'
import { useConversationChannels } from '@/features/realtime/useConversationChannels'
import { useLastSeenHeartbeat } from '@/features/realtime/useLastSeen'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import { goBack, navigate, useRoute } from '@/lib/router'
import { withStatus } from '@/lib/status'
import { useDebounced } from '@/lib/useDebounced'
import { detachPush, resyncPush } from '@/lib/push'
import { supabase } from '@/lib/supabase'
import type { Theme } from '@/lib/theme'
import type { CachedMessage, Conversation, ConversationAction, Message, User } from '@/types/chat'

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

export function ChatApp({ userId, email, hasPassword, theme, onToggleTheme }: ChatAppProps) {
  const { t } = useLocale()
  const conversationsQuery = useConversations()
  const profileQuery = useProfile(userId)
  const markRead = useMarkRead()
  // The URL decides what's on screen: /c/<id>, /friends, /profile, /share, or the list.
  const route = useRoute()
  const selectedId = route.name === 'chat' ? route.id : null
  const view =
    route.name === 'friends' || route.name === 'profile' || route.name === 'share' || route.name === 'join' ? route.name : 'chat'
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [viewer, setViewer] = useState<{ items: Message[]; startId: string } | null>(null)
  // A message to scroll to once its chat is open (from search).
  const [jump, setJump] = useState<{ conversationId: string; target: JumpTarget } | null>(null)
  const friendships = useFriendships()
  const friendRequests = (friendships.data ?? []).filter((f) => f.status === 'incoming').length
  const qc = useQueryClient()

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
    if (id === selectedId && (action === 'delete' || action === 'leave' || action === 'markUnread')) {
      navigate({ name: 'home' }, { replace: true })
    }
    conversationAction.mutate({ id, action })
  }

  function openConversation(id: string) {
    if (id !== selectedId) setDetailsOpen(false)
    // Switching between chats replaces the entry, so Back returns to the list, not the previous chat.
    navigate({ name: 'chat', id }, { replace: selectedId !== null })
  }

  const me = useMemo<User>(
    () => ({ ...(profileQuery.data ?? { id: userId, name: '' }), online: true }),
    [profileQuery.data, userId],
  )

  // ---- Realtime: who's online, who's typing, and live database changes ----
  useLastSeenHeartbeat()
  const visible = useDocumentVisible()
  const { mutate: markReadMutate } = markRead
  const rawConversations = conversationsQuery.data
  // Reading a message request doesn't tell the sender: no read receipt until you accept.
  const selectedIsRequest = Boolean(rawConversations?.find((c) => c.id === selectedId)?.isRequest)
  const connection = useLiveUpdates({
    userId,
    openConversationId: view === 'chat' ? selectedId : null,
    onReadWhileOpen: selectedIsRequest ? ignoreRead : markReadMutate,
  })
  // Typing and online status for your most recent chats (and the open one): one
  // Realtime channel each, so a long chat list can't exhaust the connection's channels.
  const conversationIds = useMemo(() => {
    const recent = (rawConversations ?? []).slice(0, MAX_LIVE_CONVERSATIONS).map((c) => c.id)
    return selectedId && !recent.includes(selectedId) ? [...recent, selectedId] : recent
  }, [rawConversations, selectedId])
  const requestIds = useMemo(() => (rawConversations ?? []).filter((c) => c.isRequest).map((c) => c.id), [rawConversations])
  // You appear online only once your setting is known, only if it allows it,
  // and never in a message request you haven't accepted.
  const privacy = usePrivacySettings(userId)
  // Call signals arrive on the same channels; the call hook is created just below.
  const callSignal = useRef<(conversationId: string, signal: unknown) => void>(undefined)
  const channels = useConversationChannels(
    conversationIds, userId, privacy.data?.presence === 'contacts', requestIds,
    (conversationId, signal) => callSignal.current?.(conversationId, signal),
  )
  const { online, wentOfflineAt, typing } = channels

  // ---- Calls (one-to-one) ----
  const peerOf = useCallback(
    (conversationId: string) => {
      const conversation = rawConversations?.find((c) => c.id === conversationId)
      return conversation && !conversation.isGroup ? conversation.members.find((m) => m.id !== userId) : undefined
    },
    [rawConversations, userId],
  )
  const call = useCall({ userId, peerOf, send: channels.sendCallSignal })
  useEffect(() => {
    callSignal.current = call.handleSignal
  })

  // Server data + live data: online dots, "last seen", and who's typing.
  const conversations = useMemo<Conversation[]>(() => {
    const live = <T extends User>(u: T): T => {
      const leftAt = wentOfflineAt[u.id]
      const lastSeenAt = leftAt && (!u.lastSeenAt || leftAt > u.lastSeenAt) ? leftAt : u.lastSeenAt
      return { ...u, online: online.has(u.id), lastSeenAt }
    }
    return (rawConversations ?? []).map((c) => ({
      ...c,
      members: c.members.map(live),
      typingUserIds: typing[c.id] ?? [],
    }))
  }, [rawConversations, online, wentOfflineAt, typing])

  // Everyone you share a conversation with, by id.
  const users = useMemo(() => {
    const map: Record<string, User> = { [me.id]: me }
    for (const c of conversations) for (const m of c.members) map[m.id] ??= m
    return map
  }, [conversations, me])

  const items = useMemo<ConversationItem[]>(() => {
    const q = query.trim().toLocaleLowerCase()
    return conversations
      .map((c) => {
        const peer = c.isGroup ? undefined : c.members.find((m) => m.id !== me.id)
        const lastMessage = c.lastMessage && withStatus(c.lastMessage, me.id, c.members)
        return {
          conversation: c,
          title: c.name ?? peer?.name ?? '',
          peer,
          lastMessage,
          lastSender: lastMessage && users[lastMessage.senderId],
        }
      })
      // Message requests live in their own tab.
      .filter((it) => (filter === 'requests') === it.conversation.isRequest)
      .filter((it) => filter !== 'unread' || it.conversation.unreadCount > 0 || it.conversation.markedUnread)
      .filter((it) => filter !== 'groups' || it.conversation.isGroup)
      .filter((it) => it.title.toLocaleLowerCase().includes(q))
  }, [conversations, me.id, users, query, filter])

  // Message search, alongside the chat names, once you've typed two characters.
  const searchQuery = useDebounced(query, 300)
  const messageSearch = useMessageSearch(searchQuery)
  const messageResults = useMemo(() => {
    if (searchQuery.trim().length < 2) return undefined
    const titles = new Map(items.map((it) => [it.conversation.id, it.title]))
    for (const c of conversations) {
      if (!titles.has(c.id)) titles.set(c.id, c.name ?? c.members.find((m) => m.id !== me.id)?.name ?? '')
    }
    return (messageSearch.data ?? []).map((r) => ({ ...r, title: titles.get(r.conversationId) ?? '' }))
  }, [searchQuery, messageSearch.data, items, conversations, me.id])

  function openMessage(conversationId: string, messageId: string) {
    openConversation(conversationId)
    setJump({ conversationId, target: { id: messageId, key: Date.now() } })
  }

  const selected = conversations.find((c) => c.id === selectedId)
  // On mobile the sidebar and the main pane take turns filling the screen.
  const mainOpen = view !== 'chat' || Boolean(selected)
  const unreadTotal = conversations.filter((c) => !c.isRequest && (c.unreadCount > 0 || c.markedUnread)).length
  const requestCount = conversations.filter((c) => c.isRequest).length

  // Opening a conversation with unread messages marks it read, but only while you can see it.
  const selectedUnread = (selected?.unreadCount ?? 0) > 0 || Boolean(selected?.markedUnread)
  const reading = view === 'chat' && visible
  useEffect(() => {
    if (selectedId && selectedUnread && reading && !selectedIsRequest) markReadMutate(selectedId)
  }, [selectedId, selectedUnread, reading, selectedIsRequest, markReadMutate])

  // Notifications: this device notifies whoever is signed in now.
  useEffect(() => {
    resyncPush()
  }, [])

  // Clicking a notification opens its chat: /c/<id> in a new tab, or a message from the
  // service worker for a tab that was already open. (?c=<id> is the older link form.)
  useEffect(() => {
    const legacy = new URLSearchParams(window.location.search).get('c')
    if (legacy) navigate({ name: 'chat', id: legacy }, { replace: true })
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'open-conversation' && typeof e.data.conversationId === 'string') {
        navigate({ name: 'chat', id: e.data.conversationId })
      }
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
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
  else if (conversationsQuery.isError)
    listPlaceholder = <LoadError onRetry={() => conversationsQuery.refetch()} />
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
        searchingMessages={messageSearch.isFetching}
        onOpenMessage={openMessage}
      />

      <main
        className={cn(
          'min-w-0 flex-1 flex-col bg-surface md:rounded-3xl md:shadow-xs',
          mainOpen ? 'flex' : 'hidden md:flex',
        )}
      >
        <Suspense fallback={<CenteredLoading label={t.loading} />}>
        {view === 'profile' ? (
          <ProfilePage
            user={me}
            email={email}
            hasPassword={hasPassword}
            onBack={goBack}
          />
        ) : view === 'share' ? (
          <SharePage conversations={conversations} me={me} onBack={goBack} />
        ) : route.name === 'join' ? (
          <JoinPage code={route.code} onBack={goBack} />
        ) : view === 'friends' ? (
          <FriendsPage
            currentUserId={me.id}
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
            connection={connection}
            onTyping={() => channels.sendTyping(selected.id)}
            onSent={() => channels.stopTyping(selected.id)}
            detailsOpen={detailsOpen}
            onToggleDetails={() => setDetailsOpen((open) => !open)}
            onBack={goBack}
            onAction={(action) => handleConversationAction(selected.id, action)}
            jumpTarget={jump?.conversationId === selected.id ? jump.target : undefined}
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
      {viewer && <MediaViewer items={viewer.items} startId={viewer.startId} users={users} onClose={() => setViewer(null)} />}

      {/* Mounted only while open, so its code loads the first time you start a chat. */}
      {newChatOpen && (
        <NewChatDialog
          open
          currentUserId={me.id}
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

/** How many chats get live typing and online status (plus the open one). */
const MAX_LIVE_CONVERSATIONS = 50

/** Used while a message request is open: reading it doesn't mark it read. */
const ignoreRead = () => undefined

interface OpenConversationProps {
  conversation: Conversation
  me: User
  users: Record<string, User>
  connection: Connection
  onTyping: () => void
  onSent: () => void
  onBack: () => void
  /** Accept or delete a message request. */
  onAction: (action: ConversationAction) => void
  detailsOpen: boolean
  onToggleDetails: () => void
  jumpTarget?: JumpTarget
  onCall?: (video: boolean) => void
}

/** Its own component so each open conversation gets its own message query and send mutation. */
function OpenConversation({
  conversation, me, users, connection, onTyping, onSent, onBack, onAction, detailsOpen, onToggleDetails, jumpTarget, onCall,
}: OpenConversationProps) {
  const { t } = useLocale()
  const messagesQuery = useMessages(conversation.id, conversation.clearedAt)
  const send = useSendMessage()
  const peer = conversation.isGroup ? undefined : conversation.members.find((m) => m.id !== me.id)
  const blocked = useBlockState(conversation.id, peer?.id)
  const setBlocked = useSetBlocked()

  const messages = useMemo(
    () => (messagesQuery.data ?? []).map((m) => withStatus(m, me.id, conversation.members)),
    [messagesQuery.data, me.id, conversation.members],
  )

  function sendMessage(draft: Draft) {
    onSent()
    const local = draft.file ? URL.createObjectURL(draft.file) : undefined
    send.mutate({
      id: crypto.randomUUID(), // client-generated: lets us recognise the Realtime echo
      conversationId: conversation.id,
      senderId: me.id,
      kind: draft.kind,
      content: draft.content,
      file: draft.file,
      attachment: draft.file
        ? { ...draft.attachment, name: draft.file.name, size: draft.file.size, mime: draft.file.type }
        : draft.attachment,
      // Shown right away while the real file uploads.
      imageUrl: draft.kind === 'image' ? local : undefined,
      fileUrl: draft.kind !== 'image' ? local : undefined,
      createdAt: new Date().toISOString(),
      replyToId: draft.replyToId,
    })
  }

  function retry(message: Message) {
    // The cached copy still has the picked image, so it can be uploaded again.
    const cached: CachedMessage = messagesQuery.data?.find((m) => m.id === message.id) ?? message
    send.mutate(cached)
  }

  let threadPlaceholder = null
  if (messagesQuery.isPending) threadPlaceholder = <CenteredLoading label={t.loading} />
  else if (messagesQuery.isError) threadPlaceholder = <LoadError onRetry={() => messagesQuery.refetch()} />

  return (
    <ChatPane
      conversation={conversation}
      title={conversation.name ?? peer?.name ?? ''}
      peer={peer}
      messages={messages}
      users={users}
      currentUserId={me.id}
      onBack={onBack}
      onSend={sendMessage}
      onRetry={retry}
      hasOlder={messagesQuery.hasNextPage}
      loadingOlder={messagesQuery.isFetchingNextPage}
      onLoadOlder={() => messagesQuery.fetchNextPage()}
      threadPlaceholder={threadPlaceholder}
      onTyping={onTyping}
      connection={connection}
      detailsOpen={detailsOpen}
      onToggleDetails={onToggleDetails}
      jumpTarget={jumpTarget}
      onCall={onCall}
      blocked={blocked}
      onUnblock={peer && (() => setBlocked.mutate({ userId: peer.id, blocked: false }))}
      request={
        conversation.isRequest && peer && !blocked
          ? {
              onAccept: () => onAction('accept'),
              onBlock: () => window.confirm(t.block.confirm(peer.name)) && setBlocked.mutate({ userId: peer.id, blocked: true }),
              onDelete: () => onAction('delete'),
            }
          : undefined
      }
    />
  )
}

function CenteredLoading({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-1 items-center justify-center gap-2 py-10 text-body text-ink-muted">
      <Spinner />
      {label}
    </div>
  )
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useLocale()
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <p className="text-body text-ink-muted">{t.loadError}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {t.tryAgain}
      </Button>
    </div>
  )
}

/** The Badging API (installed app icon); quietly does nothing where it isn't supported. */
function setAppBadge(count: number) {
  const badging = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  const done = count > 0 ? badging.setAppBadge?.(count) : badging.clearAppBadge?.()
  done?.catch(() => undefined)
}

function useDocumentVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return visible
}
