import { Ban, MoreHorizontal, Pin, Play, RotateCcw, Star, X } from 'lucide-react'
import { useRef, type PointerEvent } from 'react'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import type { CachedMessage, Message } from '@/types/chat'
import { FileCard, LocationCard, StickerView, VoicePlayer } from './MessageContent'
import { LinkPreviewCard, Reactions, ReplyQuote } from './MessageExtras'
import { MessageStatusIcon } from './MessageStatusIcon'
import { firstLink } from './links'
import { RichText } from './RichText'
import { useThread } from './threadContext'

/** Where the bubble sits in a run of consecutive messages from one sender. */
export type RunPosition = 'single' | 'first' | 'middle' | 'last'

// Hamsa's "tail": the last bubble of a run squares its bottom corner on the sender's side.
// Logical corners (s = start, e = end) mirror automatically in RTL.
const corners = {
  in: { single: 'rounded-es-sm', first: 'rounded-es-sm', middle: 'rounded-ss-sm rounded-es-sm', last: 'rounded-ss-sm rounded-es-sm' },
  out: { single: 'rounded-ee-sm', first: 'rounded-ee-sm', middle: 'rounded-se-sm rounded-ee-sm', last: 'rounded-se-sm rounded-ee-sm' },
} as const

/** Holding a message this long on a touch screen opens its menu. */
const LONG_PRESS_MS = 500

interface MessageBubbleProps {
  message: Message & Pick<CachedMessage, 'progress'>
  direction: 'in' | 'out'
  position: RunPosition
  onRetry?: (message: Message) => void
  /** Opens photos, videos and documents in the viewer. */
  onOpen?: (message: Message) => void
}

