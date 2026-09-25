/**
 * "Mark as read" tokens for push notifications: they allow exactly one thing (marking
 * one chat read for one person) and expire after a week. send-push signs them,
 * notification-action checks them; both use ACTION_SECRET.
 */
const TOKEN_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

export interface ActionClaims {
  /** Conversation id. */
  c: string
  /** User id. */
  u: string
}

const encoder = new TextEncoder()

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const fromBase64url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

function hmacKey(secret: string, usage: 'sign' | 'verify') {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage])
}

export async function signActionToken(secret: string, claims: ActionClaims): Promise<string> {
  const body = base64url(encoder.encode(JSON.stringify({ ...claims, e: Date.now() + TOKEN_DAYS * DAY_MS })))
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), encoder.encode(body)),
  )
  return `${body}.${base64url(signature)}`
}

/** The claims if the signature is right and the token hasn't expired; otherwise null. */
export async function verifyActionToken(secret: string, token: unknown): Promise<ActionClaims | null> {
  if (typeof token !== 'string') return null
  const [body, signature] = token.split('.')
  if (!body || !signature) return null
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret, 'verify'),
      fromBase64url(signature),
      encoder.encode(body),
    )
    if (!valid) return null
    const claims = JSON.parse(new TextDecoder().decode(fromBase64url(body)))
    if (typeof claims?.c !== 'string' || typeof claims?.u !== 'string' || !(claims.e > Date.now())) return null
    return { c: claims.c, u: claims.u }
  } catch {
    return null
  }
}
