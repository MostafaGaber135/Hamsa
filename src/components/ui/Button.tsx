import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

// Shared focus and disabled rules from the design system's "Interaction states".
export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring forced-colors:focus-visible:outline-[Highlight]'

const base = cn(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-xl text-body font-semibold whitespace-nowrap',
  'transition-[background-color,color,box-shadow,transform] duration-150 ease-out',
  'active:translate-y-px motion-reduce:active:translate-y-0',
  'disabled:pointer-events-none disabled:opacity-45',
  focusRing,
)

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-strong active:bg-accent-strong',
  secondary:
    'bg-surface-raised text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-hover active:bg-surface-pressed',
  ghost: 'text-ink-muted hover:bg-surface-hover hover:text-ink active:bg-surface-pressed',
  danger: 'bg-danger text-on-danger hover:brightness-95 active:brightness-90',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3',
  md: 'h-10 px-4',
  lg: 'h-12 px-5',
}

interface ButtonProps extends ComponentProps<'button'> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
}

export function Button({ variant = 'primary', size = 'md', icon, className, children, ...props }: ButtonProps) {
  return (
    <button type="button" className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {icon}
      {children}
    </button>
  )
}

interface IconButtonProps extends ComponentProps<'button'> {
  /** Required: icon-only buttons have no visible text. */
  label: string
  /** For toggles (e.g. the details panel). Sets aria-pressed. */
  active?: boolean
  size?: 'sm' | 'md'
}

export function IconButton({ label, active, size = 'md', className, children, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        base,
        'rounded-full',
        size === 'md' ? 'size-10' : 'size-8',
        active
          ? 'bg-accent-soft text-accent hover:ring-1 hover:ring-inset hover:ring-accent'
          : 'text-ink-muted hover:bg-surface-hover hover:text-ink active:bg-surface-pressed',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
