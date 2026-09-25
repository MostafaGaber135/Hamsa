import { useEffect, useState } from 'react'

/** The value, but only after it has stopped changing for `delay` ms. */
const DEFAULT_DELAY_MS = 250

export function useDebounced<T>(value: T, delay = DEFAULT_DELAY_MS): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
