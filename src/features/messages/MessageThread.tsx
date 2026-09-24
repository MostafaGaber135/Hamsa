import { ArrowDown } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Spinner } from '@/components/ui/Spinner'
import { senderText, tintFor } from '@/lib/avatar'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import type { Message, User } from '@/types/chat'
import { DateSeparator } from './DateSeparator'
import { MessageBubble, type RunPosition } from './MessageBubble'
import { TypingBubble } from './TypingIndicator'

interface MessageThreadProps {
  messages: Message[]
  users: Record<string, User>
  currentUserId: string
  isGroup: boolean
  typingUsers: User[]
  onRetry: (message: Message) => void
  hasOlder?: boolean
  loadingOlder?: boolean
  onLoadOlder?: () => void
}

/** How close to the bottom still counts as "reading the latest". */
const NEAR_BOTTOM_PX = 120

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
  messages, users, currentUserId, isGroup, typingUsers, onRetry, hasOlder, loadingOlder, onLoadOlder,
}: MessageThreadProps) {
  const { t, fmt } = useLocale()
  const scrollRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const previousHeight = useRef(0)
  const [unseen, setUnseen] = useState(0)

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
  useLayoutEffect(() => {
    if (!newest) return
    if (nearBottom.current || newest.senderId === currentUserId) scrollToBottom()
    else setUnseen((n) => n + 1)
    // Only when the newest message changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newest?.id])

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

  return (
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

            return (
              <Fragment key={m.id}>
                {newDay && <DateSeparator label={fmt.day(m.createdAt)} />}
                <div
                  className={cn(
                    'flex items-end gap-2',
                    !out && 'animate-rise',
                    out ? 'justify-end' : 'justify-start',
                    startsRun && !newDay ? 'mt-3' : 'mt-0.5',
                  )}
                >
                  {/* Avatar column beside the last bubble of a received run. */}
                  {!out && (
                    <span className="w-8 shrink-0">
                      {endsRun && sender && <Avatar id={sender.id} name={sender.name} src={sender.avatarUrl} size="sm" />}
                    </span>
                  )}
                  <div className={cn('flex max-w-[82%] flex-col md:max-w-[min(560px,78%)]', out ? 'items-end' : 'items-start')}>
                    {isGroup && !out && startsRun && sender && (
                      <span className={cn('mb-1 px-1 text-caption font-bold', senderText[tintFor(sender.id)])}>
                        {sender.name}
                      </span>
                    )}
                    <MessageBubble message={m} direction={out ? 'out' : 'in'} position={position} onRetry={onRetry} />
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
    </div>
  )
}
