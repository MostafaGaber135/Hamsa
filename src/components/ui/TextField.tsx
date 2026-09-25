import { Eye, EyeOff } from 'lucide-react'
import { useId, useState, type ComponentProps } from 'react'
import { cn } from '@/lib/cn'
import { useLocale } from '@/lib/i18n'

interface TextFieldProps extends ComponentProps<'input'> {
  label: string
  hint?: string
  /** Replaces the hint and marks the field invalid. */
  error?: string
}

/**
 * Sunken field; shows its focus for mouse and keyboard alike (1.5px ring + 4px halo).
 * Password fields get an eye button to show or hide what you typed.
 */
export function TextField({
  label,
  hint,
  error,
  className,
  id,
  type,
  'aria-describedby': describedBy,
  ...props
}: TextFieldProps) {
  const { t } = useLocale()
  const autoId = useId()
  const inputId = id ?? autoId
  const hintId = `${inputId}-hint`
  const message = error ?? hint
  const isPassword = type === 'password'
  const [visible, setVisible] = useState(false)

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-caption font-semibold text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type={isPassword && visible ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={cn(message && hintId, describedBy) || undefined}
          className={cn(
            'h-11 w-full rounded-xl bg-surface-sunken px-3 text-body text-ink outline-none ring-inset placeholder:text-ink-muted',
            'focus:shadow-[0_0_0_4px_var(--accent-soft)] focus:ring-[1.5px] focus:ring-focus-ring',
            'aria-invalid:ring-[1.5px] aria-invalid:ring-danger',
            'read-only:text-ink-muted read-only:focus:shadow-none read-only:focus:ring-0',
            'forced-colors:focus:outline-2 forced-colors:focus:outline-[Highlight]',
            // dir="ltr" fields (email, password) still align with the UI in Arabic.
            'rtl:text-right',
            // Room for the eye button on the end side.
            isPassword && 'pe-11 rtl:ps-11 rtl:pe-3',
            className,
          )}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? t.hidePassword : t.showPassword}
            aria-pressed={visible}
            aria-controls={inputId}
            className={cn(
              'absolute top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-muted',
              'hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-focus-ring',
              // The field itself is dir="ltr", so pin the button to the visual end of the UI.
              'right-1.5 rtl:right-auto rtl:left-1.5',
            )}
          >
            {visible ? (
              <EyeOff size={18} strokeWidth={1.75} aria-hidden />
            ) : (
              <Eye size={18} strokeWidth={1.75} aria-hidden />
            )}
          </button>
        )}
      </div>
      {message && (
        <p id={hintId} className={cn('text-caption', error ? 'text-danger' : 'text-ink-muted')}>
          {message}
        </p>
      )}
    </div>
  )
}
