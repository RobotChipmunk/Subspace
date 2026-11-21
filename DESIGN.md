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
   beside what it belongs to (comments on a post). What the owner should do next is the one
   thing that never waits behind a tap.
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
- In the iOS app there is no bar under the status bar. Content that scrolls up beneath it blurs
  and fades away, barely at first and completely by the top edge (`softTopEdge`). At rest nothing
  is drawn there: no tint, no line. Do not add a material strip or a navigation bar at the top.
- In the iOS app a web link opens in the viewer inside the app, over whatever is on screen, and
  "Done" returns to where it was tapped. Nothing sends the owner out to the browser.
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
- **Carry.** A lifted row moves freely. Held over a place it can go (a list in the todo folders),
  that place lights up (`.drop-target`: accent on an opaque surface) and the row fades back so the
  target reads clearly; letting go moves it there. Away from the list it stops trading places with
  its neighbours. In a list with sections (the days of a week) another section is such a place
  too: it lights the same way (`.drop-target`) with its heading in accent, and the row lands at
  its end on that day. The week lists show every day still to come as a section, even an empty
  one (a bare heading), so there is always a day to carry a task onto. A day already past, and a whole week in "Later", take nothing. On touch, pulling a row sideways lifts it at once; up or down still scrolls.
- **Add where it lands.** A list without sections ends in one small plus. In a list with sections
  each section that can take a task ends in its own plus, which opens the field there and adds to
  that day ("Any day" keeps it for the week). The same rule as carrying: a day already past and a
  whole week in "Later" have none, so "Later" adds only through its days.
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
  Seven tabs: Feed, Todos, Journal, Ideas, Context, Following, Agents. Targets are 48px; on
  phones they are 40px wide and 44px tall, so the seven and the Now button fit a 360px screen.
- **Rows** (todos, links): no dividers; hover fill; title, one secondary line, one meta line.
  A row that stands for something in another place (a task in a person's list) names that place
  in a word or two at its end, in meta type.
  A task row shows its title, tags, place and the repeat mark only: no mark for having notes and
  no dot for an agent's change since it was last opened (the owner's call, Nov 2026). What an
  agent changed is still highlighted inside the task when it is opened.
- **Cards** (`.glass`): feed posts, context nodes, pages.
- **Pictures on a post** (`Pictures` in `feed/page.tsx`): one picture is the rule. Up to six are
  swiped sideways in one frame that takes the first picture's shape; a picture of a clearly
  different shape is shown whole, not cropped. Dots beneath (6px, the current one in accent) say
  how many and which. Arrows appear on hover with a mouse and never on touch. No counters, no
  captions.
- **Illustrations** (`ArtPanel` in `bits.tsx`): a post with no picture of its own gets one drawn
  as SVG over a pastel backdrop from its palette. It is there so the owner can tell what the story
  is about while scanning, so it shows the story's actual subject and what happened to it (a low
  bridge with its barrier down and a car waiting, at night), simply but recognisably. Flat and
  soft: white bodies, the palette's ink for what defines them, one palette colour where the eye
  should land, the scene filling most of the panel. Never an abstract shape, a metaphor (a
  lightbulb, a rocket, a brain), text, a logo or a face. The rules the illustrator follows are
  `guide("illustration")` in `guide.ts`; the brief a posting agent writes is "The picture brief"
  in `guide("posting")`.
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
- **Bookmarks** (feed): the bookmark on a post that has a source marks it to come back to; it
  fills in accent and stays so until tapped again. Bookmarking also keeps the source in Links, and
  removing the bookmark leaves the link. A quiet bookmark icon in the feed header (no label or surface; `ink3` at rest,
  filled accent on `accent-soft` while on; off by default, held in the address as
  `?view=bookmarked`) narrows the feed to bookmarked posts; a post whose bookmark is removed there
  leaves at once.
