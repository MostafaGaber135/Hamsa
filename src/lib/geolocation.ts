export type LocationProblem = 'unsupported' | 'denied' | 'deviceOff' | 'unavailable' | 'timeout'

function getPosition(options: PositionOptions) {
  return new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, options),
  )
}

/**
 * Where you are. Tries three times, each more forgiving:
 * 1. precise (GPS / Wi-Fi) for up to 15 s
 * 2. approximate for up to 30 s
 * 3. the last position the device already knows, however old
 * Laptops without GPS often need the second or third step.
 */
export async function locate(): Promise<{ lat: number; lng: number }> {
  if (!('geolocation' in navigator)) throw 'unsupported' satisfies LocationProblem

  const attempts: PositionOptions[] = [
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    { enableHighAccuracy: false, timeout: 30_000, maximumAge: 10 * 60_000 },
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: Infinity },
  ]

  let last: GeolocationPositionError | undefined
  for (const options of attempts) {
    try {
      const position = await getPosition(options)
      return { lat: position.coords.latitude, lng: position.coords.longitude }
    } catch (e) {
      last = e as GeolocationPositionError
      if (last.code === last.PERMISSION_DENIED) throw await explainDenied()
    }
  }
  throw (last?.code === last?.TIMEOUT ? 'timeout' : 'unavailable') satisfies LocationProblem
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
