/**
 * Error reports (Sentry) and anonymous traffic and speed numbers (Vercel), with
 * nothing personal in them: chat ids are taken out of URLs, query strings are
 * dropped, and no message content, names or IP-based user data are sent.
 */

type Reporter = (error: unknown) => void
let report: Reporter | null = null

/** "/c/<uuid>?x#y" → "/c/[id]": which page, never which chat. */
function anonymousUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin)
    return parsed.origin + parsed.pathname.replace(/\/c\/[^/]+/, '/c/[id]')
  } catch {
    return url
  }
}

/** For Vercel Analytics and Speed Insights: keep the page, not the chat. */
export function anonymousPageView<T extends { url: string }>(event: T): T {
  return { ...event, url: anonymousUrl(event.url) }
}

/**
 * Starts Sentry if VITE_SENTRY_DSN is set. It's loaded after the app, as its own
 * download, so it never slows down opening Hamsa.
 */
export function startErrorMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  import('@sentry/react')
    .then((Sentry) => {
      Sentry.init({
        dsn,
        environment: import.meta.env.MODE,
        // Errors only: no performance tracing, no session replays.
        tracesSampleRate: 0,
        beforeSend(event) {
          if (event.request?.url) event.request.url = anonymousUrl(event.request.url)
          delete event.request?.query_string
          delete event.user
          return event
        },
        beforeBreadcrumb(breadcrumb) {
          // Console output and typed text can contain messages: never send them.
          if (breadcrumb.category === 'console' || breadcrumb.category === 'ui.input') return null
          const url = breadcrumb.data?.url
          if (typeof url === 'string') breadcrumb.data = { ...breadcrumb.data, url: anonymousUrl(url) }
          if (breadcrumb.category === 'navigation') {
            breadcrumb.data = {
              from: anonymousUrl(String(breadcrumb.data?.from ?? '')),
              to: anonymousUrl(String(breadcrumb.data?.to ?? '')),
            }
          }
          return breadcrumb
        },
      })
      report = (error) => Sentry.captureException(error)
    })
    .catch(() => undefined)
}

/** Sends an error that the app caught itself (e.g. in an error boundary). */
export function reportError(error: unknown) {
  report?.(error)
}
