/** "Today", "Yesterday", "Monday"… between the messages of different days; it sticks to the top while scrolling. */
export function DateSeparator({ label }: { label: string }) {
  return (
    <div role="separator" aria-label={label} className="sticky top-2 z-10 my-3 flex justify-center">
      <span className="rounded-full bg-surface px-3 py-0.5 text-caption font-semibold text-ink-muted shadow-xs ring-1 ring-line">
        {label}
      </span>
    </div>
  )
}
