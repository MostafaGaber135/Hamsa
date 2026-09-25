import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from './Button'

/** How long the button says "Copied" after copying. */
const COPIED_NOTICE_MS = 2000

interface CopyButtonProps {
  text: string
  label: string
  copiedLabel: string
}

/** Copies text (an invite link…) to the clipboard, and says so for a moment. */
export function CopyButton({ text, label, copiedLabel }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function copy() {
    await navigator.clipboard?.writeText(text).catch(() => undefined)
    setCopied(true)
  }

  return (
    <Button
      size="sm"
      onClick={copy}
      icon={
        copied ? <Check size={14} strokeWidth={2} aria-hidden /> : <Copy size={14} strokeWidth={1.75} aria-hidden />
      }
    >
      {copied ? copiedLabel : label}
    </Button>
  )
}
