import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export type PushStatus =
  | 'unsupported' // this browser has no Web Push
  | 'needs-install' // iPhone/iPad: only works after "Add to Home Screen"
  | 'not-configured' // the site has no VAPID key yet
  | 'blocked' // you said no; only the browser settings can undo it
  | 'off'
  | 'on'

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

async function currentSubscription() {
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

export async function getPushStatus(): Promise<PushStatus> {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!supported) return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported'
  if (!VAPID_PUBLIC_KEY) return 'not-configured'
  if (Notification.permission === 'denied') return 'blocked'
  if (Notification.permission !== 'granted') return 'off'
  return (await currentSubscription()) ? 'on' : 'off'
}

function base64UrlToBytes(value: string) {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

async function save(subscription: PushSubscription) {
  const json = subscription.toJSON()
  const { error } = await supabase.rpc('save_push_subscription', {
    sub_endpoint: subscription.endpoint,
    sub_p256dh: json.keys?.p256dh ?? '',
    sub_auth: json.keys?.auth ?? '',
    sub_user_agent: navigator.userAgent,
  })
  if (error) throw error
}

/** Thrown when the browser's own push service can't be reached (Brave, VPNs, ad-blockers…). */
export class PushServiceError extends Error {}

function sameKey(subscription: PushSubscription, key: Uint8Array) {
  const current = subscription.options.applicationServerKey
  if (!current) return false
  const bytes = new Uint8Array(current)
  return bytes.length === key.length && bytes.every((b, i) => b === key[i])
}

/** Asks for permission, subscribes this browser, and saves it for the signed-in user. */
export async function enablePush(): Promise<PushStatus> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off'

  const key = base64UrlToBytes(VAPID_PUBLIC_KEY!.trim())
  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()

  // A subscription made with an older key can't receive pushes signed with the new one.
  if (subscription && !sameKey(subscription, key)) {
    await subscription.unsubscribe()
    subscription = null
  }

  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    } catch (e) {
      // "Registration failed - push service error": the browser couldn't reach its push server.
      if (e instanceof DOMException && e.name === 'AbortError') throw new PushServiceError(e.message)
      throw e
    }
  }

  await save(subscription)
  return 'on'
}

export async function disablePush() {
  const subscription = await currentSubscription()
  if (!subscription) return
  await supabase.rpc('delete_push_subscription', { sub_endpoint: subscription.endpoint })
  await subscription.unsubscribe()
}

/**
 * On sign-in: if this browser already has a subscription, attach it to the account
 * that's signed in now (so a shared computer notifies the right person).
 */
export async function resyncPush() {
  if ((await getPushStatus()) !== 'on') return
  const subscription = await currentSubscription()
  if (subscription) await save(subscription).catch(() => undefined)
}

/** On sign-out: stop this device notifying the account that's leaving. */
export async function detachPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
  const subscription = await currentSubscription().catch(() => null)
  if (subscription) await supabase.rpc('delete_push_subscription', { sub_endpoint: subscription.endpoint })
}