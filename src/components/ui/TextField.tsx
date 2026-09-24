import { useId, type ComponentProps } from 'react'
import { cn } from '@/lib/cn'

interface TextFieldProps extends ComponentProps<'input'> {
  label: string
  hint?: string
  /** Replaces the hint and marks the field invalid. */
  error?: string
}

/** Sunken field; shows its focus for mouse and keyboard alike (1.5px ring + 4px halo). */
export function TextField({ label, hint, error, className, id, 'aria-describedby': describedBy, ...props }: TextFieldProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const hintId = `${inputId}-hint`
  const message = error ?? hint
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-caption font-semibold text-ink">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(message && hintId, describedBy) || undefined}
        className={cn(
          'h-11 rounded-xl bg-surface-sunken px-3 text-body text-ink ring-inset outline-none placeholder:text-ink-muted',
          'focus:shadow-[0_0_0_4px_var(--accent-soft)] focus:ring-[1.5px] focus:ring-focus-ring',
          'aria-invalid:ring-[1.5px] aria-invalid:ring-danger',
          'read-only:text-ink-muted read-only:focus:shadow-none read-only:focus:ring-0',
          'forced-colors:focus:outline-2 forced-colors:focus:outline-[Highlight]',
          // dir="ltr" fields (email, password) still align with the UI in Arabic.
          'rtl:text-right',
          className,
        )}
        {...props}
      />
      {message && (
        <p id={hintId} className={cn('text-caption', error ? 'text-danger' : 'text-ink-muted')}>
          {message}
        </p>
      )}
    </div>
  )
}
