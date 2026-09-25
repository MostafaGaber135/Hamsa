import { useSyncExternalStore } from 'react'

/**
 * Hamsa's few pages as real URLs, on the History API. Each screen you open is a
 * history entry, so the browser's (and Android's) Back button steps back through
 * them instead of leaving the app, and a chat can be linked to: /c/<id>.
 */
export type Route =
  | { name: 'home' }
  | { name: 'chat'; id: string }
  | { name: 'friends' }
  | { name: 'profile' }
  | { name: 'share' }
  | { name: 'login' }
  | { name: 'privacy' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseRoute(pathname: string): Route {
  const [first, second] = pathname.split('/').filter(Boolean)
  if (first === 'c' && second && UUID.test(second)) return { name: 'chat', id: second.toLowerCase() }
  if (first === 'friends') return { name: 'friends' }
  if (first === 'profile') return { name: 'profile' }
  if (first === 'share') return { name: 'share' }
  if (first === 'login') return { name: 'login' }
  if (first === 'privacy') return { name: 'privacy' }
  return { name: 'home' }
}

export function pathFor(route: Route): string {
  switch (route.name) {
    case 'home': return '/'
    case 'chat': return `/c/${route.id}`
    default: return `/${route.name}`
  }
}

const NAVIGATE_EVENT = 'hamsa:navigate'
/** Marks history entries Hamsa pushed itself, so "back" knows it can step back within the app. */
const IN_APP = { hamsa: true }

export function navigate(to: Route, { replace = false } = {}) {
  const path = pathFor(to)
  if (path === window.location.pathname) return
  if (replace) window.history.replaceState(window.history.state, '', path)
  else window.history.pushState(IN_APP, '', path)
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
}

/** The in-app back arrow: the previous screen if Hamsa opened this one, otherwise the chat list. */
export function goBack() {
  if ((window.history.state as typeof IN_APP | null)?.hamsa) window.history.back()
  else navigate({ name: 'home' }, { replace: true })
}

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange)
  window.addEventListener(NAVIGATE_EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(NAVIGATE_EVENT, onChange)
  }
}

const currentPath = () => window.location.pathname

/** The current route; re-renders when it changes. */
export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, currentPath)
  return parseRoute(path)
}