- **Rail** (`Rail.tsx`): the owner's notifications, under the heading "Now". Each module is a
  card of its own (18px, `--surface`, hairline, `--shadow`; no blur, since it sits over the moving
  backdrop), 8px apart, errors first, then warnings. It is read in a glance and says what to do:
  - *Closed*: a 36px tile at the front (the module's icon, or a real picture of the thing), a
    timing line, the title clamped to two lines, and exactly one button: the one thing to do.
  - *The tile says what kind of thing it is*: `fill` with an `ink2` icon for something to know,
    `accent-soft` with an accent icon for something that needs the owner (it points at a task),
    amber for a warning, red for an error. The timing line takes the same amber or red. Icons come
    from one fixed set (`RAIL_ICONS` in `core/rail.ts`: plane, bed, package, calendar, money,
    question, key and so on) so the web and the iOS app draw the same thing.
  - *The one button* is `accent-soft` with accent text and names what happens ("Get directions",
    "Reconnect", "Open task", "Open page"). A module with nothing to do has a quiet "Got it"
    instead (`fill`, `ink2`), so every module answers "what do I do with this?".
  - *Opened* (a tap on the card; one open at a time; `--shadow-lift`): one sentence, at most one
    compact block, its other buttons as quiet pills, then a meta line naming the agent, with
    "Later" at its end. Opened is still a glance: nothing scrolls, and nothing more is accepted
    from an agent (see the limits in `core/rail.ts`).
  - *Dismiss* is a small cross at the card's top right: always there on touch, shown under the
    pointer with a mouse.
  There is no toggle: from 1100px the rail docks on its own whenever it has modules and is absent
  when it has none. Docked, its width grows with the screen (`--rail-w`: 28% of the width, from
  308px where it first docks, through 330px on an iPad on its side, to 360px from 1286px), and the
  content gives up exactly that much. Its cards keep 16px from the right edge, the same gap the
  nav keeps from the left. Below 1100px, a Now button with a count appears in the nav
  only while there are modules, and opens the rail as a sheet (360px, or 88% of a narrower screen). A button that leads to another screen of the app closes
  the sheet behind it.
- **Everything in the rail is transient**: a module leaves the moment the owner acts on it. Any
  of its buttons clears it (an action, "Open task", "Open page", "Got it"), and so does opening its
  task from the list, dismissing it, or keeping it for later. It also goes when it runs out and
  while its task is done or deleted. Nothing can be pinned, and a new kind of module does not get
  its own way of staying. What must outlast the rail lives in a task or on a page.
- **A module's notification** (iPhone and iPad) carries the module's own buttons, with their own
  labels, so it can be answered from the lock screen: press and hold the notification. A button
  that sends to the agent asks for the device to be unlocked and leaves the app closed; one that
  opens an address opens the app there. Either clears the module, as in the rail. Tapping the
  notification itself opens the rail. There is nothing to set up and nothing to see in the app.
- **Later** (rail): not now, but not lost. "Later" on an opened module asks one thing in place,
  "Keep as a task for", with Today, Tomorrow and This week sharing one line (and "Cancel"). The
  choice puts the module on that day as a task (a module that already points at a task moves that
  task) and takes it off the rail. Nothing announces it: the choice said where it went.
- **A task from the rail** (`FromRail` in `todos/page.tsx`): a task tied to a module (one an agent
  pointed a module at, or one kept with "Later") carries the module's buttons as quiet pills under
  its date and tags, so the owner can still act once the module has gone. A kept task also says
  whose it was, in secondary type with the agent's avatar: "From Atlas, kept for later". Its notes
  hold what the module said, marked as the agent's text.
- **Follow-ups** (rail and todos): the feed is for reading, so nothing that needs the owner goes
  there. What an agent needs done is a task in the list, tagged, with the detail in its notes, and
  a two-line rail module that points at it. The module's one button is "Open task"; that opens
  the task, and having opened it the module is gone. The task stays until it is finished.
- **Confirm delete** (`ConfirmDelete.tsx`): the only way to remove anything. A quiet bin; the
  first tap arms it into a red pill with the action's name; the second tap does it; it disarms
  after 4 seconds, on Escape, or on a tap elsewhere. Use it for every destructive action.
- **Moving a task** (todos): drag it onto a list in the folders (beside the tasks on a wide
  screen, above them on a phone), or open it and use "Move to". Both offer the same lists. For
  any other day, open it and use the date pill.
- **Recently deleted** (todos): a deleted task leaves its list at once and waits in a bin for 15
  days, where it can be restored or deleted for good. The bin's entry in the list of folders
  shows only while it holds something. Prefer this pattern, confirm then recoverable, for
  anything the owner wrote themselves.
- **Confirm once more** (`Confirm` in `agents/page.tsx`): for a step that is not a deletion but
  cannot be taken back (replacing a token or passcode). The button
  turns red and names the consequence; a second tap does it; it calms after three seconds.
  Removing an agent or person, or disconnecting an app, is a deletion and uses Confirm delete.
- **Ideas** (`ideas/page.tsx`; `Ideas/` in the app): a place to let an idea grow, and the one
  screen that is a canvas rather than a list. It is a visual ideation space, not a tool: calm,
  nearly empty of controls, and worked with the hands.
  - *The shelf.* Ideas as 26px glass cards, three across (two on a tablet or phone), each topped
    by a small picture of its canvas: a dot where every piece sits, the owner's in `ink`, the
    agents' in `accent`. Beneath, the idea's name and a meta line ("Grew 2h ago · 9 pieces"); an
    accent dot beside the name when agents have added something not yet looked at. The first
    cell is the dashed "New idea".
  - *The canvas.* The whole screen, over a faint field of dots that moves and scales with it.
    Drag to move about; pinch, or scroll with ctrl, to zoom. Glass pills float at the top: the
    way back and the idea's name at the left; add a picture, Growing or Resting, and remove at
    the right. Nothing else is on screen until a piece is touched.
  - *The owner's pieces* have no container. Words sit bare in the rounded face (`.idea-hand`,
    `design: .rounded`), centred, in one of four sizes (15, 20, 30, 46px), so they read as
    written rather than typeset. Pictures have 20px corners, a soft shadow, and a tilt of a
    degree or so that is always the same for the same picture.
  - *Agents' pieces* are 236px containers with 20px corners in that agent's own quiet tint (its
    palette's first colour at about a quarter strength over `surface`, with a hairline of the
    same), so who added what is seen without reading. Inside: the avatar and name in meta type
    with a one-word kind (riff, found, but, ?), then a line or two at 14.5px, then the source as
    a quiet link when it was something found. A piece arrives by growing from 70% with `spring`.
  - *Joins* are soft curves, 1.8px with round ends, each bowed to one side by an amount that
    never changes for that join, stopping short of the pieces they connect. An agent's join is
    dotted in `ink3` and may carry two or three words in small italics; the owner's own are solid
    `accent`. Never straight, never arrowed.
  - *Gestures.* Double-tap empty space to write there. Drag a piece to move it; drop it on
    another to say they belong together (it returns home and a join is drawn). Double-tap a
    piece to keep it, or, on the owner's own words, to change them. Press and hold for more of
    it. Flick it away to prune it. Each gesture answers at once: a kept piece gains a small
    accent star at its corner; "more" shows a glass pill under the piece naming who was asked; a
    pruned piece flies off the way it was thrown, and "Pruned … Bring back" stays for six
    seconds.
  - *For those who would rather tap.* Choosing a piece (one tap) shows a small glass bar at the
    foot with the same things as icon buttons: keep, more, smaller and larger for the owner's
    words, prune. It is the only toolbar, and it is there only while a piece is chosen.
  - What is new since the owner last looked carries a small accent dot that breathes (still,
    under reduced motion). An empty canvas says how to begin in two lines of `ink3`.
  - *An idea's own life* is said under its name, at the left, as a short column of glass pieces
    that are there only while they are true, and never as a panel or a menu:
    - *Ready to act on.* A 20px glass note: a meta line saying who thinks so ("Scout thinks this
      is ready", or "You have kept enough here to act on" when nobody said it), the first step in
      the rounded face at 15.5px, and two pills, "Make a task" (accent on `accent-soft`) and a
      quiet "Not yet". One tap on the first makes the task; the note goes.
    - *The task made of it.* A 36px glass pill with a small circle (filled accent with a tick
      once done, the title struck through) and the task's title; it opens the task.
    - *Near.* One 36px glass pill for each idea an agent paired with this one: "Near", the other
      idea's name in medium weight, the few words on what they share in small italics (left out on
      a phone), and a small × ("Not related") that takes it away for good. Tapping the name opens
      that idea's canvas in this one's place.
    On a phone the column takes the top of the screen, so the first framing puts the pieces
    beneath it. On the shelf a ready idea's meta line ends "· Ready" in accent, and one an agent's
    find woke says "Woken by Scout" in place of "Grew …" until it has been looked at.
  - *Resting* is never announced. An idea left untouched for a fortnight simply shows "Resting",
    as one the owner put to rest does. Adding to it brings it back, as the Growing switch does.
