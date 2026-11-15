<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Design

Before changing anything a person sees, read `DESIGN.md`. It is the design system: principles,
colour and type tokens, shapes, motion presets and the standard components (for example, every
destructive action uses `ConfirmDelete`). Follow it, and update it in the same change whenever you
add or alter a token, component or pattern. Guidance for the agents that write content into the app
lives in `src/lib/mcp/guide.ts` (`guide("design")`); keep it consistent with `DESIGN.md`.

Run `scripts/ui-check.cjs` and look at the screenshots before shipping a visual change.

## Running it locally

A fresh checkout (including a cloud agent container) has no `node_modules`, no database and no
`.env.local`. From the repo root:

```sh
npm ci
# Postgres: in a cloud container it is installed but stopped, and the postgres user has no password.
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres'\""
su postgres -c "createdb subspace"
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/subspace
npm run seed            # demo content; needs an empty database
npm run dev             # http://localhost:3000
```

- Scripts (`seed`, `ui-check`, `test:*`) read `process.env` only, not `.env.local`, so export
  `DATABASE_URL` in the shell that runs them. The app itself reads `.env.local` as well.
- Sign-in password: with `SUBSPACE_PASSWORD` unset, development uses `subspace`, which is also
  what `ui-check` types. If you copy `.env.example` it sets `change-me`; then run the checks with
  `SUBSPACE_PASSWORD=change-me` exported, or delete that line.
- Eight wrong sign-ins in fifteen minutes lock the login with a 429. A mismatched password in
  `ui-check` triggers this fast. Clear it with `psql "$DATABASE_URL" -c "DELETE FROM auth_attempts"`
  (or drop, recreate and reseed the database).
- `npm run typecheck` checks types. Errors under `scripts/` before `npm ci` mean dependencies are
  missing, not that the code is wrong.

## Checking a visual change

`node scripts/ui-check.cjs <outDir>` drives every screen at desktop, tablet and phone sizes against
a running dev server on a freshly seeded database, with `DATABASE_URL` exported so it can restore
dismissed rail modules between sizes. It takes more than ten minutes: start it in the background,
read the screenshots in `<outDir>` as they appear, and wait for the summary line. When you change
behaviour, change the matching assertions in it in the same commit.

## Lessons

When something costs you time in this repo (a wrong assumption, a setup step that failed, a
convention you broke, a correction from the owner), add one line here in the same change: what
happened and what to do instead. Keep each entry specific and durable; delete entries that stop
being true. Read this list before starting work.

- Claude Code reads `CLAUDE.md`, which only imports this file. Put instructions here, not there.
- The rail has no toggle on wide screens: it docks whenever it has modules. Do not add show/hide
  controls for things that should simply appear when there is content (owner's call, Nov 2026).
- Copying `.env.example` then running `ui-check` failed every login and locked sign-in with a 429.
  See "Running it locally" for the password and how to clear the lock.
- In development React mounts every component twice, so a hook's cleanup runs once on a component
  that carries on living. `useSaver`'s cleanup flush left it stuck and no notes saved under
  `npm run dev` (production was fine). Make cleanups safe to run on a component that stays mounted.
