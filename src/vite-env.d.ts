/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  /** Optional: turns on push notifications. */
  readonly VITE_VAPID_PUBLIC_KEY?: string
  /** Optional: the public address, for link previews. */
  readonly VITE_SITE_URL?: string
  /** Optional: turns on error reporting to Sentry. */
  readonly VITE_SENTRY_DSN?: string
  /** Optional: a TURN relay for calls, e.g. "turn:relay.example.com:3478,turns:relay.example.com:443". */
  readonly VITE_TURN_URL?: string
  readonly VITE_TURN_USERNAME?: string
  readonly VITE_TURN_CREDENTIAL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
