import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import type { ConversationItem } from '@/features/conversations/ConversationList'
import { openDirectConversation } from '@/features/conversations/api'
import { ConversationDetails } from '@/features/conversations/ConversationDetails'
import { EmptyState } from '@/features/conversations/EmptyState'
import { NewChatDialog } from '@/features/conversations/NewChatDialog'
import { conversationKeys, useConversationAction, useConversations, useMarkRead, useProfile } from '@/features/conversations/queries'
import { FriendsPage } from '@/features/friends/FriendsPage'
import { ProfilePage } from '@/features/profile/ProfilePage'
import { useFriendships } from '@/features/friends/queries'
import { Sidebar, type Filter } from '@/features/conversations/Sidebar'
import { ChatPane } from '@/features/messages/ChatPane'
import type { Draft } from '@/features/messages/Composer'
import { MediaViewer } from '@/features/messages/MediaViewer'
import { useMessages, useSendMessage } from '@/features/messages/queries'
import { useBlockState, usePrivacySettings, useSetBlocked } from '@/features/privacy/queries'
import { useLiveUpdates, type Connection } from '@/features/realtime/useLiveUpdates'
import { useConversationChannels } from '@/features/realtime/useConversationChannels'
import { useLastSeenHeartbeat } from '@/features/realtime/useLastSeen'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import { withStatus } from '@/lib/status'
import { detachPush, resyncPush } from '@/lib/push'
import { supabase } from '@/lib/supabase'
import type { Theme } from '@/lib/theme'
import type { CachedMessage, Conversation, ConversationAction, Message, User } from '@/types/chat'

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
  const [selectedId, setSelectedId] = useState<string | null>(
    // Opened from a notification in a new tab: ?c=<conversation id>
    () => new URLSearchParams(window.location.search).get('c'),
  )
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [view, setView] = useState<'chat' | 'friends' | 'profile'>('chat')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [viewer, setViewer] = useState<{ items: Message[]; startId: string } | null>(null)
  const friendships = useFriendships()
  const friendRequests = (friendships.data ?? []).filter((f) => f.status === 'incoming').length
  const qc = useQueryClient()

  // "Message" on the friends page: open (or create) the 1:1 chat, then show it.
  const messageFriend = useMutation({
    mutationFn: (user: User) => openDirectConversation(user.id),
    onSuccess: async (conversationId) => {
      await qc.invalidateQueries({ queryKey: conversationKeys.all })
      setSelectedId(conversationId)
      setView('chat')
    },
  })

  const conversationAction = useConversationAction()

  function handleConversationAction(id: string, action: ConversationAction) {
    // Close the chat if it's going away, or if you just marked it unread
    // (keeping it open would mark it read again straight away).
    if (id === selectedId && (action === 'delete' || action === 'leave' || action === 'markUnread')) {
      setSelectedId(null)
    }
    conversationAction.mutate({ id, action })
  }

  function openConversation(id: string) {
    if (id !== selectedId) setDetailsOpen(false)
    setSelectedId(id)
    setView('chat')
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
  const conversationIds = useMemo(() => (rawConversations ?? []).map((c) => c.id), [rawConversations])
  const requestIds = useMemo(() => (rawConversations ?? []).filter((c) => c.isRequest).map((c) => c.id), [rawConversations])
  // You appear online only once your setting is known, only if it allows it,
  // and never in a message request you haven't accepted.
  const privacy = usePrivacySettings(userId)
  const channels = useConversationChannels(conversationIds, userId, privacy.data?.presence === 'contacts', requestIds)
  const { online, wentOfflineAt, typing } = channels

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

  // Clicking a notification opens its chat: via ?c=<id> for a new tab, or a message
  // from the service worker for a tab that was already open.
  useEffect(() => {
    if (window.location.search.includes('c=')) window.history.replaceState(null, '', window.location.pathname)
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'open-conversation' && e.data.conversationId) {
        setSelectedId(e.data.conversationId)
        setView('chat')
      }
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [])

  // "(3) Hamsa" in the browser tab when chats are waiting.
  useEffect(() => {
    document.title = unreadTotal > 0 ? `(${unreadTotal}) Hamsa` : 'Hamsa'
    return () => {
      document.title = 'Hamsa'
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
        onOpenFriends={() => setView((v) => (v === 'friends' ? 'chat' : 'friends'))}
        friendsActive={view === 'friends'}
        onOpenProfile={() => setView((v) => (v === 'profile' ? 'chat' : 'profile'))}
        profileActive={view === 'profile'}
        friendRequests={friendRequests}
      />

      <main
        className={cn(
          'min-w-0 flex-1 flex-col bg-surface md:rounded-3xl md:shadow-xs',
          mainOpen ? 'flex' : 'hidden md:flex',
        )}
      >
        {view === 'profile' ? (
          <ProfilePage
            user={me}
            email={email}
            hasPassword={hasPassword}
            onBack={() => {
              setView('chat')
              setSelectedId(null)
            }}
          />
        ) : view === 'friends' ? (
          <FriendsPage
            currentUserId={me.id}
            onBack={() => {
              setView('chat')
              setSelectedId(null)
            }}
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
            onBack={() => setSelectedId(null)}
            onAction={(action) => handleConversationAction(selected.id, action)}
          />
        ) : (
          <EmptyState onNewChat={() => setNewChatOpen(true)} />
        )}
      </main>

      {/* Chat info: a third column on wide screens, full screen on smaller ones. */}
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

      <NewChatDialog
        open={newChatOpen}
        currentUserId={me.id}
        onClose={() => setNewChatOpen(false)}
        onCreated={(id) => {
          setNewChatOpen(false)
          openConversation(id)
        }}
      />
    </div>
  )
}

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
}

/** Its own component so each open conversation gets its own message query and send mutation. */
function OpenConversation({
  conversation, me, users, connection, onTyping, onSent, onBack, onAction, detailsOpen, onToggleDetails,
}: OpenConversationProps) {
  const { t } = useLocale()
  const messagesQuery = useMessages(conversation.id, conversation.clearedAt)
  const send = useSendMessage(conversation.id)
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

function useDocumentVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return visible
}
