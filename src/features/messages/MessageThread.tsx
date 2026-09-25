import { ArrowDown } from 'lucide-react'
import { Fragment, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import type { MenuAnchor } from '@/components/ui/Menu'
import { Spinner } from '@/components/ui/Spinner'
import { senderText, tintFor } from '@/lib/avatar'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import type { Conversation, Message, User } from '@/types/chat'
import { DateSeparator } from './DateSeparator'
import { MessageBubble, type RunPosition } from './MessageBubble'
import { MessageMenu, type MessageMenuState } from './MessageMenu'
import { cancelUpload, useMessageActions, useSavedIds } from './queries'
import { ThreadContext, type ThreadContextValue } from './threadContext'
import { TypingBubble } from './TypingIndicator'

/** Ask the thread to scroll to a message; a new `key` repeats the same jump. */
export interface JumpTarget {
  id: string
  key: number
}

interface MessageThreadProps {
  conversation: Conversation
  messages: Message[]
  users: Record<string, User>
  currentUserId: string
  typingUsers: User[]
  onRetry: (message: Message) => void
  onOpen?: (message: Message) => void
  hasOlder?: boolean
  loadingOlder?: boolean
  onLoadOlder?: () => void
  onReply: (message: Message) => void
  onEdit: (message: Message) => void
  jumpTarget?: JumpTarget
}

/** How close to the bottom still counts as "reading the latest". */
const NEAR_BOTTOM_PX = 120

/**
 * Older messages than the newest this many are skipped by the browser while off
 * screen (content-visibility), so a long history loaded by scrolling up stays
 * fast. The newest ones always render fully, so "jump to the latest" is exact.
 */
const ALWAYS_RENDERED = 60

/** Jumping to an old message loads older pages until it's found, up to this many. */
const MAX_PAGES_FOR_JUMP = 20
const HIGHLIGHT_MS = 2000
/** How long a notice (e.g. "too far back") stays on screen. */
const NOTICE_MS = 3000

/** Consecutive messages from one sender on the same day form a run. */
function runPosition(messages: Message[], i: number, sameDay: (a: string, b: string) => boolean): RunPosition {
  const m = messages[i]
  const prev = messages[i - 1]
  const next = messages[i + 1]
  const joinsPrev = prev && prev.senderId === m.senderId && sameDay(prev.createdAt, m.createdAt)
  const joinsNext = next && next.senderId === m.senderId && sameDay(next.createdAt, m.createdAt)
  if (joinsPrev && joinsNext) return 'middle'
  if (joinsPrev) return 'last'
  if (joinsNext) return 'first'
  return 'single'
}

export function MessageThread({
  conversation,
  messages,
  users,
  currentUserId,
  typingUsers,
  onRetry,
  onOpen,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onReply,
  onEdit,
  jumpTarget,
}: MessageThreadProps) {
  const { t, fmt } = useLocale()
  const scrollRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const previousHeight = useRef(0)
  const [unseen, setUnseen] = useState(0)
  const [menu, setMenu] = useState<MessageMenuState | null>(null)
  const actions = useMessageActions(conversation.id, currentUserId)
  const saved = useSavedIds()
  const isGroup = conversation.isGroup

  const newest = messages.at(-1)
  const oldestId = messages[0]?.id

  function scrollToBottom(smooth = false) {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    setUnseen(0)
  }

  // Older messages were added on top: keep what you were reading in the same place.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && previousHeight.current) el.scrollTop += el.scrollHeight - previousHeight.current
  }, [oldestId])

  // A new message: follow it if you were at the bottom or you sent it; otherwise count it.
  // Runs when the newest message changes, not on every render.
  const newestId = newest?.id
  const onNewMessage = useEffectEvent(() => {
    if (!newest) return
    if (nearBottom.current || newest.senderId === currentUserId) scrollToBottom()
    else setUnseen((n) => n + 1)
  })
  useLayoutEffect(() => {
    onNewMessage()
  }, [newestId])

  // The typing bubble appears at the bottom: keep it in view if you were there.
  useLayoutEffect(() => {
    if (typingUsers.length > 0 && nearBottom.current) scrollToBottom()
  }, [typingUsers.length])

  // Remember the height after every render, for the "older messages" adjustment above.
  useLayoutEffect(() => {
    previousHeight.current = scrollRef.current?.scrollHeight ?? 0
  })

  // Scrolling to the top loads the previous page on its own.
  useEffect(() => {
    const top = topRef.current
    if (!top || !hasOlder) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loadingOlder) onLoadOlder?.()
      },
      { root: scrollRef.current, rootMargin: '200px 0px 0px 0px' },
    )
    observer.observe(top)
    return () => observer.disconnect()
  }, [hasOlder, loadingOlder, onLoadOlder])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    if (nearBottom.current && unseen > 0) setUnseen(0)
  }

  // ---- Jumping to a message: a reply's quote, a pinned message, a search result ----
  // A jump loads older pages until the message turns up; each finished load counts one page.
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages])
  const [jumping, setJumping] = useState<{ id: string; pages: number; waiting: boolean } | null>(null)
  const [highlight, setHighlight] = useState<{ id: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [jumpTargetKey, setJumpTargetKey] = useState<number>()

  const jumpTo = useCallback((id: string) => setJumping({ id, pages: 0, waiting: false }), [])

  // Adjusted while rendering: every step follows from the messages loaded so far.
  if (jumpTarget && jumpTarget.key !== jumpTargetKey) {
    setJumpTargetKey(jumpTarget.key)
    jumpTo(jumpTarget.id)
  } else if (jumping && byId.has(jumping.id)) {
    setJumping(null)
    setHighlight({ id: jumping.id })
  } else if (jumping && jumping.waiting !== Boolean(loadingOlder)) {
    setJumping({ ...jumping, waiting: Boolean(loadingOlder), pages: loadingOlder ? jumping.pages : jumping.pages + 1 })
  } else if (jumping && !loadingOlder && (!hasOlder || jumping.pages >= MAX_PAGES_FOR_JUMP)) {
    setJumping(null)
    setNotice(t.msg.tooFarBack)
  }

  // Not loaded yet: ask for the next older page.
  useEffect(() => {
    if (jumping && !loadingOlder) onLoadOlder?.()
  }, [jumping, loadingOlder, onLoadOlder])

  useEffect(() => {
    if (!highlight) return
    document.getElementById(`msg-${highlight.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const timer = window.setTimeout(() => setHighlight(null), HIGHLIGHT_MS)
    return () => window.clearTimeout(timer)
  }, [highlight])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice])

  // ---- What every bubble needs ----
  const highlightedId = highlight?.id
  const usernames = useMemo(
    () => new Set(conversation.members.flatMap((m) => (m.username ? [m.username.toLowerCase()] : []))),
    [conversation.members],
  )
  const savedIds = saved.data
  const { react } = actions
  const context = useMemo<ThreadContextValue>(
    () => ({
      currentUserId,
      users,
      usernames,
      savedIds: savedIds ?? new Set(),
      byId,
      highlightedId,
      onOpenMenu: (message: Message, anchor: MenuAnchor) => setMenu({ message, anchor }),
      onReact: (message: Message, emoji: string | null) => react.mutate({ message, emoji }),
      onJump: jumpTo,
      onCancelUpload: cancelUpload,
    }),
    [currentUserId, users, usernames, savedIds, byId, highlightedId, react, jumpTo],
  )

  return (
    <ThreadContext value={context}>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-3 py-4 md:px-8"
          role="log"
          aria-live="polite"
        >
          <div className="mx-auto flex max-w-3xl flex-col">
            <div ref={topRef} />
            {hasOlder && (
              <div className="flex justify-center pb-2">
                <button
                  type="button"
                  onClick={onLoadOlder}
                  disabled={loadingOlder}
                  className="inline-flex h-8 items-center gap-2 rounded-full px-3 text-caption font-semibold text-ink-muted hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-45"
                >
                  {loadingOlder && <Spinner />}
                  {t.loadEarlier}
                </button>
              </div>
            )}

            {messages.map((m, i) => {
              const prev = messages[i - 1]
              const newDay = !prev || !fmt.sameDay(prev.createdAt, m.createdAt)
              const position = runPosition(messages, i, fmt.sameDay)
              const out = m.senderId === currentUserId
              const sender = users[m.senderId]
              const startsRun = position === 'single' || position === 'first'
              const endsRun = position === 'single' || position === 'last'
              const offscreenOk = i < messages.length - ALWAYS_RENDERED

              return (
                <Fragment key={m.id}>
                  {newDay && <DateSeparator label={fmt.day(m.createdAt)} />}
                  <div
                    id={`msg-${m.id}`}
                    className={cn(
                      'flex items-end gap-2',
                      !out && 'animate-rise',
                      out ? 'justify-end' : 'justify-start',
                      startsRun && !newDay ? 'mt-3' : 'mt-0.5',
                      offscreenOk && '[contain-intrinsic-size:auto_64px] [content-visibility:auto]',
                    )}
                  >
                    {/* Avatar column beside the last bubble of a received run. */}
                    {!out && (
                      <span className="w-8 shrink-0">
                        {endsRun && sender && (
                          <Avatar id={sender.id} name={sender.name} src={sender.avatarUrl} size="sm" />
                        )}
                      </span>
                    )}
                    <div
                      className={cn(
                        'flex max-w-[82%] flex-col md:max-w-[min(560px,78%)]',
                        out ? 'items-end' : 'items-start',
                      )}
                    >
                      {isGroup && !out && startsRun && sender && (
                        <span className={cn('mb-1 px-1 text-caption font-bold', senderText[tintFor(sender.id)])}>
                          {sender.name}
                        </span>
                      )}
                      <ErrorBoundary
                        fallback={
                          <p className="rounded-2xl bg-surface-sunken px-3 py-2 text-caption text-ink-muted italic">
                            {t.messageUnavailable}
                          </p>
                        }
                      >
                        <MessageBubble
                          message={m}
                          direction={out ? 'out' : 'in'}
                          position={position}
                          onRetry={onRetry}
                          onOpen={onOpen}
                        />
                      </ErrorBoundary>
                    </div>
                  </div>
                </Fragment>
              )
            })}

            {typingUsers.length > 0 && (
              <div className="mt-3 flex items-end gap-2">
                <span className="w-8 shrink-0">
                  <Avatar id={typingUsers[0].id} name={typingUsers[0].name} src={typingUsers[0].avatarUrl} size="sm" />
                </span>
                <TypingBubble name={typingUsers[0].name.split(' ')[0]} />
              </div>
            )}
          </div>
        </div>

        {unseen > 0 && (
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            className="absolute bottom-3 left-1/2 inline-flex h-9 -translate-x-1/2 animate-rise items-center gap-1.5 rounded-full bg-accent px-4 text-caption font-bold text-on-accent shadow-md hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <ArrowDown size={14} strokeWidth={2.5} aria-hidden />
            {t.newMessages(fmt.number(unseen))}
          </button>
        )}

        {notice && (
          <p
            role="status"
            className="absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-ink px-4 py-1.5 text-caption text-canvas shadow-md"
          >
            {notice}
          </p>
        )}
      </div>

      {menu && (
        <MessageMenu
          state={menu}
          conversation={conversation}
          currentUserId={currentUserId}
          users={users}
          saved={savedIds?.has(menu.message.id) ?? false}
          onClose={() => setMenu(null)}
          onReply={onReply}
          onEdit={onEdit}
          onDelete={(message) => actions.remove.mutate(message)}
          onReact={(message, emoji) => actions.react.mutate({ message, emoji })}
          onPin={(message, pinned) => actions.pin.mutate({ message, pinned })}
          onSave={(message, isSaved) => actions.save.mutate({ message, saved: isSaved })}
        />
      )}
    </ThreadContext>
  )
}
