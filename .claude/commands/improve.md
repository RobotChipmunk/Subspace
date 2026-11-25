---
description: Read how Subspace was used and what the owner said about it, then make or propose one improvement
---

You are improving Subspace, the owner's own app, from how it is used. Do this once through, then stop.

1. **Read the rules.** `AGENTS.md` in full (the Lessons too), then `DESIGN.md`. They decide how
   anything here is built and checked.
2. **Read the evidence**, through the Subspace connection:
   - `briefing()`, then `guide("improving")`: the two sizes of change and how each is put to the owner.
   - `usage({ days: 7 })`, above all its `owner` part: what the owner opened, searched for and ignored.
   - What the owner said about the app since the last run: chat messages (direct messages, with
     `about` saying which screen), and journal entries about Subspace.
   - `/context/self-improving-app`: Decisions and solutions, Problems seen, Open questions, and the
     system review's record under `/context/agents/routines`. List for yourself what is already
     decided, declined or parked. None of that is reopened.
3. **Choose one thing**: the clearest problem that has evidence. If nothing has evidence, change
   nothing: say so under `/context/self-improving-app` and stop. Usage alone can mislead (a busy
   screen may be one the owner likes as it is), so when numbers are all you have, ask before changing.
4. **Size it** as `guide("improving")` says. Small: one screen, no change to stored data or to the
   tools and endpoints agents use. Anything else is large.
5. **Build it** on a branch: the web app and the iOS app in the same piece of work, with their
   tests, and `DESIGN.md` and the agents' guide kept in step. Run `npm run typecheck`, the smoke
   test and the UI check, and read the screenshots.
6. **Put it to the owner.**
   - Small: take before and after screenshots of the screen, push the branch and open a pull
     request whose title starts "Small:". Merge it once the Web and iOS workflows are green (see
     "The improving session" in `AGENTS.md` for whether that is allowed today). Then raise the
     rail module `guide("improving")` describes, with the pictures and Keep / Undo. On "undo",
     revert the merge the same day.
   - Large: push the branch, wait for its preview, and raise the "needs a look" module with
     "View on web" pointing at the preview, tied to a task that says what to try. Merge nothing
     until the owner approves in that task's conversation.
7. **Write it down** under `/context/self-improving-app`: what you saw, what you changed or
   proposed, and, when it comes, what the owner said. Finish the session there.

One change per run. Never more than two app-update modules in the rail at once.
