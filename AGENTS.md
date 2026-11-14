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
