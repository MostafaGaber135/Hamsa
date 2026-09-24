import { Download, FileText, MapPin, Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatBytes, formatDuration } from '@/lib/bidi'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'
import type { Message } from '@/types/chat'
import { saveFile } from './media'
import { STICKERS, isKnownSticker, stickerUrl } from './stickers'

/** Only one voice note plays at a time. */
let playing: HTMLAudioElement | null = null

export function VoicePlayer({ message, out }: { message: Message; out: boolean }) {
  const { t, locale } = useLocale()
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  // WebM recordings often report no duration until fully played, so use the recorded one.
  const durationMs = message.attachment?.durationMs ?? 0

  useEffect(() => {
    const audio = audioRef.current
    return () => {
      if (playing === audio) playing = null
    }
  }, [])

  function toggle() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      if (playing && playing !== audio) playing.pause()
      playing = audio
      audio.play()
    } else {
      audio.pause()
    }
  }

  return (
    // Playback controls keep a left-to-right timeline in every language.
    <div dir="ltr" className="flex w-64 max-w-full items-center gap-3 py-1">
      <button
        type="button"
        onClick={toggle}
        disabled={!message.fileUrl}
        aria-label={isPlaying ? t.rich.pause : t.rich.play}
        className={cn(
          'inline-flex size-10 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-45',
          out ? 'bg-accent text-on-accent' : 'bg-accent-soft text-accent',
        )}
      >
        {isPlaying ? <Pause size={18} fill="currentColor" aria-hidden /> : <Play size={18} fill="currentColor" className="ms-0.5" aria-hidden />}
      </button>
      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={Math.max(1, durationMs)}
          step={100}
          value={Math.min(position, durationMs)}
          aria-label={t.rich.voice}
          aria-valuetext={formatDuration(position, locale)}
          onChange={(e) => {
            const ms = Number(e.target.value)
            setPosition(ms)
            if (audioRef.current) audioRef.current.currentTime = ms / 1000
          }}
          className="h-1.5 w-full cursor-pointer accent-[var(--accent)]"
        />
        <span className="mt-1 block text-meta tabular-nums opacity-80">
          {formatDuration(isPlaying || position > 0 ? position : durationMs, locale)}
        </span>
      </div>
      {message.fileUrl && (
        <audio
          ref={audioRef}
          src={message.fileUrl}
          preload="metadata"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false)
            setPosition(0)
          }}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime * 1000)}
        />
      )}
    </div>
  )
}

export function FileCard({ message, out, onOpen }: { message: Message; out: boolean; onOpen: () => void }) {
  const { t, locale } = useLocale()
  const a = message.attachment
  const extension = a?.name?.split('.').pop()?.toUpperCase().slice(0, 4)
  return (
    <div className="flex w-72 max-w-full items-center gap-3 py-1">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <span
          className={cn(
            'relative inline-flex size-11 shrink-0 items-center justify-center rounded-xl',
            out ? 'bg-surface-raised/70 text-accent' : 'bg-accent-soft text-accent',
          )}
        >
          <FileText size={22} strokeWidth={1.75} aria-hidden />
          {extension && (
            <span className="absolute -bottom-1 rounded bg-accent px-1 text-[9px] leading-3 font-bold text-on-accent">{extension}</span>
          )}
        </span>
        <span className="min-w-0">
          <span dir="auto" className="block truncate text-body font-semibold">{a?.name ?? t.rich.document}</span>
          <span className="block text-meta opacity-75">{formatBytes(a?.size, locale)}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => saveFile(message)}
        disabled={!a?.path}
        aria-label={`${t.rich.download} ${a?.name ?? ''}`}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-focus-ring disabled:opacity-45 dark:hover:bg-white/10"
      >
        <Download size={18} strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  )
}

const TILE = 256
const ZOOM = 15
const BOX = { w: 256, h: 150 }

/** A small OpenStreetMap preview (4 tiles around the point) with a pin, linking to Maps. */
export function LocationCard({ message }: { message: Message }) {
  const { t } = useLocale()
  const lat = message.attachment?.lat ?? 0
  const lng = message.attachment?.lng ?? 0

  const n = 2 ** ZOOM
  const x = ((lng + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  const tx0 = Math.floor(x) - (x % 1 < 0.5 ? 1 : 0)
  const ty0 = Math.floor(y) - (y % 1 < 0.5 ? 1 : 0)
  const px = (x - tx0) * TILE
  const py = (y - ty0) * TILE

  return (
    <a
      href={`https://www.google.com/maps?q=${lat},${lng}`}
      target="_blank"
      rel="noopener noreferrer"
      className="block overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      aria-label={`${t.rich.openInMaps}: ${lat.toFixed(5)}, ${lng.toFixed(5)}`}
    >
      <span className="relative block overflow-hidden bg-surface-sunken" style={{ width: BOX.w, height: BOX.h }}>
        <span className="absolute grid grid-cols-2" style={{ left: BOX.w / 2 - px, top: BOX.h / 2 - py, width: TILE * 2 }}>
          {[0, 1].flatMap((dy) =>
            [0, 1].map((dx) => (
              <img
                key={`${dx}${dy}`}
                src={`https://tile.openstreetmap.org/${ZOOM}/${tx0 + dx}/${ty0 + dy}.png`}
                alt=""
                width={TILE}
                height={TILE}
                loading="lazy"
                draggable={false}
              />
            )),
          )}
        </span>
        <MapPin
          size={34}
          strokeWidth={1.75}
          className="absolute -translate-x-1/2 -translate-y-full fill-danger text-white drop-shadow"
          style={{ left: BOX.w / 2, top: BOX.h / 2 + 4 }}
          aria-hidden
        />
        <span className="absolute end-1 bottom-0.5 rounded bg-white/80 px-1 text-[9px] text-black">© OpenStreetMap</span>
      </span>
      <span className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-body font-semibold">
        <MapPin size={14} strokeWidth={2} aria-hidden />
        {t.rich.openInMaps}
      </span>
    </a>
  )
}

export function StickerView({ id }: { id?: string }) {
  const { t, lang } = useLocale()
  if (!isKnownSticker(id)) return <span className="text-[56px] leading-none">💬</span>
  const sticker = STICKERS.find((s) => s.id === id)!
  return (
    <img
      src={stickerUrl(sticker.id)}
      alt={`${t.rich.sticker}: ${lang === 'ar' ? sticker.ar : sticker.en}`}
      className="size-36 select-none"
      draggable={false}
    />
  )
}