- **The mark** (`Mark.tsx`; `Design/SubspaceMark.swift` in the app; `scripts/mark.swift` for the
  icons): Subspace's logo is particles in a latent space. A sparse sphere of small neutral
  particles is the space; through it, tilted, runs a sheet of larger coloured ones, the subspace,
  coloured round the six brand hues. Nearer particles are larger and more solid, so it has depth,
  and it turns once a minute (still, under reduced motion). It answers to the mode: on light,
  deep colours with `ink` for the neutral particles; on dark, the pastel hues with a soft glow and
  white for the neutral ones. It is drawn, never a picture, at 140px on the sign-in screens. The
  browser icon (`public/icon.svg`) is the same mark, still and with fewer, larger particles, and
  switches with the mode by itself; the iOS app icon has light, dark and tinted versions. The
  geometry lives in three places that must be changed together. Two other directions drawn with
  it, "cloud" and "clusters", are kept as `variant` on the web component and are pictured in
  `design/mark-directions.png` (left to right: the sheet, the cloud, the clusters).
- **Current** (`CurrentShelf` and the end-day row in `context/page.tsx`; `ContextCurrent.swift` in
  the app): what is true for now, between the rail and long-term context. At the top of Context,
  under a small capitals heading "Current", the notes under the Current section sit two across
  (one on a phone) as 20px glass cards: title, two lines of summary, and a meta line with the
  avatar and name of whoever set it and "until 30 Nov". A note past its day stays, at 60%
  opacity, reading "ended 12 Nov", until its writer renews or archives it. Opened, a note that
  has an end day, and any note under Current, shows it beneath the "Updated by" line as a date
  pill ("Until 30 Nov"; the system date picker in the app) with a small x to take the day off.
  The group is absent when there is nothing current. Agents write these unasked, so who set each
  one is always shown.
