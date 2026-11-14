# Subspace design system

This is the source of truth for how Subspace looks, moves and reads. Anyone changing the app, a
person or a coding agent, reads this first and updates it in the same change whenever a token,
component or pattern is added or altered. Tokens live in `src/app/globals.css`; motion presets in
`src/lib/client.ts`. Agents that write content into Subspace get the matching guidance from the MCP
server (`guide("design")` in `src/lib/mcp/guide.ts`); keep the two in step.

## Principles

1. **Calm.** The app is read in glances between other things. Nothing shouts, nothing competes.
   One accent colour, one emphasis per screen.
2. **Minimal by default, detail on request.** Show the least that carries the point: a title and
   one line. Everything else waits behind a tap and opens in place (rail modules, notes) or
   beside what it belongs to (comments on a post).
3. **Content is the interface.** Words, pictures and the owner's own things, with as little chrome
   as possible. No dividers between rows, no boxes around things that do not need them, no labels
   that restate the obvious.
4. **Soft and physical.** Rounded forms, frosted surfaces over slow pastel light, and motion that
   behaves like an object with a little weight. Close to how Apple's own apps feel.
5. **Things happen where you are.** Confirmations, editors and menus open at the control that
   asked for them. No modal dialogs, no page jumps for small actions.
6. **Immediate and forgiving.** What the owner does shows at once and is saved behind the scenes.
   Destructive actions ask once, in place, and stand down on their own.
7. **Agent and human are both first-class.** What an agent wrote is marked, never hidden, and the
   owner can change anything.

## Colour

Defined as CSS variables on `:root`, with a dark set under `prefers-color-scheme: dark`. Use the
Tailwind names (`text-ink2`, `bg-fill`); never write a raw hex in a component.

| Token | Tailwind | Use |
|---|---|---|
| `--bg` | `bg-bg` | Page background, behind the ambient light |
| `--surface` | `.glass` | Frosted cards and bars (translucent, blurred) |
| `--surface-solid` | `bg-solid` | Opaque surfaces: menus, lifted rows |
| `--ink` | `text-ink` | Primary text |
| `--ink-2` | `text-ink2` | Secondary text: summaries, reasons |
| `--ink-3` | `text-ink3` | Meta text, placeholders, quiet icons |
| `--line` | `border-line` | Hairlines on glass only; never between list rows |
| `--fill` / `--fill-strong` | `bg-fill` / `bg-fill2` | Hover, quiet buttons, inset fields |
| `--accent` / `--accent-soft` | `text-accent` / `bg-accent-soft` | The one accent: active state, links to act on, focus |
| `--danger` | `text-danger` / `bg-danger` | Destructive confirmation and errors only |
| `--warn`, `--good` | `text-[var(--warn)]` | Warnings; positive deltas |
| `--ai`, `--ai-line` | | Marks text an agent wrote in the owner's notes |

Rules: colour carries meaning, not decoration. Red appears only for errors and an armed delete.
A source link or meta line is grey, not accent. Charts use the validated series palette in
`BlockView.tsx`. Everything must hold in dark mode; illustrations are re-tinted, not swapped.

## Type

System font stack (SF Pro on Apple devices), letter-spacing `-0.011em`.

| Role | Size / weight |
|---|---|
| Page title | 30px bold, tracking -0.03em |
| Detail title (a task, a note) | 26px bold |
| Body, list rows, editor | 15 to 16px regular; row titles medium |
| Secondary line | 13.5px, `ink2` |
| Meta line | 12 to 12.5px, `ink3` |
| Small label (rail timing, section heading) | 11.5 to 12.5px medium or semibold |

One or two lines per item in a list; truncate or clamp, never let a row grow tall. Sentence case
everywhere. No all-caps except small section headings.

Long free text inside an opened item (what a followed topic tracks) shows three lines with an
ellipsis and a small accent "Show more" / "Show less" link beneath it. Tapping the text itself opens
it in full for editing.

## Shape, space and surfaces

- Radii: rows and small cards 16px; cards 20 to 22px; large panels 26px; buttons, chips and inputs
  fully round. Nothing has a sharp corner.
- Glass (`.glass`): translucent surface, 28px blur, hairline border, soft shadow. Use it for things
  that float over content: the nav, cards, the composer. Lists of rows sit directly on the page.
- Shadows: `--shadow` at rest, `--shadow-lift` for something picked up or opened.
- Spacing: 4px steps. Row padding about 10px by 12px; cards 16px; panels 24px. Content column
  maxes at about 880px.
- Touch targets are at least 32px, and 36px or more for anything primary on touch.
- The page must never scroll sideways, at any width from 390px up.

## Motion

Motion explains what changed; it is never decoration. Presets are in `src/lib/client.ts`.

| Preset | Values | Use |
|---|---|---|
| `spring` | stiffness 420, damping 36, mass 0.9 | Direct responses: taps, toggles, sheets, the nav indicator |
| `soft` | stiffness 260, damping 30 | Things entering, leaving or resizing: rows, reveals, height |
| `--ease` | cubic-bezier(0.22, 1, 0.36, 1) | CSS transitions (colour, shadow), 0.25 to 0.5s |

Patterns:

- **Reveal in place.** Detail opens by animating height from 0 with `soft` and fading in; it closes
  the same way. One thing open at a time in a list.
- **Enter.** New items fade in and rise 8 to 12px; a first screen may stagger by 25 to 35ms per
  item, capped. Items added later do not replay the stagger.
