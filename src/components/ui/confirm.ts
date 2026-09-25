import { createContext, useContext } from 'react'

export interface ConfirmOptions {
  /** The question, e.g. "Leave Book Club? You won't get its messages anymore." */
  message: string
  /** The button that goes ahead, e.g. "Leave group". */
  confirmLabel: string
  /** Red button: for anything that deletes or can't be undone. */
  danger?: boolean
}

export type Confirm = (options: ConfirmOptions) => Promise<boolean>

export const ConfirmContext = createContext<Confirm | null>(null)

/** `if (await confirm({ ... })) doIt()`: Hamsa's own dialog instead of the browser's confirm(). */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return confirm
}
