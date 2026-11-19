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

The `Web` workflow runs the same check, with `typecheck` and `mcp-smoke`, on every push that
touches `src/` or `scripts/`; its screenshots are the `ui-check` artifact.

## The iOS app

`ios/` is the native SwiftUI app for iPhone and iPad (see "The iOS app" in `README.md`). It is the
same product as the web app, and it is kept in step with it by default, without being asked:

- **Every change to the web app is also a change to the iOS app, in the same piece of work.** A new
  or changed screen, control, flow, wording, empty state, design token or pattern in `src/app`,
  `src/components`, `globals.css` or `DESIGN.md`, and any new or changed endpoint or field under
  `/api/v1`, gets its counterpart in `ios/Subspace` (and its UI test in `ios/SubspaceUITests`)
  before the work is called done. Each web screen has a folder of the same name there: `Feed`,
  `Todos`, `Journal`, `Context`, `Following`, `Agents`, `Blocks` (page blocks and markdown), `Shell` (app bar,
  sign-in, rail), `Design` (tokens and shared pieces), `Core` (REST client and models).
- **Before starting any work, check that the app has not fallen behind.** Merge or rebase onto
  `main`, then look at what changed there since the last commit that touched `ios/`
  (`git log -1 --format=%H -- ios/` then `git diff <that>..origin/main --stat -- src DESIGN.md`).
  If the web moved and `ios/` did not, bring the app up to date first, or say plainly in your
  report what is still missing and why.
- If a web change truly has no place in the app (a hover effect, a browser-only fix), say so in
  the commit message rather than leaving it unsaid.
- It follows `DESIGN.md` through `ios/Subspace/Design`: use `Theme` tokens, `.glass`,
  `ConfirmDelete` and the other shared pieces there. The app decodes leniently, so a renamed field
  does not crash it; it silently shows nothing. Check the model in `Core/Models.swift`.

There is no Swift compiler or simulator in a Linux cloud container. The only way to compile and
run the app from there is the `iOS` workflow (`.github/workflows/ios.yml`), which runs on a push
that touches `ios/` or the server side the app depends on (`/api/v1`, `src/lib/core`, the schema,
the seed): read the job log for compile errors and the test summary, and the
`ios-ui-tests-iphone` and `ios-ui-tests-ipad` artifacts for screenshots. Each run takes several minutes of Mac runner time, so
batch changes and re-read Swift carefully before pushing. When you change behaviour, change the
matching UI test in `ios/SubspaceUITests` in the same commit.

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
- iOS CI: a job's log cannot be read until the job ends, so a stalled step looks like silence.
  `ios/scripts/ci-test.sh` runs the tests under a watchdog for that reason; keep it.
- iOS CI: building with `CODE_SIGNING_ALLOWED=NO` made the simulator's UI test runner hang without
  an error. Leave signing at its default for simulator builds.
- iOS UI tests: after sign-in iOS shows "Save Password?" over the app and blocks every tap behind
  it. `signIn()` in `SubspaceUITests/Support.swift` dismisses it; new tests should sign in through it.
- iOS CI screenshots are downloaded from `productionresultssaN.blob.core.windows.net`; the cloud
  environment must allow those hosts or the artifact link fails with a proxy 403.
- Tailwind's `line-clamp-*` sets `display`, so `block` on the same element switches the clamp off
  and the text runs on. Give the element one or the other, and measure the lines in `ui-check`.
- A task waiting in the rail is a button whose name starts "From <name>", the same as that
  person's folder. In `ui-check`, find folders inside the "Lists" navigation or by `data-folder`.
- Do not change files or run heavy commands while `ui-check` is running: one run here doubled a
  typed task and failed five steps that passed on a quiet rerun.
- `Floating` mounts hidden and is placed a frame later, so `autoFocus` on a field inside it does
  nothing and the keys go to whatever was tapped. Focus the field from an effect once it is open
  (see the link field in `Editor.tsx`).
- Stopping `ui-check` with `pkill -f ui-check.cjs` left the run alive without its browser; it kept
  going against the reseeded database and wrote into the same log as the next run. Stop it with
  the task's own stop, confirm with `pgrep -f ui-check` that nothing is left, and give each run
  its own log file.
- iOS UI tests: on a phone the todo folders are one sideways strip whose length depends on the
  weekday (a Monday adds four day folders), so Backlog and Next week can sit off screen and a tap
  or drag on them fails with "Activation point invalid". Reach folders through `folder(_:)` in
  `SubspaceUITests/Support.swift`, which brings one into view first.
- In development React mounts every component twice, so a hook's cleanup runs once on a component
  that carries on living. `useSaver`'s cleanup flush left it stuck and no notes saved under
  `npm run dev` (production was fine). Make cleanups safe to run on a component that stays mounted.
- Reading one task as the owner (`GET /api/v1/todos/<id>`) counts as opening it, and clears any
  rail module that points at it. In `ui-check` and the iOS tests, do not read a follow-up's task
  before the step that checks its module.
- A `Link` to `/todos?open=<id>` from the docked rail does not remount the Todos page when it is
  already showing, so reading the address once on mount missed it. Read it with `useSearchParams`
  (inside a `Suspense`), as the journal does.
- `localeCompare` sorts punctuation such as "~" before digits, so made-up sort keys came out in the
  wrong order (Backlog above Today in "All"). Compare such keys with `<` and `>`.
- `next build` type-checks `scripts/` too, and the iOS workflow builds the server before it runs a
  single test. A name declared twice in `scripts/mcp-smoke.ts` cost a whole run. Run
  `npm run typecheck` after the last edit, not only after the edits under `src/`.