export function MessageBubble({ message, direction, position, onRetry, onOpen }: MessageBubbleProps) {
  const { t, fmt, lang } = useLocale()
  const { usernames, savedIds, highlightedId, onOpenMenu, onCancelUpload } = useThread()
  const out = direction === 'out'
  const status = out ? message.status : undefined
  const deleted = Boolean(message.deletedAt)
  const { kind } = message
  const visual = !deleted && (kind === 'image' || kind === 'video')
  const caption = !deleted && kind !== 'sticker' ? message.content : undefined
  const link = kind === 'text' ? firstLink(caption) : undefined
  // Photos and videos without a caption show their time on top of the picture.
  const floatingMeta = visual && !caption
  const stickerMeta = !deleted && kind === 'sticker'
  const uploading = status === 'sending' && message.progress !== undefined
  // Nothing to do with a deleted message, or one that isn't on the server yet.
  const canAct = !deleted && status !== 'sending' && status !== 'failed'
  const percent = Math.round((message.progress ?? 0) * 100)

  // Long press (touch) opens the menu, like right-click does with a mouse.
  const pressTimer = useRef<number | undefined>(undefined)
  function startPress(e: PointerEvent) {
    if (e.pointerType !== 'touch' || !canAct) return
    const { clientX: x, clientY: y } = e
    pressTimer.current = window.setTimeout(() => onOpenMenu(message, { x, y }), LONG_PRESS_MS)
  }
  const endPress = () => window.clearTimeout(pressTimer.current)

  const meta = (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-meta whitespace-nowrap tabular-nums',
        floatingMeta || stickerMeta
          ? 'rounded-full bg-black/55 px-2 py-0.5 text-white'
          : out ? 'text-bubble-out-meta' : 'text-ink-subtle',
      )}
    >
      {message.pinnedAt && <Pin size={11} strokeWidth={2.25} aria-hidden />}
      {savedIds.has(message.id) && <Star size={11} strokeWidth={2.25} aria-label={t.msg.saved} />}
      {message.editedAt && !deleted && <span>{t.msg.edited}</span>}
      <time dateTime={message.createdAt}>{fmt.time(message.createdAt)}</time>
      {status && <MessageStatusIcon status={status} className={floatingMeta || stickerMeta ? 'text-white' : undefined} />}
    </span>
  )

  const media = message.imageUrl ?? message.fileUrl

  return (
    <div
      className={cn('group/bubble relative flex flex-col', out ? 'items-end' : 'items-start')}
      onContextMenu={(e) => {
        if (!canAct) return
        e.preventDefault()
        onOpenMenu(message, { x: e.clientX, y: e.clientY })
      }}
      onPointerDown={startPress}
      onPointerUp={endPress}
      onPointerMove={endPress}
      onPointerCancel={endPress}
    >
      <div className={cn('flex max-w-full items-center gap-1', out ? 'flex-row-reverse' : 'flex-row')}>
        {stickerMeta ? (
          // Stickers float without a bubble.
          <div className={cn('flex flex-col', out ? 'items-end' : 'items-start', status === 'sending' && 'opacity-62')}>
            <StickerView id={message.content} />
            {/* Under the sticker, so it never covers the sticker's own words. */}
            <span className="-mt-1">{meta}</span>
          </div>
        ) : (
          <div
            className={cn(
              'min-w-0 rounded-2xl transition-shadow duration-300',
              corners[direction][position],
              out ? 'bg-bubble-out text-bubble-out-ink' : 'bg-bubble-in text-ink shadow-xs',
              status === 'sending' && !uploading && 'opacity-62',
              status === 'failed' && 'ring-[1.5px] ring-danger',
              highlightedId === message.id && 'ring-2 ring-accent',
            )}
          >
            {/*
              The bubble's shape follows the thread's direction (above); the content follows its own
              language (dir="auto" here), so an English message in Arabic UI keeps its time on the right.
            */}
            <div dir="auto" className={cn('relative', visual || kind === 'location' ? 'p-1' : 'px-3 py-2')}>
              {message.replyToId && !deleted && <ReplyQuote replyToId={message.replyToId} out={out} />}

              {deleted && (
                <p className="flex items-center gap-1.5 text-body italic opacity-70">
                  <Ban size={14} strokeWidth={2} aria-hidden />
                  {t.msg.deleted}
                  <span aria-hidden className={cn('inline-block', out ? 'w-20' : 'w-14')} />
                </p>
              )}

              {visual && (
                <button
                  type="button"
                  onClick={() => onOpen?.(message)}
                  disabled={!media}
                  className="relative block overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  {kind === 'image' ? (
                    <img src={media} alt="" className="h-41.25 w-59 bg-surface-sunken object-cover md:h-49 md:w-70" />
                  ) : (
                    <>
                      <video
                        src={media ? `${media}#t=0.1` : undefined}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-41.25 w-59 bg-black object-cover md:h-49 md:w-70"
                      />
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="inline-flex size-12 items-center justify-center rounded-full bg-black/55 text-white">
                          <Play size={22} fill="currentColor" className="ms-0.5" aria-hidden />
                        </span>
                      </span>
                    </>
                  )}
                  <span className="sr-only">{kind === 'image' ? t.photo : t.rich.video}</span>
                </button>
              )}

              {!deleted && kind === 'voice' && <VoicePlayer message={message} out={out} />}
              {!deleted && kind === 'file' && <FileCard message={message} out={out} onOpen={() => onOpen?.(message)} />}
              {!deleted && kind === 'location' && <LocationCard message={message} />}

              {caption && (
                <p
                  className={cn(
                    'wrap-break-word whitespace-pre-wrap',
                    lang === 'ar' ? 'text-message-ar' : 'text-message',
                    kind !== 'text' && 'max-w-68 px-2 pt-1.5 pb-1',
                  )}
                >
                  <RichText text={caption} usernames={usernames} />
                  {/* Invisible spacer so the last line leaves room for the time (and "edited"). */}
                  <span aria-hidden className={cn('inline-block', message.editedAt ? (out ? 'w-32' : 'w-26') : out ? 'w-20' : 'w-14')} />
                </p>
              )}

              {link && <LinkPreviewCard url={link} out={out} />}

              {uploading && (
                <div className="flex items-center gap-2 px-1 pt-1.5">
                  <span
                    role="progressbar"
                    aria-label={t.msg.uploading(`${percent}%`)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    className="h-1 flex-1 overflow-hidden rounded-full bg-black/10"
                  >
                    <span className="block h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${percent}%` }} />
                  </span>
                  <button
                    type="button"
                    onClick={() => onCancelUpload(message.id)}
                    aria-label={t.msg.cancelUpload}
                    title={t.msg.cancelUpload}
                    className="inline-flex size-6 items-center justify-center rounded-full hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-focus-ring"
                  >
                    <X size={14} strokeWidth={2.25} aria-hidden />
                  </button>
                </div>
              )}

              <span
                className={cn(
                  caption || floatingMeta || deleted ? 'absolute' : 'mt-0.5 flex justify-end',
                  floatingMeta ? 'inset-e-3 bottom-3' : caption || deleted ? 'inset-e-3 bottom-1.5' : '',
                )}
              >
                {meta}
              </span>
            </div>
          </div>
        )}

        {/* The "more" button for mouse and keyboard; touch screens use a long press. */}
        {canAct && (
          <button
            type="button"
            onClick={(e) => onOpenMenu(message, { element: e.currentTarget })}
            aria-label={t.msg.actions}
            aria-haspopup="menu"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted opacity-0 transition-opacity group-hover/bubble:opacity-100 hover:bg-surface-hover focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus-ring pointer-coarse:hidden"
          >
            <MoreHorizontal size={16} strokeWidth={2} aria-hidden />
          </button>
        )}
      </div>

      {!deleted && <Reactions message={message} out={out} />}

      {status === 'failed' && onRetry && (
        <button
          type="button"
          onClick={() => onRetry(message)}
          className="mt-1 inline-flex items-center gap-1 rounded-md px-1 text-caption font-semibold text-danger hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
          <RotateCcw size={12} strokeWidth={2} aria-hidden />
          {t.retry}
        </button>
      )}
    </div>
  )
}
