# Hamsa: notes for Claude

A real-time chat app: React 19 + TypeScript + Vite + Tailwind v4 + TanStack Query, on Supabase
(Postgres with RLS, Realtime broadcast, Storage, Edge Functions). The README has setup, architecture and structure.

## Conventions

- Features live in `src/features/<name>/`: `api.ts` (Supabase calls and data mapping), `queries.ts`
  (TanStack Query hooks and mutations), components, and `use*.ts` hooks for logic. Components don't call Supabase.
- Shared UI in `src/components/ui/`; shared helpers in `src/lib/`. Routing is `src/lib/router.ts` (History API).
- All user-facing text goes through `useLocale()`: add every key to `src/lib/i18n/en.ts` and `ar.ts`.
- No magic numbers: a named constant with a one-line comment. No `?? fallback` that hides a missing value.
- Each module starts with (or its main export carries) a short summary comment.
- No `eslint-disable`: use `useEffectEvent`, stable `useCallback`s, or adjust state while rendering.
- Database changes: a new file in `supabase/migrations/`, then `npm run db:schema` and `npm run db:types`,
  and SQL tests in `supabase/tests/`. Never edit `schema.sql` or `database.generated.ts` by hand.
- Friends only: new one-to-one chats and group members must be friends (enforced in SQL). Profiles are readable
  only by people connected to them; finding people goes through `search_people` (3+ characters, start of a
  username), `people_you_may_know`, or an invite link `/add/<username>`. Never add a query that lists profiles.
- Edge Functions share `supabase/functions/_shared/` (`requireEnv`, `admin`, `cors`, action tokens) and are
  deployed with `npm run functions:deploy`.

## Checks

`npm run format:check`, `lint`, `lint:tailwind`, `lint:unused`, `typecheck`, `typecheck:functions`, `test`,
`build`; `test:db` (Postgres) and `test:e2e` (local Supabase via `db:start`). CI runs them all.