- `scripts/mcp-smoke.ts` expects a freshly seeded database: after a `ui-check` run the agents have
  more than one page of changes waiting and it fails on an unrelated assertion.
- iOS CI: the watchdog in `ios/scripts/ci-test.sh` stops the tests after a fixed time and the job
  then fails with exit code 143, even when every test passed. Three more tests took the suite to
  28 minutes against a 30-minute limit. When you add UI tests, read "Executed N tests ... in S
  seconds" in the job log and keep the limit (and the job's `timeout-minutes`) well above it.
- iOS CI: a failed UI test is run once more before it counts (`-retry-tests-on-failure`), because a
  loaded simulator sometimes cannot launch or quit the app. A test that fails twice is a real
  failure; one that passed on the second go shows in the summary as failed then passed. Tests
  change data, so write each one to cope with its own half-finished first attempt.
- Production reaches Postgres through Neon's pooler, where each statement can land on a different
  server connection. Migrations took a session lock (`pg_advisory_lock`) whose unlock went to
  another connection, so it stayed held and every later server start hung until the host's
  300-second limit (the 504s agents hit on 15 and 17 Nov 2026). Never hold session state across
  statements: use `pg_advisory_xact_lock` inside a transaction. Keep the time limits in
  `src/lib/db.ts`, and test database plumbing through a transaction-mode `pgbouncer`
  (`apt-get update && apt-get install -y pgbouncer`), not only straight against Postgres.
- Postgres hands `jsonb` back with each object's keys reordered (shorter keys first), so comparing
  stored JSON with what was sent by `JSON.stringify` never matches once an object has two keys. A
  rail module with buttons looked "changed" on every refresh and came back after the owner had
  cleared it. Compare with the keys sorted (`canonical` in `src/lib/core/rail.ts`).
- The rail is notifications, by the owner's call (Nov 2026): every module shows one thing to do,
  any button clears it, nothing can be pinned, and what must last is a task ("Later", or `todo`).
  Do not add a way for a module to stay after it has been acted on, or a second block or third
  button "just this once"; the limits in `setModule` are the design.
- Post illustrations were abstract ("three to eight soft shapes", "abstract over literal") and the
  owner found them useless for telling stories apart (Nov 2026). A drawing must show the story's
  actual subject and what happened to it. Keep `guide("illustration")`, "The picture brief" in
  `guide("posting")` and the seeded scenes in `scripts/seed.ts` literal; do not steer them back
  towards mood or metaphor.
- On the owner's Mac (Nov 2026) `npm ci` fails: npm there is pointed at a company package feed
  that lacks some packages (`motion-dom`), and there is no Postgres or Docker. Do not switch
  registry to get round it, and do not print `~/.npmrc`: ask the owner. Only the iOS app can be
  compiled there (`xcodebuild build-for-testing`). For the server, push the branch: the `Web`
  workflow (`.github/workflows/web.yml`) runs `typecheck`, `mcp-smoke` and `ui-check`, each on its
  own seeded database, and names its failures as annotations on the run.
- Without `gh` or a token, GitHub's API answers 60 requests an hour and then refuses for the rest
  of it; polling several branches used that up in minutes. Read a run's public page instead
  (`https://github.com/<owner>/<repo>/actions/runs/<id>`): its status and its annotations are in
  the HTML, and the `Web` workflow writes its failures as annotations for that reason.
- `ui-check` runs in an en-US browser in CI, so a day prints as "Nov 25", not "25 Nov". An
  assertion on a date must accept either order.
- Two checks have each failed once and passed unchanged on the next run (Nov 2026): `ui-check`
  with "journal: a deleted entry is still listed" on one screen size, and `mcp-smoke` on one
  branch. Before chasing a single failure in either, look at whether the next run repeats it; the
  smoke step now names the error that stopped it.
- iOS CI: a failed run used to say only "exit code 65", and the log needs a signed-in session.
  `ios/scripts/ci-test.sh` now writes each failed expectation as an annotation on the run, so it
  can be read on the run's public page. Main's own iPhone job failed this way before (Nov 2026),
  so do not assume a red iPhone job is your change until the annotation names the test.
- SwiftUI: a `Button` whose label is a symbol inside a `.frame` answers taps only on the symbol
  itself unless the label has a `.contentShape`. The idea canvas's round controls looked 40 points
  wide and were tappable on a few; the UI test's tap landed on the canvas behind (it failed on
  iPad and happened to pass on iPhone). Give every such label `.contentShape(Circle())` or
  `Rectangle()`, as the app bar's buttons have.
- iOS UI tests: "Done" also names a key on the keyboard, and the system web viewer's own button is
  "Close" on newer simulators. Recognise the viewer by its bar (`TopBrowserBar`), not by "Done".
- iOS CI: to chase one failing test, commit `ios/only-testing` with one test a line; the job then
  runs only those (a few minutes instead of forty) and says what was on screen at each failure.
  Remove the file before the work is finished.
- `DELETE todos/<id>?forever=1` (and `deleteTodo(..., true)`) removes only a task that is already
  in the bin, and says nothing when it is not. A check that makes a task must delete it twice,
  plainly and then for good; one that did not left a task behind at every screen size and broke
  an unrelated todo step three sizes later.
- The stand-in embedder for tests gave a word two places out of 4096, so a nonsense word still
  "matched" a text of one or two words about one run in ten (sharing one place was half the
  likeness). It now gives each word sixteen. If "a search that found nothing is not recognisable"
  fails again, look at the stand-in before the search.
- When a command chain ends in `git commit && git push`, make the build's own exit status gate it
  (`xcodebuild ... | grep` returns grep's status, so a failed build was committed and pushed once).
