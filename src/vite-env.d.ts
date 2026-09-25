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
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