- **House rules and proposals** (`Proposals` in `context/page.tsx`; `ContextProposals.swift` in the
  app): System is an ordinary top-level section of Context that holds the house rules. The owner
  edits it like any note. An agent's change to it does not happen: it waits as a proposal, asked
  in the rail (a module with "Approve" and "Decline", which send the answer) and shown at the top
  of Context and of System as a glass card, 22px. The card says who proposes what in secondary
  type with the agent's avatar ("Scout proposes a change to “Quiet hours”"), then the agent's one
  sentence of why in 15.5px medium, then the change in a `fill` box, then "Read the rule as it
  would be" to see the whole note, then Approve (accent-soft) and Decline (fill). Answering in
  either place does the same thing and clears both. Nothing shows when nothing is waiting: there
  is no empty state and no count.
- **Answers sent to an agent** (`Sent` in `agents/page.tsx`; `AgentsRows.swift` in the app): what
  the owner has answered an agent from the rail is kept as a record on the Agents screen. Beside
  the agent's name, while any answer has not been read, a quiet `fill` chip says "1 waiting". In
  the agent's open panel, after its connected apps, a `fill` list headed "Your answers" gives
  each one in two lines: the button in quotes and the module it was on, then when, and "waiting
  for Scout" or "Scout has picked it up" in `ink3`. Nothing in it can be tapped. An answer goes
  from the list when the agent removes its module, or after two weeks.
