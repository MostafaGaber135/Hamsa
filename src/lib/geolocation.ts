export type LocationProblem = 'unsupported' | 'denied' | 'deviceOff' | 'unavailable' | 'timeout'

function getPosition(options: PositionOptions) {
  return new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options))
}

/**
 * Where you are. Tries precise first; if that's slow or unavailable (common on laptops
 * with no GPS), falls back to a quicker, less precise fix instead of failing.
 */
export async function locate(): Promise<{ lat: number; lng: number }> {
  if (!('geolocation' in navigator)) throw 'unsupported' satisfies LocationProblem

  let position: GeolocationPosition
  try {
    position = await getPosition({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 })
  } catch (first) {
    const error = first as GeolocationPositionError
    if (error.code === error.PERMISSION_DENIED) throw await explainDenied()
    try {
      position = await getPosition({ enableHighAccuracy: false, timeout: 20_000, maximumAge: 5 * 60_000 })
    } catch (second) {
      const retry = second as GeolocationPositionError
      if (retry.code === retry.PERMISSION_DENIED) throw await explainDenied()
      throw (retry.code === retry.TIMEOUT ? 'timeout' : 'unavailable') satisfies LocationProblem
    }
  }
  return { lat: position.coords.latitude, lng: position.coords.longitude }
}

/**
 * "Denied" has two causes: the site is blocked, or the site is allowed but the
 * operating system's location services are off (Windows and macOS report both the same way).
 */
async function explainDenied(): Promise<LocationProblem> {
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' })
    if (status.state === 'granted') return 'deviceOff'
  } catch {
    // Permissions API missing (older Safari): fall through.
  }
  return 'denied'
}
