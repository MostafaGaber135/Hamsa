/** A teal speech bubble with three dots that shrink and fade: a whisper trailing off. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0 text-accent">
      <path
        fill="currentColor"
        d="M16 3C8.8 3 3 8.2 3 14.7c0 3.4 1.6 6.4 4.2 8.6L6 29l6.2-3.1c1.2.3 2.5.5 3.8.5 7.2 0 13-5.2 13-11.7S23.2 3 16 3Z"
      />
      <circle cx="10.5" cy="14.7" r="2.3" fill="var(--on-accent)" />
      <circle cx="16.5" cy="14.7" r="1.8" fill="var(--on-accent)" opacity=".8" />
      <circle cx="21.8" cy="14.7" r="1.3" fill="var(--on-accent)" opacity=".55" />
    </svg>
  )
}
