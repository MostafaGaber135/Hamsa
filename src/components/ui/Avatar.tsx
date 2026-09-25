import { useState } from 'react'
import { avatarBg, initials, tintFor } from '@/lib/avatar'
import { cn } from '@/lib/cn'

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const sizes: Record<Size, { box: string; text: string; dot: string }> = {
  xs: { box: 'size-6', text: 'text-[10px] font-bold', dot: 'size-2' },
  sm: { box: 'size-8', text: 'text-meta font-bold', dot: 'size-2.5' },
  md: { box: 'size-10', text: 'text-caption font-bold', dot: 'size-3' },
  lg: { box: 'size-12', text: 'text-body font-bold', dot: 'size-3' },
  xl: { box: 'size-18', text: 'text-title-2', dot: 'size-4' },
}

interface AvatarProps {
  id: string
  name: string
  /** Profile photo (e.g. from Google). Falls back to initials if missing or broken. */
  src?: string | null
  size?: Size
  /** Groups are rounded squares, people are circles. */
  group?: boolean
  online?: boolean
  className?: string
}

/**
 * The presence dot is ringed with `--ring`, which the parent sets to the colour of the
 * ground it sits on (e.g. `[--ring:var(--surface-selected)]` on the selected row).
 */
export function Avatar({ id, name, src, size = 'md', group, online, className }: AvatarProps) {
  const s = sizes[size]
  // Remember which URL failed, so a new URL gets a fresh try.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = src && src !== failedSrc

  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      {showImage ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          // Google's photo server refuses some requests that carry a Referer header.
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          className={cn('object-cover', s.box, group ? 'rounded-xl' : 'rounded-full', avatarBg[tintFor(id)])}
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            'inline-flex items-center justify-center text-avatar-ink select-none',
            s.box,
            s.text,
            avatarBg[tintFor(id)],
            group ? 'rounded-xl' : 'rounded-full',
          )}
        >
          {initials(name)}
        </span>
      )}
      {online && (
        <span
          aria-hidden
          className={cn(
            'absolute -inset-e-0.5 -bottom-0.5 rounded-full bg-presence ring-2 ring-(--ring,var(--surface))',
            s.dot,
          )}
        />
      )}
    </span>
  )
}
