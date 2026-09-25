## What and why

<!-- What changes, and the problem it solves. Link the issue if there is one. -->

## How it was tested

<!-- Commands run, and what you checked by hand (both languages, light and dark, phone width). -->

## Checklist

- [ ] One focused change; no unrelated refactors or formatting
- [ ] Clear names, small functions; UI separate from data and logic (hooks, `api.ts`, `queries.ts`)
- [ ] No dead code, commented-out code, debug logs or unexplained numbers (named constants)
- [ ] No secrets, and no `.env` files; permissions still enforced (RLS, function checks)
- [ ] Loading, empty, error and offline states handled; accessible and responsive
- [ ] New text in both `en.ts` and `ar.ts`
- [ ] Tests added or updated for new logic and fixed bugs
- [ ] A new migration: `npm run db:schema` and `npm run db:types` run, SQL tests added
- [ ] `npm run format:check`, `lint`, `lint:tailwind`, `lint:unused`, `typecheck`, `test` and `build` pass
- [ ] README updated if setup, scripts or structure changed