- **Press.** Buttons scale to about 0.94 to 0.98 on tap with `spring`.
- **Morph, do not swap.** When a control changes role it changes shape: the bin grows into the
  delete pill; the save button grows out of the link field. Avoid cross-fading two different
  controls.
- **Lift.** A dragged row scales to 1.02, gains `--shadow-lift` and a solid surface.
- **Emphasis is rare.** One small flourish at the moment it matters (the bin's shake as it arms).
  Never loop attention-seeking motion.
- **Make room, do not cover.** A panel that opens beside the content slides in from its edge with
  `soft` while the content moves over in the same half second (padding on `main`, `--ease`). On a
  screen too narrow for both it slides over the content from the same edge, with a dimmed veil.
- **Follow.** When one view tracks another (comments tracking the post being read), the old
  content stays until the new is loaded, fades out in about 130ms, and the new fades in over
  300ms from 16px away on the side the owner is moving towards: from below when scrolling down,
  from above when scrolling up. Fetch the neighbours ahead so the wait is rarely seen.
- **Moving pictures.** Video and GIFs play only while they are the clip most in view, one at a
  time, without sound until the owner asks for it. They never start under reduced motion.
- **Ambient.** The backdrop drifts over about a minute per cycle and pauses while the keyboard is
  up (`html[data-typing]`).
- **Reduced motion.** `prefers-reduced-motion` turns durations to near zero. Never make meaning
  depend on an animation.
- Durations feel like 200 to 450ms. Anything slower than half a second is too slow for a response.

## Components and patterns

- **App bar** (`Shell.tsx`): icons only, one glass pill; left on wide screens, bottom on phones.
- **Rows** (todos, links, rail): no dividers; hover fill; title, one secondary line, one meta line.
- **Cards** (`.glass`): feed posts, context nodes, pages.
- **Pictures on a post** (`Pictures` in `feed/page.tsx`): one picture is the rule. Up to six are
  swiped sideways in one frame that takes the first picture's shape; a picture of a clearly
  different shape is shown whole, not cropped. Dots beneath (6px, the current one in accent) say
  how many and which. Arrows appear on hover with a mouse and never on touch. No counters, no
  captions.
- **Clips** (`Clip.tsx`): video files, GIF-like clips and YouTube or Vimeo players, on black in
  an 18px frame. The one most in view plays silently and the rest wait. A video has one control,
  a small sound button bottom right; tapping the video does the same, and the choice carries to
  the next video. A looping clip has no controls and opens the source like a picture. An embedded
  player shows its still until first scrolled to, then uses the player's own controls.
- **Comments** (`CommentsPanel` in `feed/page.tsx`): a 26px glass panel docked on the right from
  768px up, a sheet over the feed below that. The comment button on a post toggles it; the feed
  keeps scrolling and the panel follows the post crossing a line a little above mid-screen, which
  is lifted (`--shadow-lift`) with its comment button in accent. The panel holds one line naming
  the post, the replies, and the reply field pinned at the bottom; a draft stays with its post.
  While it is open it takes the docked rail's place, and the rail returns when it closes. Width
  is `--comments-w`. Use this pattern for any detail that should stay open while a list scrolls.
- **Rail** (`Rail.tsx`): two lines per module (timing, title); expands in place; errors first in
  red, warnings in amber.
- **Confirm delete** (`ConfirmDelete.tsx`): the only way to remove anything. A quiet bin; the
  first tap arms it into a red pill with the action's name; the second tap does it; it disarms
  after 4 seconds, on Escape, or on a tap elsewhere. Use it for every destructive action.
- **Recently deleted** (todos): a deleted task leaves its list at once and waits in a bin for 15
  days, where it can be restored or deleted for good. The bin's entry in the list of folders
  shows only while it holds something. Prefer this pattern, confirm then recoverable, for
  anything the owner wrote themselves.
- **Confirm once more** (`Confirm` in `agents/page.tsx`): for a step that is not a deletion but
  cannot be taken back (switching off an old address, replacing a token or passcode). The button
  turns red and names the consequence; a second tap does it; it calms after three seconds.
  Removing an agent or person, or disconnecting an app, is a deletion and uses Confirm delete.
- **From tag** (`FromTag` in `todos/page.tsx`): an `accent-soft` pill reading "From <name>" on a
  task another person added. Shown on rows outside that person's own list and in the task detail.
- **Waiting tasks in the rail**: a task another person added shows as a rail module labelled
  "From <name>" until it is given a day. It has place buttons (Today, Tomorrow, This week, Open)
  instead of Dismiss, so it cannot be cleared without being placed.
- **Menus and pickers** (`Floating.tsx`): anchored to their control, flip to stay on screen,
  dismiss on outside tap.
- **Editor** (`Editor.tsx`): markdown as you type; agent text marked; blocks are single units.
- **Blocks** (`blocks/BlockView.tsx`): the visual vocabulary for pages, todo notes and rail
  modules. One system; new kinds of structured content become a block, not a one-off layout.
- **Empty states**: one quiet sentence in `ink3`. No illustrations, no calls to action in capitals.
- **Saving**: silent and automatic. No save buttons for text; show the result immediately.

## Writing

Plain words, sentence case, no exclamation marks. Buttons say what they do ("Add a link",
"Stop following"). Errors say what happened and what to do next. Times are relative when recent.

## Checking a change

Run `scripts/ui-check.cjs` (four screen sizes, light and dark, touch and mouse) and look at the
screenshots before shipping. Add a check for any new interaction. Safari on iPad is the primary
device: avoid heavy filters over moving content, and test touch behaviour, not just clicks.
