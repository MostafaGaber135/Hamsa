/** The Badging API (installed app icon); quietly does nothing where it isn't supported. */
export function setAppBadge(count: number) {
  const badging = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  const done = count > 0 ? badging.setAppBadge?.(count) : badging.clearAppBadge?.()
  done?.catch(() => undefined)
}
