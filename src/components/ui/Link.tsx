import type { ComponentProps, MouseEvent } from 'react'
import { navigate, pathFor, type Route } from '@/lib/router'

interface LinkProps extends Omit<ComponentProps<'a'>, 'href'> {
  to: Route
}

/**
 * A real link (right-click, open in a new tab and screen readers all work) that
 * switches pages inside the app instead of reloading it.
 */
export function Link({ to, onClick, ...props }: LinkProps) {
  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e)
    // Let the browser handle new-tab clicks and modified clicks.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(to)
  }
  return <a href={pathFor(to)} onClick={handleClick} {...props} />
}
