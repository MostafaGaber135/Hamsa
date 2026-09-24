import { cn } from '@/lib/cn'

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-3.5 animate-spin rounded-full border-2 border-line-strong border-t-transparent [animation-duration:0.8s]',
        className,
      )}
    />
  )
}