- **Routines** (`Routines` in `agents/page.tsx`; `AgentsRoutines.swift` in the app): in an agent's
  open panel, after Access, a `fill` list headed "Routines", one row per duty that comes round on
  a schedule. A row is the routine's name, one line on what it is, and a line in `ink3` on where
  it stands ("Weekly. Nobody does this yet.", "Weekly. Done by Scout.", "Weekly · next Thu 26
  Nov"), with a switch at its end: on means this agent does it. A routine has one agent, so
  turning it on here takes it from whoever had it. Under a routine this agent does, what it
  reported last time shows in `ink3`. A read-only agent has no switches and a line saying why.
- **An action sent to an agent** (`Module` in `Rail.tsx`, `FromRail` in `todos/page.tsx`;
  `RailView.swift` in the app): a module's button may send the owner's answer back to the agent
  that raised it instead of opening a link. It looks like any other button and carries whatever
  label the agent gave it ("Approve", "Not this", "Shorter"). On a tap the buttons give way, in
  the same place, to one line in `accent`: "Sending" for the moment the server takes, then a tick
  and "Sent to <agent>", which arrives with `spring` and is held 1.6 seconds before the module
  leaves as any other does. That line is the whole acknowledgement: it says the answer has been
  taken, not that the agent has acted, since the agent may not be running. If it could not be
  sent, the buttons come back with one `danger` line, "was not sent. Try again." On the task a
  module became, the buttons that send give way for good to "“Approve” sent to <agent>", followed
  in `ink3` by "waiting for it" or "picked up". Never a spinner, and never a second confirmation.
- **Agent access** (`Access` in `agents/page.tsx`; `AgentsAccess.swift` in the app): in an agent's
  open panel, after its connected apps, a `fill` box headed "Access". First a sentence and a
  switch, "Read only". Then two rows of chips under quiet labels, "The app" (Feed, Todos, Journal,
  Following, Pages, Links, Now) and "Context" (the top-level sections, by title): a chip is
  `accent-soft` with a tick while that part is allowed and `fill2` with `ink3` text while it is
  not. Each change saves at once; there is no Save button. A last line in `ink3` says in plain
  words what the current setting means. An agent with any limit carries a quiet `fill` badge
  beside its name, "Read only" or "Limited", next to the accent "Realtime" and "Illustrator"
  ones. Limits live on the agent, not on a connection, and are enforced by the server
  (`core/access.ts`): what is off does not exist for that agent.
- **From tag** (`FromTag` in `todos/page.tsx`): an `accent-soft` pill reading "From <name>" on a
  task another person added. Shown on rows outside that person's own list and in the task detail.
- **A person's list** (todos, "From <name>"): a category, not a place. It holds every unfinished
  task from that person, with or without a day; giving a task a day adds it to that day and
  leaves it here, with the day at the end of its row. Tasks still waiting for a day come first.
  Moving a task onto the list takes it off its day.
- **Waiting tasks in the rail**: a task another person added shows as a rail module labelled
  "From <name>" until it is given a day. What to do with it is to place it, so its buttons are
  days (Today first, in `accent-soft`, then Tomorrow; opened, also This week and Open). It has no
  dismiss and no "Later", so it cannot be cleared without being placed.
- **Date pill and month calendar** (`DatePicker.tsx`): a quiet pill naming a date (calendar icon,
  "Today", "Thu, Dec 17", "No date"); tapping it drops one month open beneath it on a solid 22px
  panel, in the manner of the iOS picker: month name with accent arrows, a Monday-first grid of
  36px day circles, today in accent, the chosen day filled. Days already past are dimmed and
  cannot be chosen; stepping a month slides the grid the way the owner is moving, and the panel
  keeps one height. Choosing a day closes it and saves at once. Use it wherever a date is set.
  Where a day gone by makes sense (a journal entry's day), `past` lets any day be chosen.
  In the iOS app the pill reveals the system's own graphical date picker in place beneath it.
- **Repeat** (todo detail): a pill beside the date that opens the system menu (Never, Every day,
  Every 3 days, Every week, Every 2 weeks, Every month, Every year); it turns `accent-soft` while set, and one
  meta line beneath says what finishing will do. A repeating row carries a small repeat icon.
- **Next one added** (`NextNote` in `todos/page.tsx`): finishing a repeating task adds the next
  one, counted from the day it was finished, not from its date. The finished task then carries
  one meta line, in its row and in its detail: "Next one added for <day>" with an accent "Open"
  that goes to the new task, where its date can be changed. Unticking takes the next one away
  again. Use this pattern, a quiet line where the action happened, for anything created as a
  side effect.
- **Later** (todos): a list of tasks dated beyond next week, grouped by day. Like the bin, it
  is listed only while it holds something, and nothing is added to it directly.
- **All** (todos): every unfinished task, wherever it is; a view across the lists, set a little
  apart at their end. Its sections run the way the lists do: Today, This week, the days and weeks
  after (named as a date pill names them: "Tomorrow", "Thursday", "Next week"), then Backlog and
  "Waiting for a day". Each section that is a place adds and takes carried tasks like the list it
  stands for; nothing can be carried onto "All" itself.
- **Plans** (`Plan` in `todos/page.tsx`; `TodosPlan.swift` in the app): the owner's priorities as
  a short outline, with the tasks under each. It is a view across the lists, listed with "All",
  and it is where the owner steps back and looks at everything; the day lists stay as they are.
  A priority is a line in 17px semibold; its parts sit under it, set in a little, one level and
  no further. No numbers anywhere, and a line shows nothing at its end but the way to open it: a
  line with no tasks is not marked (the owner had "Nothing yet" taken off, Nov 2026). Tapping a
  line opens its tasks in place, without moving anything sideways: the page keeps room for its
  scrollbar (`scrollbar-gutter: stable` on `.scroll`) so the lists stay put when it grows past
  the window. Its tasks come soonest first. A task there shows where it sits ("Today" in accent, "This week", "Backlog") and
  that word moves it to another list; tapping the task opens it. A task typed under a line goes
  to the backlog: planning is not scheduling. Carrying a task onto another line makes it part of
  that line (the line lights as a list does). Carrying it onto a list in the sidebar gives it that
  list's day, exactly as the word at its end would, and it stays part of its line and under it in
  the plan (the list lights and the row steps back, as when a task is carried between lists; the
  lists it can go to are the "Move to" ones, so not "This week", "Later" or "All"). Let go
  anywhere else it returns, since the order here is the lists' own. In the app the same word also offers the lines, as the system menu.
  An open line's name is a field, like a task's name: tap the words and type, and return or
  leaving it saves. The bin (`ConfirmDelete`, "Remove") sits beside the name while the line is
  open; removing a line leaves its tasks in their lists. With a pointer over a closed line a
  small pencil shows at its end, which opens the line with the name selected. Do not put renaming
  or removing behind a word at the foot of the tasks: it was tried and was not found. Under each priority, after its parts, is the round plus the
  lists use (`PlanAdd`). It adds a task to that priority. Parts are optional and must never look
  required, so "Part" is offered only on request: with a pointer over the plus it grows to say
  "Task" and shows "Part" beside it in `ink3` (the plus itself must not move as it grows: the word
  opens to its right); where nothing can hover the first tap shows the two
  and the second chooses (in the app the plus opens the system menu, "Add a task" first). A part
  has its own "Add a task" field once opened. "Add a priority" is a field at the end of the
  outline. Last, set
  apart, "Not in the plan" holds the tasks that are part of nothing, which is where chores live
  and is never a fault. Do not add counts, progress, colours or a third level.
- **Part of** (todos): a task can be part of one line of the plan. In a list its row names that
  line as the first of its chips, in the same quiet style as a tag, and then shows one tag fewer
  (two chips at most). In the task it is a pill after the repeat pill, with a flag: "Part of"
  in `fill` while it is part of nothing, the line's name in `accent-soft` once it is. It opens the
  system menu of lines, parts set in under their priorities, and is absent while there is no plan.
- **Priority filter** (`PlanFilter` in `todos/page.tsx`): beside the tag filter and built the same
  way, on any list with tasks that are part of the plan: a flag and "Priority" in `ink3`, which
  turn `accent-soft` and name the line once one is chosen. One line at a time; a priority brings
  its parts' tasks with it. The choice follows from list to list like the tags, a task added while
  it is on becomes part of that line, and an empty result says "Nothing for <line> here.".
- **Tags on a task** (`TagPills.tsx`, shared with the journal): in a task they follow the date and
  repeat pills in the same row, as quiet chips with a remove button each, then "Add tag", which
  opens into a field offering the tags tasks already carry (at most six). In a list a task shows
  its first two tags at the end of its row as small `fill` chips with `ink2` text, and "+2" for
  the rest. Never coloured.
- **Hide done** (`HideDone` in `todos/page.tsx`; `TodosHideDone` in the app): at the right of every
  list's heading and of the plan's, before the filters and built like them: an eye and "Hide done"
  in `ink3`, no surface; on, it is `accent-soft` with the eye struck through and says "Done
  hidden". Where the heading is narrow (a phone) it is the eye alone. It is one choice for every
  list and the plan, and unlike the filters it is kept for good, on the device (asked for by the
  owner, Nov 2026). While it is on, a task that is ticked stays where it is, shown as done, for
  three seconds, so the tick is seen to land and a slip can be unticked; then it leaves with the
  rest. Counts and "All done" do not change, and a list whose every task is hidden says
  "Everything here is done.".
- **Tag filter** (`TagFilter` in `todos/page.tsx`): on any list that has tagged tasks, a quiet
  control at the right of the heading: a tag icon and "Tags" in `ink3`, no surface. Tapping it
  drops a menu of that list's tags with counts; each is ticked on and off, and the list shows the
  tasks carrying every ticked one, so each tick narrows it further. While a choice is made the control is `accent-soft` and
  names it, and "Show all" in the menu takes it off. The choice stays until the owner takes
  it off: it follows them from list to list and is still there after a visit to another screen
  (kept for the session, not for good). A list where no task carries the chosen tags still shows
  the control, lit, and says "Nothing tagged <tags> here.", so a choice is never hidden. A task added
  while the list is narrowed takes the chosen tags. On a list with no tagged tasks the control is
  absent. In the iOS app it is the system menu, which stays open while tags are ticked.
- **Journal** (`journal/page.tsx`): the owner's own writing, arranged by time. Under small month
  headings, newest first, each entry is a 22px glass card. It names its day once, at the left
  (the day number, in accent when it is today, over the short weekday; later entries of the same
  day leave it blank), then the title, two lines of what the entry says, and its mood and tags.
  Beneath them come every picture in the entry, never cropped: one is shown whole across the card
  (up to 360px tall, 300px on a phone); several sit in one row at a common height (200px, 160px on
  a phone), each as wide as its shape needs, and the row scrolls sideways, fading at its right
  edge while more wait. Cards lift a little under the pointer.
  An entry opens in place of the list as one 26px glass panel: one row of pills (the date, the
  mood, then the tags and "Tag" to add one, wrapping together) with the bin at its end, then the
  title, the gist, and the editor. Enter in the title moves on to the writing.
- **Mood** (journal, `src/lib/moods.ts`): every entry has one of eleven moods, read from its text
  like its tags, and each mood has a tone. Tone is the only colour a mood gets, as a small dot:
  `--good` for the bright ones, `ink3` for the even ones, `--warn` for the heavy ones. Never a
  face, an emoji or a coloured chip. On an entry the mood is a pill beside the date that opens the
  system menu; choosing one makes it the owner's, and "Let Subspace choose" hands it back.
- **Month at a glance** (journal): under a month's heading, a row of tone dots (one per entry, in
  day order), one meta line ("Mostly reflective · AI, Creativity"), and the month's digest in a
  sentence or two when one has been written. In the list each entry's second line is its gist,
  the one sentence worth remembering, with its mood first among the chips and its pictures
  beneath. The gist shows under an entry's title too. This is the same
  far-to-near reading agents get: months, then a line per entry, then the entry.
- **Tags** (journal): quiet chips, `fill` with `ink2` text, never coloured (`TagPills.tsx`, the
  same component a task uses). On an entry they share
  the top row with the date and mood pills; each chip carries a small remove button, and a "Tag"
  pill after them opens into a field (known tags are
  offered as the owner types; at most six). The app chooses an entry's tags from its text a moment
  after writing stops, and says so in a meta note at the end of that row, "Tagged for you"; once the owner adds or
  removes a tag the line goes and the app leaves them alone. Above the list the same chips, with
  counts, filter it: one at a time, `accent-soft` while chosen, held in the address as `?tag=`.
- **Link previews** (`Editor.tsx`, where `linkPreviews` is on: the journal): an address pasted on
  a line of its own, or given to the link button beside the image button, becomes a preview: the
  page's picture, title, a line about it and its site. It is a `cards` block with one item in the
  `list` layout, not a new component, so it is edited, removed and drawn like any block. A page
  that cannot be read still gets a preview, titled from its address.
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

The feed is for reading: updates and information the owner may or may not get to. Nothing in it
asks them for anything; what needs them is a task with a rail module pointing at it (see
"Follow-ups" above, and `guide("followups")` in `guide.ts`).

A rail module is written like a notification: a timing line of a few words, a title under about
30 characters, and a button that is a plain verb for what happens ("Get directions", never "View"
or "Details"). Opened, it adds one sentence. `guide("rail")` in `guide.ts` tells agents the same,
with an example of each kind.

What agents write stays about the owner's things, never about the agents' own machinery.
Comments under a post are about the story; process notes (sources checked, coverage, syncs,
access restored) go nowhere. A problem in an agent's work surfaces only as a rail error, and only
once it has blocked the work across several spaced-out retries (`guide.ts`, "Errors").

## Checking a change

Run `scripts/ui-check.cjs` (four screen sizes, light and dark, touch and mouse) and look at the
screenshots before shipping. Add a check for any new interaction. Safari on iPad is the primary
device: avoid heavy filters over moving content, and test touch behaviour, not just clicks.
