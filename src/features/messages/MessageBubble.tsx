import { Play, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import type { Message } from '@/types/chat'
import { FileCard, LocationCard, StickerView, VoicePlayer } from './MessageContent'
import { MessageStatusIcon } from './MessageStatusIcon'

/** Where the bubble sits in a run of consecutive messages from one sender. */
export type RunPosition = 'single' | 'first' | 'middle' | 'last'

// Hamsa's "tail": the last bubble of a run squares its bottom corner on the sender's side.
// Logical corners (s = start, e = end) mirror automatically in RTL.
const corners = {
  in: { single: 'rounded-es-sm', first: 'rounded-es-sm', middle: 'rounded-ss-sm rounded-es-sm', last: 'rounded-ss-sm rounded-es-sm' },
  out: { single: 'rounded-ee-sm', first: 'rounded-ee-sm', middle: 'rounded-se-sm rounded-ee-sm', last: 'rounded-se-sm rounded-ee-sm' },
} as const

interface MessageBubbleProps {
  message: Message
  direction: 'in' | 'out'
  position: RunPosition
  onRetry?: (message: Message) => void
  /** Opens photos, videos and documents in the viewer. */
  onOpen?: (message: Message) => void
}

export function MessageBubble({ message, direction, position, onRetry, onOpen }: MessageBubbleProps) {
  const { t, fmt, lang } = useLocale()
  const out = direction === 'out'
  const status = out ? message.status : undefined
  const { kind } = message
  const visual = kind === 'image' || kind === 'video'
  const caption = kind !== 'sticker' ? message.content : undefined
  // Photos and videos without a caption show their time on top of the picture.
  const floatingMeta = visual && !caption
  const stickerMeta = kind === 'sticker'

  const meta = (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-meta whitespace-nowrap tabular-nums',
        floatingMeta || stickerMeta
          ? 'rounded-full bg-black/55 px-2 py-0.5 text-white'
          : out ? 'text-bubble-out-meta' : 'text-ink-subtle',
      )}
    >
      <time dateTime={message.createdAt}>{fmt.time(message.createdAt)}</time>
      {status && <MessageStatusIcon status={status} className={floatingMeta || stickerMeta ? 'text-white' : undefined} />}
    </span>
  )

  const media = message.imageUrl ?? message.fileUrl

  return (
    <div className={cn('flex flex-col', out ? 'items-end' : 'items-start')}>
      {kind === 'sticker' ? (
        // Stickers float without a bubble.
        <div className={cn('flex flex-col', out ? 'items-end' : 'items-start', status === 'sending' && 'opacity-62')}>
          <StickerView id={message.content} />
          {/* Under the sticker, so it never covers the sticker's own words. */}
          <span className="-mt-1">{meta}</span>
        </div>
      ) : (
        <div
          className={cn(
            'rounded-2xl',
            corners[direction][position],
            out ? 'bg-bubble-out text-bubble-out-ink' : 'bg-bubble-in text-ink shadow-xs',
            status === 'sending' && 'opacity-62',
            status === 'failed' && 'ring-[1.5px] ring-danger',
          )}
        >
          {/*
            The bubble's shape follows the thread's direction (above); the content follows its own
            language (dir="auto" here), so an English message in Arabic UI keeps its time on the right.
          */}
          <div dir="auto" className={cn('relative', visual || kind === 'location' ? 'p-1' : 'px-3 py-2')}>
            {visual && (
              <button
                type="button"
                onClick={() => onOpen?.(message)}
                disabled={!media}
                className="relative block overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                {kind === 'image' ? (
                  <img
                    src={media}
                    alt=""
                    className="h-[165px] w-[236px] bg-surface-sunken object-cover md:h-[196px] md:w-[280px]"
                  />
                ) : (
                  <>
                    <video
                      src={media ? `${media}#t=0.1` : undefined}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-[165px] w-[236px] bg-black object-cover md:h-[196px] md:w-[280px]"
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

            {kind === 'voice' && <VoicePlayer message={message} out={out} />}
            {kind === 'file' && <FileCard message={message} out={out} onOpen={() => onOpen?.(message)} />}
            {kind === 'location' && <LocationCard message={message} />}

            {caption && (
              <p
                className={cn(
                  'break-words whitespace-pre-wrap',
                  lang === 'ar' ? 'text-message-ar' : 'text-message',
                  kind !== 'text' && 'max-w-[272px] px-2 pt-1.5 pb-1',
                )}
              >
                {caption}
                {/* Invisible spacer so the last line leaves room for the time. */}
                <span aria-hidden className={cn('inline-block', out ? 'w-20' : 'w-14')} />
              </p>
            )}

            <span
              className={cn(
                caption || floatingMeta ? 'absolute' : 'mt-0.5 flex justify-end',
                floatingMeta ? 'end-3 bottom-3' : caption ? 'end-3 bottom-1.5' : '',
              )}
            >
              {meta}
            </span>
          </div>
        </div>
      )}

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
