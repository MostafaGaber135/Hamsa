import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { formatDuration } from '@/lib/bidi'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import type { useCall } from './useCall'

type Call = ReturnType<typeof useCall>

/** A <video> or <audio> element showing a MediaStream (it can't be set as an attribute). */
function StreamView({
  stream,
  video,
  muted,
  className,
}: {
  stream: MediaStream | null
  video: boolean
  muted?: boolean
  className?: string
}) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  return video ? (
    <video ref={ref} autoPlay playsInline muted={muted} className={className} />
  ) : (
    <audio ref={ref} autoPlay muted={muted} />
  )
}

/** The call timer ticks once a second. */
const TICK_MS = 1000

function useElapsed(startedAt: number | undefined, locale: string) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!startedAt) return
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [startedAt])
  return startedAt ? formatDuration(now - startedAt, locale) : null
}

function RoundButton({
  label,
  onClick,
  tone = 'neutral',
  children,
}: {
  label: string
  onClick: () => void
  tone?: 'neutral' | 'danger' | 'accept' | 'active'
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-14 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
        tone === 'danger' && 'bg-danger text-white hover:brightness-95',
        tone === 'accept' && 'bg-presence text-white hover:brightness-95',
        tone === 'neutral' && 'bg-white/15 text-white hover:bg-white/25',
        tone === 'active' && 'bg-white text-black hover:bg-white/90',
      )}
    >
      {children}
    </button>
  )
}

/** Full-screen while a call rings or runs; a small notice when it ends. */
export function CallOverlay({ call }: { call: Call }) {
  const { t, locale } = useLocale()
  const { state } = call
  const elapsed = useElapsed(state.phase === 'active' ? state.startedAt : undefined, locale)

  if (state.phase === 'idle') return null

  if (state.phase === 'ended') {
    const reasons = {
      ended: t.call.ended,
      declined: t.call.declined,
      noAnswer: t.call.noAnswer,
      failed: t.call.failed,
      busy: t.call.busy,
      needsDevices: t.call.needsDevices,
    }
    return (
      <p
        role="status"
        className="fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-60 mx-auto w-fit max-w-md rounded-2xl bg-ink px-4 py-2.5 text-body text-canvas shadow-lg"
      >
        {reasons[state.reason]}
      </p>
    )
  }

  const { peer, video } = state
  const showVideo = video && (state.phase === 'connecting' || state.phase === 'active')
  const status =
    state.phase === 'incoming'
      ? video
        ? t.call.incomingVideo(peer.name)
        : t.call.incoming(peer.name)
      : state.phase === 'outgoing'
        ? t.call.calling
        : state.phase === 'connecting'
          ? t.call.connecting
          : elapsed

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={status ?? peer.name}
      className="fixed inset-0 z-60 flex flex-col bg-black text-white"
    >
      {showVideo && <StreamView stream={call.remoteStream} video className="absolute inset-0 size-full object-cover" />}
      {/* Voice calls still need the other person's audio playing. */}
      {!showVideo && <StreamView stream={call.remoteStream} video={false} />}

      <div
        className={cn(
          'relative flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center',
          showVideo && 'justify-start',
        )}
      >
        {!showVideo && <Avatar id={peer.id} name={peer.name} src={peer.avatarUrl} size="xl" className="scale-150" />}
        <div className={cn(!showVideo && 'mt-8', showVideo && 'rounded-2xl bg-black/40 px-3 py-1.5')}>
          <p dir="auto" className="text-title-2">
            {peer.name}
          </p>
          <p role="status" className="text-body text-white/75 tabular-nums">
            {status}
          </p>
        </div>
      </div>

      {/* Your own camera, mirrored like a mirror; the other person sees you the right way round. */}
      {showVideo && call.localStream && (
        <StreamView
          stream={call.localStream}
          video
          muted
          className="absolute inset-e-4 top-4 h-40 w-28 -scale-x-100 rounded-2xl object-cover shadow-lg ring-2 ring-white/40 sm:h-48 sm:w-36"
        />
      )}

      <div className="relative flex justify-center gap-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {state.phase === 'incoming' ? (
          <>
            <RoundButton label={t.call.decline} tone="danger" onClick={call.decline}>
              <PhoneOff size={24} strokeWidth={2} />
            </RoundButton>
            <RoundButton label={t.call.accept} tone="accept" onClick={call.accept}>
              {video ? <Video size={24} strokeWidth={2} /> : <Phone size={24} strokeWidth={2} />}
            </RoundButton>
          </>
        ) : (
          <>
            <RoundButton
              label={call.muted ? t.call.unmute : t.call.mute}
              tone={call.muted ? 'active' : 'neutral'}
              onClick={call.toggleMute}
            >
              {call.muted ? <MicOff size={22} strokeWidth={2} /> : <Mic size={22} strokeWidth={2} />}
            </RoundButton>
            {video && (
              <RoundButton
                label={call.cameraOff ? t.call.cameraOn : t.call.cameraOff}
                tone={call.cameraOff ? 'active' : 'neutral'}
                onClick={call.toggleCamera}
              >
                {call.cameraOff ? <VideoOff size={22} strokeWidth={2} /> : <Video size={22} strokeWidth={2} />}
              </RoundButton>
            )}
            <RoundButton label={t.call.hangUp} tone="danger" onClick={call.hangUp}>
              <PhoneOff size={24} strokeWidth={2} />
            </RoundButton>
          </>
        )}
      </div>
    </div>
  )
}
