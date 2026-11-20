"use client";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, Flag, Plus, Repeat as RepeatIcon, Tag as TagIcon, Undo2 } from "lucide-react";
import { AnimatePresence, motion, Reorder, useDragControls } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Avatar } from "@/components/bits";
import { DatePill } from "@/components/DatePicker";
import { Editor } from "@/components/Editor";
import { Floating } from "@/components/Floating";
import { TagPills } from "@/components/TagPills";
import { api, fetcher, soft, spring, useMe, useSaver } from "@/lib/client";
import type { PlanItem } from "@/lib/core/plan";
import type { RailAction } from "@/lib/core/rail";
import type { BinnedTodo, Folder, Repeat, TagCount, Todo } from "@/lib/core/todos";

type Row = Omit<Todo, "notes"> & { has_notes: boolean };
type Folders = { today: string; folders: Folder[]; bin: number; tags?: TagCount[]; plan?: PlanItem[] };
const BIN = "bin";
/** Every task, wherever it is: a view across the lists rather than a place of its own. */
const ALL = "all";
/** The plan: the owner's priorities with the tasks under each. Like "All" it is a view across the lists, not a place. */
const PLAN = "plan";
/** The lists a task can be sent to from a menu: every place but the ones that only show what is elsewhere. */
const movable = (folders: Folder[], guest: string | null) => folders.filter((x) => x.key !== "week" && x.key !== "later" && x.key !== ALL && (!x.guest || x.guest === guest));
/** A line of the plan and, for a priority, its parts: the lines whose tasks count as being under it. */
const planScope = (plan: PlanItem[], id: string) => new Set([id, ...plan.filter((i) => i.parent_id === id).map((i) => i.id)]);

const dayName = (date: string) => new Date(date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" });
const longDate = (date: string) => new Date(date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const shortDate = (date: string) => new Date(date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

const REPEAT_LABELS: [Repeat, string][] = [["daily", "Every day"], ["every_3_days", "Every 3 days"], ["weekly", "Every week"], ["biweekly", "Every 2 weeks"], ["monthly", "Every month"], ["yearly", "Every year"]];

/** On a finished repeating task: one quiet line saying when it comes round again, with a way to open that one. */
function NextNote({ date, today, onOpen, className = "" }: { date: string; today?: string; onOpen: () => void; className?: string }) {
  return (
    <motion.span initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} transition={soft} data-next className={`inline-flex w-full items-center gap-1.5 text-[12.5px] text-ink3 ${className}`}>
      <RepeatIcon size={12} className="flex-none" />
      <span className="min-w-0">Next one added for {placeLabel({ scope: "day", date }, today) || shortDate(date)}</span>
      <button
        onClick={(e) => (e.stopPropagation(), onOpen())}
        onPointerDown={(e) => e.stopPropagation()}
        className="-my-1.5 flex-none rounded-full px-2 py-1.5 font-medium text-accent transition-colors hover:bg-accent-soft"
      >
        Open
      </button>
    </motion.span>
  );
}

/** Where a task on a person's list has been put, in a word or two. Nothing while it still waits for a day. */
function placeLabel(r: Pick<Row, "scope" | "date">, today?: string): string {
  if (r.scope === "backlog") return "Backlog";
  if (r.scope === "guest" || !r.date || !today) return "";
  const days = Math.round((Date.parse(r.date + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 86_400_000);
  if (r.scope === "week") return days <= 0 ? "This week" : days <= 7 ? "Next week" : `Week of ${new Date(r.date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1 && days < 7) return dayName(r.date);
  return shortDate(r.date);
}

/**
 * On a task tied to a rail module (one an agent pointed a module at, or one the owner kept from
 * the rail with "Later"): the module has gone, so its buttons live on here and the owner can
 * still act. A kept task also says whose module it was.
 */
function FromRail({ rail }: { rail: NonNullable<Todo["rail"]> }) {
  const { agent } = useMe();
  const { mutate } = useSWRConfig();
  const by = agent(rail.author);
  // A button that sends an action to the module's agent can still be used from here. Once sent,
  // the buttons that send give way to a line saying so, and whether the agent has picked it up.
  const [sending, setSending] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const sent = rail.sent;
  const buttons: RailAction[] = [...rail.actions.filter((a) => !(a.send && (sent || sending))), ...(rail.page_id ? [{ label: "Open page", url: `/page/${rail.page_id}` }] : [])];
  if (!buttons.length && !(rail.kept && by) && !sent && !sending) return null;
  const cls = "flex h-8 items-center gap-1 whitespace-nowrap rounded-full bg-fill px-3 text-[13px] font-medium text-ink transition-colors hover:bg-fill2";
  const send = async (label: string) => {
    setSending(label);
    setFailed(false);
    try {
      await api(`rail/${rail.id}/action`, { method: "POST", body: { label } });
      await mutate((k) => typeof k === "string" && (k === "rail" || k.startsWith("todos")));
    } catch {
      setFailed(true);
    } finally {
      setSending(null);
    }
  };
  return (
    <div data-from-rail className="ml-[40px] mt-2 flex flex-wrap items-center gap-1.5 text-[13px] text-ink2">
      {rail.kept && by && (
        <span className="mr-1 flex items-center gap-1.5">
          <Avatar agent={by} size={16} /> From {by.name}, kept for later
        </span>
      )}
      {buttons.map((a, i) =>
        a.send || !a.url ? (
          <button key={i} onClick={() => send(a.label)} className={cls}>
            {a.label}
          </button>
        ) : a.url.startsWith("/") ? (
          <Link key={i} href={a.url} className={cls}>
            {a.label}
          </Link>
        ) : (
          <a key={i} href={a.url} {...(a.url.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})} className={cls}>
            {a.label}
            {a.url.startsWith("http") && <ArrowUpRight size={12} className="text-ink3" />}
          </a>
        ),
      )}
      {(sent || sending) && (
        <span role="status" data-rail-sent className={`flex h-8 items-center gap-1.5 font-medium ${sent ? "text-accent" : "text-ink3"}`}>
          {sent ? (
            <>
              <Check size={14} /> “{sent.label}” sent to {by?.name ?? "the agent"}
              <span className="font-normal text-ink3">{sent.picked_up ? "· picked up" : "· waiting for it"}</span>
            </>
          ) : (
            `Sending “${sending}”`
          )}
        </span>
      )}
      {failed && <span role="alert" className="text-danger">Not sent. Try again.</span>}
    </div>
  );
}

/** The small tag on a task that came from a guest ("From Meredith"). */
function FromTag({ id }: { id: string | null }) {
  const { agent } = useMe();
  const g = agent(id);
  if (!g) return null;
  return <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-accent-soft px-2 py-[1px] align-middle text-[11.5px] font-medium text-accent">From {g.name}</span>;
}

/** Where the chosen tags are kept while the owner is elsewhere in the app. */
const FILTER_KEY = "ss_todo_tags";
/** And the line of the plan they are narrowed to. */
const FOCUS_KEY = "ss_todo_plan";

export default function TodosPage() {
  // the address is read (?open=), which needs a boundary above it
  return (
    <Suspense>
      <Todos />
    </Suspense>
  );
}

function Todos() {
  const router = useRouter();
  const wanted = useSearchParams().get("open");
  const [view, setView] = useState("today");
  const [openId, setOpenId] = useState<string | null>(null);
  // the list a carried task is being held over, lit as the place it will land
  const [carry, setCarry] = useState<string | null>(null);
  // the tags the lists are narrowed to. The choice stays until the owner takes it off: across lists, and
  // on leaving this screen and coming back (it is kept for as long as the browser tab is).
  const [filter, setFilterNow] = useState<string[]>([]);
  useEffect(() => {
    try {
      const kept: unknown = JSON.parse(sessionStorage.getItem(FILTER_KEY) ?? "[]");
      if (Array.isArray(kept) && kept.length) setFilterNow(kept.filter((t): t is string => typeof t === "string"));
    } catch {
      // no storage, or something else's value under the key: start with no choice
    }
  }, []);
  const setFilter = (tags: string[]) => {
    setFilterNow(tags);
    try {
      sessionStorage.setItem(FILTER_KEY, JSON.stringify(tags));
    } catch {
      // private windows may refuse; the choice then lasts only while this screen is up
    }
  };
  // the line of the plan the lists are narrowed to, kept the same way
  const [focus, setFocusNow] = useState<string | null>(null);
  useEffect(() => {
    try {
      setFocusNow(sessionStorage.getItem(FOCUS_KEY) || null);
    } catch {
      // no storage: start with no choice
    }
  }, []);
  const setFocus = (id: string | null) => {
    setFocusNow(id);
    try {
      if (id) sessionStorage.setItem(FOCUS_KEY, id);
      else sessionStorage.removeItem(FOCUS_KEY);
    } catch {
      // as above
    }
  };
  // the lines of the plan that are open; kept here so they are still open on coming back from a task
  const [openLines, setOpenLines] = useState<string[]>([]);
  const show = (key: string) => (setView(key), setOpenId(null));

  // The rail links here with ?open=<task id> to show one task, also while this screen is already up.
  useEffect(() => {
    if (wanted) (setOpenId(wanted), router.replace("/todos", { scroll: false }));
  }, [wanted, router]);
  const { data: f } = useSWR<Folders>("todos/folders", fetcher, { refreshInterval: 30_000 });
  const folder = f?.folders.find((x) => x.key === view);

  // If the day rolls over while the app is open, a dated folder may no longer exist.
  useEffect(() => {
    if (f && !folder && view !== BIN && view !== PLAN) setView("today");
    // a line that has left the plan cannot go on narrowing the lists
    if (f && focus && !f.plan?.some((i) => i.id === focus)) setFocus(null);
    // the bin's entry goes away once it is empty; do not strand the owner on a list with no way back
    if (f && view === BIN && !f.bin) setView("today");
  }, [f, folder, view, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto flex max-w-[920px] gap-8 max-md:flex-col max-md:gap-4">
      <aside className="relative z-10 md:w-[200px] md:flex-none md:pt-[70px]">
        <nav className="flex gap-0.5 max-md:-mx-4 max-md:overflow-x-auto max-md:px-4 md:flex-col" aria-label="Lists">
          {f?.folders.map((x, i) => {
            const on = x.key === view;
            const gap = x.key === "next_week" || x.key === ALL || (i === 2 && x.key !== "weekend") || (!!x.guest && !f.folders[i - 1]?.guest);
            return (
              <Fragment key={x.key}>
              <button
                data-folder={x.key}
                data-over={carry === x.key || undefined}
                onClick={() => show(x.key)}
                className={`relative flex h-9 flex-none items-center gap-2 rounded-xl px-3 text-left text-[14.5px] transition-colors ${carry === x.key ? "drop-target font-semibold text-accent" : on ? "font-semibold text-ink" : "text-ink2 hover:text-ink"} ${gap ? "md:mt-3" : ""}`}
              >
                {on && <motion.span layoutId="folder" transition={spring} className="glass absolute inset-0 rounded-xl" />}
                <span className="relative flex-1 whitespace-nowrap">{x.label}</span>
                <motion.span key={x.count} initial={{ scale: 1.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={`relative text-[12.5px] tabular-nums ${on ? "text-accent" : "text-ink3"}`}>
                  {x.count || ""}
                </motion.span>
              </button>
              {/* the plan sits with "All": both look across the lists */}
              {x.key === ALL && (
                <button data-folder={PLAN} onClick={() => show(PLAN)} className={`relative flex h-9 flex-none items-center gap-2 rounded-xl px-3 text-left text-[14.5px] transition-colors ${view === PLAN ? "font-semibold text-ink" : "text-ink2 hover:text-ink"}`}>
                  {view === PLAN && <motion.span layoutId="folder" transition={spring} className="glass absolute inset-0 rounded-xl" />}
                  <span className="relative flex-1 whitespace-nowrap">Plans</span>
                </button>
              )}
              </Fragment>
            );
          })}
          {/* appears only while there is something to bring back */}
          <AnimatePresence initial={false}>
            {(f?.bin ?? 0) > 0 && (
              <motion.button
                key="bin"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => show(BIN)}
                className={`relative flex h-9 flex-none items-center gap-2 rounded-xl px-3 text-left text-[14.5px] transition-colors md:mt-3 ${view === BIN ? "font-semibold text-ink" : "text-ink3 hover:text-ink2"}`}
              >
                {view === BIN && <motion.span layoutId="folder" transition={spring} className="glass absolute inset-0 rounded-xl" />}
                <span className="relative flex-1 whitespace-nowrap">Recently deleted</span>
                <span className={`relative text-[12.5px] tabular-nums ${view === BIN ? "text-accent" : "text-ink3"}`}>{f?.bin}</span>
              </motion.button>
            )}
          </AnimatePresence>
        </nav>
      </aside>

      <section className="relative min-w-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          {openId ? (
            <motion.div key="detail" initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 28 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
              <Detail key={openId} id={openId} backLabel={folder?.label ?? (view === PLAN ? "Plans" : "Back")} folders={f?.folders ?? []} tags={f?.tags ?? []} plan={f?.plan ?? []} today={f?.today} onOpen={setOpenId} onBack={() => setOpenId(null)} />
            </motion.div>
          ) : (
            <motion.div key={"list-" + view} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
              {view === BIN ? (
                <Bin />
              ) : view === PLAN ? (
                <Plan plan={f?.plan} folders={f?.folders ?? []} today={f?.today} open={openLines} onOpenLines={setOpenLines} onOpen={setOpenId} />
              ) : (
                <List view={view} folder={folder} folders={f?.folders ?? []} today={f?.today} filter={filter} onFilter={setFilter} plan={f?.plan ?? []} focus={focus} onFocus={setFocus} onOpen={setOpenId} onCarry={setCarry} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}


/** Deleted tasks, kept for a while so a slip can be undone. Each can be put back or removed for good. */
function Bin() {
  const { data, mutate } = useSWR<{ todos: BinnedTodo[]; keep_days: number }>("todos/bin", fetcher, { refreshInterval: 30_000 });
  const { mutate: globalMutate } = useSWRConfig();
  const after = () => (mutate(), globalMutate((k) => typeof k === "string" && k.startsWith("todos") && k !== "todos/bin"));
  const leave = (id: string) => mutate((cur) => (cur ? { ...cur, todos: cur.todos.filter((t) => t.id !== id) } : cur), false);
  return (
    <div>
      <header className="mb-5 px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.03em]">Recently deleted</h1>
        <p className="mt-0.5 text-[14px] text-ink2">Kept for {data?.keep_days ?? 15} days, then removed for good.</p>
      </header>
      <ul>
        <AnimatePresence initial={false}>
          {data?.todos.map((t) => (
            <motion.li key={t.id} layout="position" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={soft} className="overflow-hidden" data-binned={t.id}>
              <div className="-mx-2 flex items-center gap-2 rounded-2xl px-3 py-[7px]">
                <div className="min-w-0 flex-1">
                  <div className={`break-words text-[16px] text-ink2 ${t.done ? "line-through decoration-[var(--line)]" : ""}`}>{t.title}</div>
                  <div className="text-[12px] text-ink3">{t.days_left === 1 ? "Last day" : `${t.days_left} days left`}</div>
                </div>
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  transition={spring}
                  aria-label={`Restore ${t.title}`}
                  onClick={async () => (leave(t.id), await api(`todos/${t.id}/restore`, { method: "POST" }), after())}
                  className="flex h-8 flex-none items-center gap-1.5 rounded-full bg-fill px-3 text-[13px] font-medium text-ink2 transition-colors hover:bg-fill2 hover:text-ink"
                >
                  <Undo2 size={14} /> Restore
                </motion.button>
                <ConfirmDelete label={`Delete ${t.title} for good`} confirm="Delete for good" size={15} onConfirm={async () => (leave(t.id), await api(`todos/${t.id}?forever=1`, { method: "DELETE" }), after())} />
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {data && !data.todos.length && <p className="px-1 py-10 text-[14.5px] text-ink3">Nothing here.</p>}
    </div>
  );
}

const plusDays = (date: string, n: number) => new Date(Date.parse(date + "T12:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The days a week list always shows as sections, with or without tasks, so a task can be carried
 * onto any of them: today to Sunday in "This week", Monday to Sunday in "Next week", what is left
 * of Saturday and Sunday in "Weekend".
 */
function daySections(view: string, today?: string): string[] {
  if (!today || !(view === "week" || view === "next_week" || view === "weekend")) return [];
  const dow = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7; // Monday is 0
  const monday = plusDays(today, -dow);
  const from = view === "next_week" ? 7 : view === "weekend" ? Math.max(5, dow) : dow;
  const to = view === "next_week" ? 13 : 6;
  return Array.from({ length: to - from + 1 }, (_, i) => plusDays(monday, from + i));
}

/** Where a task added to "Weekend" goes: Saturday, or today when it is already Sunday. */
function weekendDay(today: string): string {
  const d = new Date(today + "T12:00:00Z");
  const dow = d.getUTCDay();
  if (dow !== 0) d.setUTCDate(d.getUTCDate() + (6 - dow));
  return d.toISOString().slice(0, 10);
}

/** How long a finger rests on a task before it lifts for reordering. Shorter than the system's own long-press. */
const HOLD_MS = 260;

/** How far sideways a carried task travels before it stops trading places with its neighbours. */
const AWAY_PX = 48;

/**
 * One task in the list. With a mouse it drags straight away. With a finger, a quick swipe up or
 * down scrolls the page as usual; resting on the row for a moment, or pulling it sideways, lifts
 * it, and from then on the page is held still so the row can travel any distance. (Safari hands a
 * moving touch to scrolling and cancels the drag unless the page is told to stay put, which is why
 * a row used to move only one place.)
 *
 * A lifted row moves freely. Carried up or down it reorders; carried onto a list in the folders
 * (to the left on a wide screen, above on a phone) it lights that list and moves there on release.
 */
function TodoRow({
  r,
  tag,
  place,
  today,
  dragging,
  away,
  accepts,
  acceptsGroup,
  onCarryGroup,
  onToggle,
  onOpen,
  onOpenNext,
  onCarry,
  onDropped,
}: {
  r: Row;
  tag: boolean;
  /** on a person's list: the day the task has been given, shown quietly at the end of the row */
  place?: string;
  today?: string;
  onOpenNext: (id: string) => void;
  dragging: React.MutableRefObject<boolean>;
  /** true while the carried row has left the list sideways: the list stops reordering under it */
  away: React.MutableRefObject<boolean>;
  accepts: (folder: string) => boolean;
  /** whether the row may be let go on this section of the list it is in (another day of the week) */
  acceptsGroup: (group: string) => boolean;
  onCarryGroup: (group: string | null) => void;
  onToggle: () => void;
  onOpen: () => void;
  onCarry: (folder: string | null) => void;
  onDropped: (folder: string | null, group: string | null) => void;
}) {
  const controls = useDragControls();
  const el = useRef<HTMLLIElement>(null);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number; start: PointerEvent } | null>(null);
  const lifted = useRef(false);
  const over = useRef<string | null>(null);
  const overGroup = useRef<string | null>(null);
  const [up, setUp] = useState(false);
  // how far the carried row has stepped back: 0 in the list, 1 away from it, 2 over a list it can land in
  const [out, setOut] = useState(0);

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    // once a row is lifted, the touch belongs to the drag: no scrolling, no text selection, no callout
    const still = (e: Event) => lifted.current && e.cancelable && e.preventDefault();
    node.addEventListener("touchmove", still, { passive: false });
    node.addEventListener("contextmenu", still);
    return () => {
      node.removeEventListener("touchmove", still);
      node.removeEventListener("contextmenu", still);
    };
  }, []);

  const cancelHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };
  const release = () => {
    cancelHold();
    lifted.current = false;
    setUp(false);
  };
  const lift = (start: PointerEvent) => {
    cancelHold();
    lifted.current = true;
    dragging.current = true;
    setUp(true);
    controls.start(start);
  };

  return (
    <Reorder.Item
      ref={el}
      value={r}
      as="li"
      drag
      dragListener={false}
      dragControls={controls}
      // nothing lies to the right, and travelling there would make the page scroll sideways
      dragConstraints={{ right: 0 }}
      dragElastic={0}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: [1, 0.6, 0.18][out], height: "auto", scale: up ? 1.02 : 1, boxShadow: up ? "var(--shadow-lift)" : "0 0 0 rgba(0,0,0,0)", backgroundColor: up ? "var(--surface-solid)" : "rgba(0,0,0,0)", zIndex: up ? 5 : 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={soft}
      whileDrag={{ scale: 1.02, boxShadow: "var(--shadow-lift)", backgroundColor: "var(--surface-solid)", zIndex: 5 }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("[role=checkbox]") || e.button > 0) return;
        if (e.pointerType === "mouse") return controls.start(e);
        const start = e.nativeEvent;
        cancelHold();
        hold.current = { x: e.clientX, y: e.clientY, start, timer: setTimeout(() => lift(start), HOLD_MS) };
      }}
      onPointerMove={(e) => {
        if (!hold.current) return;
        const dx = Math.abs(e.clientX - hold.current.x);
        const dy = Math.abs(e.clientY - hold.current.y);
        if (Math.hypot(dx, dy) <= 8) return;
        // sideways is never a scroll, so the row can come away at once; up or down is left to the page
        if (dx > dy * 1.5) lift(hold.current.start);
        else cancelHold();
      }}
      onPointerUp={() => {
        const was = lifted.current;
        release();
        // lifted but never moved: nothing was dragged, so drag-end will not fire
        if (was) setTimeout(() => (dragging.current = false), 50);
      }}
      onPointerCancel={release}
      onDragStart={() => (dragging.current = true)}
      onDrag={(e, info) => {
        const at = e as PointerEvent;
        // what lies beneath the carried row, not the row itself (it still sits inside its own section)
        const under = document.elementsFromPoint(at.clientX, at.clientY).filter((n) => !el.current?.contains(n));
        const key = under.map((n) => n.closest("[data-folder]")).find(Boolean)?.getAttribute("data-folder") ?? null;
        const to = key && accepts(key) ? key : null;
        if (to !== over.current) onCarry((over.current = to));
        // within the list: another section (another day) takes the row in, its own section reorders as usual
        const section = to ? null : (under.map((n) => n.closest("[data-group]")).find(Boolean)?.getAttribute("data-group") ?? null);
        const group = section !== null && acceptsGroup(section) ? section : null;
        if (group !== overGroup.current) onCarryGroup((overGroup.current = group));
        away.current = !!to || group !== null || Math.abs(info.offset.x) > AWAY_PX;
        setOut(to ? 2 : away.current ? 1 : 0);
      }}
      onDragEnd={() => {
        const to = over.current;
        const group = overGroup.current;
        over.current = null;
        overGroup.current = null;
        away.current = false;
        setOut(0);
        onCarry(null);
        onCarryGroup(null);
        release();
        setTimeout(() => (dragging.current = false), 50);
        onDropped(to, group);
      }}
      className="todo-row relative -mx-2 flex cursor-grab touch-pan-y select-none items-start gap-3 rounded-2xl px-3 active:cursor-grabbing"
    >
      <button role="checkbox" aria-checked={r.done} aria-label={r.done ? "Mark not done" : "Mark done"} data-on={r.done} onClick={onToggle} onPointerDown={(e) => e.stopPropagation()} className="check mt-[9px]">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 6.2l2.4 2.4 4.6-5" />
        </svg>
      </button>
      <div onClick={() => !dragging.current && onOpen()} className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 py-[9px]">
        <span className={`min-w-0 flex-1 break-words text-[16px] transition-colors duration-300 ${r.done ? "text-ink3 line-through decoration-[var(--line)]" : ""}`}>
          {r.title}
          {tag && <FromTag id={r.guest_id} />}
          {r.done && r.next_id && r.next_date && <NextNote date={r.next_date} today={today} onOpen={() => onOpenNext(r.next_id!)} className="mt-0.5" />}
        </span>
        {/* what it is part of comes first, then its tags; two chips at most, so the row stays quiet */}
        {(!!r.plan || !!r.tags?.length) && (
          <span data-tags className="mt-[4px] flex max-w-[46%] flex-none flex-wrap justify-end gap-1">
            {r.plan && (
              <span data-part-of className="max-w-[150px] truncate rounded-full bg-fill px-2 py-[1px] text-[11.5px] font-medium text-ink2">
                {r.plan}
              </span>
            )}
            {(r.tags ?? []).slice(0, r.plan ? 1 : 2).map((t) => (
              <span key={t} className="max-w-[112px] truncate rounded-full bg-fill px-2 py-[1px] text-[11.5px] font-medium text-ink2">
                {t}
              </span>
            ))}
            {(r.tags?.length ?? 0) > (r.plan ? 1 : 2) && <span className="py-[1px] text-[11.5px] text-ink3">+{r.tags.length - (r.plan ? 1 : 2)}</span>}
          </span>
        )}
        {r.repeat && !r.done && <RepeatIcon size={14} aria-label="Repeats" className="mt-[6px] flex-none text-ink3" />}
        {place && <span data-place className="mt-[4px] flex-none whitespace-nowrap text-[12.5px] text-ink3">{place}</span>}
      </div>
    </Reorder.Item>
  );
}

/** How wide the tag menu is; it hangs from the right edge of its button. */
const TAG_MENU_W = 208;

/**
 * Narrows a list to the tasks carrying a tag, or every one of several. It sits quietly at the
 * right of the list's heading, only on a list that has tagged tasks: a tag icon and the word
 * "Tags", which turn accent and name the choice while one is made. Tapping it opens the tags to
 * choose from; each one ticked narrows the list further.
 */
function TagFilter({ tags, chosen, onChange }: { tags: TagCount[]; chosen: string[]; onChange: (tags: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const on = chosen.length > 0;
  const toggle = (t: string) => onChange(chosen.includes(t) ? chosen.filter((x) => x !== t) : [...chosen, t]);
  return (
    <>
      <button
        ref={btn}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={on ? `Tags: ${chosen.join(", ")}` : "Filter by tag"}
        data-tag-filter
        className={`flex h-8 max-w-[200px] flex-none items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium transition-colors ${on ? "bg-accent-soft text-accent" : open ? "bg-fill text-ink2" : "text-ink3 hover:bg-fill hover:text-ink2"}`}
      >
        <TagIcon size={14} className="flex-none" />
        <span className="truncate">{on ? chosen.join(", ") : "Tags"}</span>
      </button>
      <AnimatePresence>
        {open && (
          <Floating
            anchor={() => {
              const r = btn.current?.getBoundingClientRect();
              return r ? { left: r.right - TAG_MENU_W, top: r.top, bottom: r.bottom } : null;
            }}
            inside={() => btn.current}
            onDismiss={() => setOpen(false)}
          >
            <motion.div role="menu" aria-label="Tags" initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={spring} style={{ width: TAG_MENU_W, transformOrigin: "top right" }} className="menu scroll max-h-[min(360px,60vh)] rounded-2xl p-1.5">
              {tags.map((t) => {
                const picked = chosen.includes(t.tag);
                return (
                  <button key={t.tag} role="menuitemcheckbox" aria-checked={picked} onClick={() => toggle(t.tag)} className="flex min-h-9 w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-[14px] font-medium hover:bg-fill2">
                    <Check size={15} strokeWidth={2.4} className={`flex-none text-accent transition-opacity ${picked ? "" : "opacity-0"}`} />
                    <span className="min-w-0 flex-1 truncate">{t.tag}</span>
                    <span className="text-[12.5px] font-normal tabular-nums text-ink3">{t.count || ""}</span>
                  </button>
                );
              })}
              {on && (
                <button role="menuitem" onClick={() => (onChange([]), setOpen(false))} className="mt-1 flex min-h-9 w-full items-center rounded-xl px-2 py-1.5 pl-[31px] text-left text-[14px] text-ink2 hover:bg-fill2">
                  Show all
                </button>
              )}
            </motion.div>
          </Floating>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * Narrows a list to the tasks that are part of one line of the plan (a priority brings its parts
 * with it). It sits beside the tag filter and behaves the same way: quiet until a choice is made,
 * then accent and named, and the choice follows from list to list. One line at a time.
 */
function PlanFilter({ lines, chosen, onChange }: { lines: PlanItem[]; chosen: string | null; onChange: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const on = lines.find((i) => i.id === chosen);
  return (
    <>
      <button
        ref={btn}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={on ? `Priority: ${on.title}` : "Filter by priority"}
        data-plan-filter
        className={`flex h-8 max-w-[200px] flex-none items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium transition-colors ${on ? "bg-accent-soft text-accent" : open ? "bg-fill text-ink2" : "text-ink3 hover:bg-fill hover:text-ink2"}`}
      >
        <Flag size={14} className="flex-none" />
        <span className="truncate">{on ? on.title : "Priority"}</span>
      </button>
      <AnimatePresence>
        {open && (
          <Floating
            anchor={() => {
              const r = btn.current?.getBoundingClientRect();
              return r ? { left: r.right - PLAN_MENU_W, top: r.top, bottom: r.bottom } : null;
            }}
            inside={() => btn.current}
            onDismiss={() => setOpen(false)}
          >
            <motion.div role="menu" aria-label="Priority" initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={spring} style={{ width: PLAN_MENU_W, transformOrigin: "top right" }} className="menu scroll max-h-[min(360px,60vh)] rounded-2xl p-1.5">
              {lines.map((i) => (
                <button key={i.id} role="menuitemradio" aria-checked={i.id === chosen} onClick={() => (onChange(i.id === chosen ? null : i.id), setOpen(false))} className={`flex min-h-9 w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-[14px] hover:bg-fill2 ${i.parent_id ? "" : "font-medium"}`}>
                  <Check size={15} strokeWidth={2.4} className={`flex-none text-accent transition-opacity ${i.id === chosen ? "" : "opacity-0"}`} />
                  <span className={`line-clamp-2 min-w-0 flex-1 ${i.parent_id ? "pl-3" : ""}`}>{i.title}</span>
                </button>
              ))}
              {on && (
                <button role="menuitem" onClick={() => (onChange(null), setOpen(false))} className="mt-1 flex min-h-9 w-full items-center rounded-xl px-2 py-1.5 pl-[31px] text-left text-[14px] text-ink2 hover:bg-fill2">
                  Show all
                </button>
              )}
            </motion.div>
          </Floating>
        )}
      </AnimatePresence>
    </>
  );
}
const PLAN_MENU_W = 256;

type PlanTools = {
  today?: string;
  folders: Folder[];
  onOpen: (id: string) => void;
  /** the line a carried task is held over, or null */
  onOver: (line: string | null) => void;
  refresh: () => void;
};

/**
 * The plan: the owner's priorities as a short outline, each with parts one level down, and the
 * tasks under each line. It is where they step back and look at everything; the day lists are
 * where the work is done. A line says "Nothing yet" while no unfinished task is part of it, which
 * is the one thing planning needs to see. Nothing is counted.
 *
 * Tapping a line opens its tasks in place. A task shows where it sits (Today, This week, Backlog)
 * and that word moves it; carrying a task onto another line makes it part of that line.
 */
function Plan({ plan, folders, today, open, onOpenLines, onOpen }: { plan?: PlanItem[]; folders: Folder[]; today?: string; open: string[]; onOpenLines: (ids: string[]) => void; onOpen: (id: string) => void }) {
  const { mutate: globalMutate } = useSWRConfig();
  const refresh = () => globalMutate((k) => typeof k === "string" && k.startsWith("todos"));
  const [over, setOver] = useState<string | null>(null);
  const [priority, setPriority] = useState("");
  const tools: PlanTools = { today, folders, onOpen, onOver: setOver, refresh };
  const toggle = (id: string) => onOpenLines(open.includes(id) ? open.filter((x) => x !== id) : [...open, id]);

  async function addLine(title: string, parent?: string) {
    if (!title.trim()) return;
    await api("plan", { body: { title, ...(parent ? { parent } : {}) } });
    refresh();
  }
  const tops = (plan ?? []).filter((i) => !i.parent_id);
  const partsOf = (id: string) => (plan ?? []).filter((i) => i.parent_id === id);

  return (
    <div data-plan>
      <header className="mb-5 px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.03em]">Plans</h1>
        <p className="mt-0.5 text-[14px] text-ink2">What you are working towards, and the tasks under each.</p>
      </header>

      {tops.map((top) => {
        const parts = partsOf(top.id);
        return (
          <div key={top.id} className="mb-3">
            <PlanLine item={top} empty={top.open + parts.reduce((n, p) => n + p.open, 0) === 0} open={open.includes(top.id)} over={over === top.id} onToggle={() => toggle(top.id)} tools={tools} />
            {parts.map((p) => (
              <PlanLine key={p.id} item={p} empty={p.open === 0} open={open.includes(p.id)} over={over === p.id} onToggle={() => toggle(p.id)} tools={tools} />
            ))}
            <PlanAdd top={top} onPart={(title) => addLine(title, top.id)} onTask={() => (open.includes(top.id) || onOpenLines([...open, top.id]), refresh())} />
          </div>
        );
      })}

      {plan && !tops.length && <p className="px-1 pb-2 text-ink3">Nothing here yet. Add what you are working towards; your tasks stay in their lists.</p>}

      <form onSubmit={(e) => (e.preventDefault(), addLine(priority), setPriority(""))} className="mt-4 px-1">
        <input value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="Add a priority" aria-label="Add a priority" className="w-full py-[7px] text-[17px] font-semibold tracking-[-0.015em]" />
      </form>

      {tops.length > 0 && (
        <div className="mt-6">
          <PlanLine item={null} empty={false} open={open.includes("none")} over={over === "none"} onToggle={() => toggle("none")} tools={tools} />
        </div>
      )}
    </div>
  );
}

/**
 * The plus under a priority. A tap adds a task to that priority, which is what is wanted most
 * often. With a pointer over it the plus says so ("Task") and offers "Part" beside it, for adding a
 * part instead; where nothing can hover, the first tap shows the two and the second chooses. So a
 * priority never looks as if it needs parts.
 */
function PlanAdd({ top, onPart, onTask }: { top: PlanItem; onPart: (title: string) => void; /** a task was added to the priority */ onTask: () => void }) {
  const [mode, setMode] = useState<null | "choose" | "task" | "part">(null);
  const [draft, setDraft] = useState("");
  const el = useRef<HTMLDivElement>(null);
  // the two choices, shown by a tap, step back on a tap anywhere else
  useEffect(() => {
    if (mode !== "choose") return;
    const away = (e: PointerEvent) => !el.current?.contains(e.target as Node) && setMode(null);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [mode]);

  async function add(stay: boolean) {
    const title = draft.trim();
    const what = mode;
    setDraft("");
    if (!stay || !title) setMode(null);
    if (!title) return;
    if (what === "part") return onPart(title);
    try {
      // planning is not scheduling: a task added here waits in the backlog until it is given a place
      await api("todos", { body: { title, view: "backlog", plan: top.id } });
      onTask();
    } catch {
      setDraft(title);
      setMode("task");
    }
  }

  if (mode === "task" || mode === "part")
    return (
      <form onSubmit={(e) => (e.preventDefault(), add(mode === "task"))} className="mt-1 flex items-center gap-3 px-1">
        {mode === "task" && <span className="check flex-none opacity-40" />}
        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => add(false)} onKeyDown={(e) => e.key === "Escape" && (setDraft(""), setMode(null))} placeholder={mode === "task" ? "New task" : "New part"} aria-label={mode === "task" ? `New task for ${top.title}` : `New part of ${top.title}`} className={`min-w-0 flex-1 ${mode === "task" ? "py-[9px] text-[16px]" : "py-[7px] pl-5 text-[15.5px]"}`} />
      </form>
    );
  const shown = mode === "choose";
  return (
    <div ref={el} data-plan-add={top.id} className="group mt-1 flex h-9 items-center gap-1 px-1">
      <button
        aria-label={`Add a task to ${top.title}`}
        onClick={() => setMode(!shown && window.matchMedia("(hover: none)").matches ? "choose" : "task")}
        className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-fill2 text-ink2 transition-colors hover:bg-accent hover:text-white"
      >
        <Plus size={15} strokeWidth={2.4} className="flex-none" />
        <span className={`overflow-hidden whitespace-nowrap text-[12.5px] font-medium transition-all duration-200 group-hover:max-w-[60px] group-hover:pl-0.5 group-hover:pr-2 group-hover:opacity-100 ${shown ? "max-w-[60px] pl-0.5 pr-2 opacity-100" : "max-w-0 opacity-0"}`}>Task</span>
      </button>
      <button
        aria-label={`Add a part of ${top.title}`}
        onClick={() => setMode("part")}
        className={`h-[22px] rounded-full px-2 text-[12.5px] font-medium text-ink3 transition-opacity duration-200 hover:bg-fill hover:text-ink2 focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 ${shown ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        Part
      </button>
    </div>
  );
}

/** One line of the plan with, once opened, its tasks. Without an item it is "Not in the plan": the tasks that are part of nothing. */
function PlanLine({ item, empty, open, over, onToggle, tools }: { item: PlanItem | null; empty: boolean; open: boolean; over: boolean; onToggle: () => void; tools: PlanTools }) {
  const key = item?.id ?? "none";
  const [renaming, setRenaming] = useState<string | null>(null);
  const top = !!item && !item.parent_id;
  async function rename() {
    const title = renaming?.trim();
    setRenaming(null);
    if (!item || !title || title === item.title) return;
    await api(`plan/${item.id}`, { method: "PATCH", body: { title } });
    tools.refresh();
  }
  return (
    <div data-plan-line={key} data-over={over || undefined} className={`-mx-2 rounded-2xl px-2 transition-colors ${over ? "drop-target" : ""}`}>
      {renaming !== null ? (
        <form onSubmit={(e) => (e.preventDefault(), rename())} className={`flex min-h-10 items-center px-1 ${top || !item ? "" : "pl-6"}`}>
          <input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === "Escape" && setRenaming(null)} aria-label="Name" className={`w-full py-[7px] ${top ? "text-[17px] font-semibold tracking-[-0.015em]" : "text-[15.5px]"}`} />
        </form>
      ) : (
        <button onClick={onToggle} aria-expanded={open} className={`flex min-h-10 w-full items-center gap-3 rounded-xl px-1 py-[7px] text-left ${top || !item ? "" : "pl-6"}`}>
          <span className={`min-w-0 flex-1 break-words transition-colors ${over ? "text-accent" : ""} ${top ? "text-[17px] font-semibold tracking-[-0.015em]" : item ? "text-[15.5px]" : "text-[15.5px] text-ink2"}`}>{item?.title ?? "Not in the plan"}</span>
          {empty && <span data-plan-empty className="flex-none whitespace-nowrap text-[12.5px] text-ink2">Nothing yet</span>}
          <ChevronRight size={14} className={`flex-none text-ink3 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
        </button>
      )}
      {open && <PlanTasks line={key} item={item} tools={tools} onRename={() => setRenaming(item?.title ?? "")} />}
    </div>
  );
}

/** The tasks of one opened line, soonest first, with a way to add one and, for a line of the plan, to rename or remove it. */
function PlanTasks({ line, item, tools, onRename }: { line: string; item: PlanItem | null; tools: PlanTools; onRename: () => void }) {
  const { data, mutate } = useSWR<{ todos: Row[]; today: string }>(`todos?view=all&plan=${line}`, fetcher, { refreshInterval: 15_000 });
  const [draft, setDraft] = useState("");
  // a priority's own list holds only its own tasks: those of its parts are under the parts
  const rows = data?.todos.filter((r) => (item ? r.plan_id === item.id : !r.plan_id));
  const today = data?.today ?? tools.today;
  const edit = (id: string, change: Partial<Row> | null) => mutate((cur) => (cur ? { ...cur, todos: change ? cur.todos.map((r) => (r.id === id ? { ...r, ...change } : r)) : cur.todos.filter((r) => r.id !== id) } : cur), false);
  async function send(id: string, body: Record<string, unknown>) {
    try {
      await api(`todos/${id}`, { method: "PATCH", body });
    } finally {
      tools.refresh();
    }
  }
  async function add() {
    const title = draft.trim();
    if (!title || !item) return;
    setDraft("");
    try {
      // planning is not scheduling: a task added here waits in the backlog until it is given a place
      await api("todos", { body: { title, view: "backlog", plan: item.id } });
      tools.refresh();
    } catch {
      setDraft(title);
    }
  }
  return (
    <div className={`pb-2 ${item?.parent_id ? "pl-5" : ""}`}>
      <ul>
        {rows?.map((r) => (
          <PlanRow
            key={r.id}
            r={r}
            line={line}
            today={today}
            folders={tools.folders}
            onOpen={() => tools.onOpen(r.id)}
            onOver={tools.onOver}
            onToggle={() => (edit(r.id, { done: !r.done }), send(r.id, { done: !r.done }))}
            onPlace={(view) => send(r.id, { view })}
            onDropped={(to) => (edit(r.id, null), send(r.id, { plan: to === "none" ? null : to }))}
          />
        ))}
      </ul>
      {item && (
        <div className="flex items-center gap-3 px-1">
          {/* a priority adds through the plus under it; a part has its own field here */}
          {item.parent_id ? (
            <>
              <span className="check flex-none opacity-40" />
              <form onSubmit={(e) => (e.preventDefault(), add())} className="min-w-0 flex-1">
                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a task" aria-label={`Add a task to ${item.title}`} className="w-full py-[9px] text-[16px]" />
              </form>
            </>
          ) : (
            <span className="flex-1" />
          )}
          <button onClick={onRename} className="h-8 flex-none rounded-full px-2.5 text-[13px] text-ink3 transition-colors hover:bg-fill hover:text-ink2">
            Rename
          </button>
          <ConfirmDelete label={`Remove ${item.title} from the plan`} confirm="Remove" size={15} onConfirm={async () => (await api(`plan/${item.id}`, { method: "DELETE" }), tools.refresh())} />
        </div>
      )}
      {!item && rows && !rows.length && <p className="px-1 py-2 text-[14px] text-ink3">Every task is part of the plan.</p>}
    </div>
  );
}

/**
 * A task under a line of the plan. Tapping it opens it; the word at its end says where it sits and
 * moves it to another list. It lifts the way a task in a list does (at once with a mouse, after a
 * short rest or a sideways pull with a finger) and, let go over another line, becomes part of it.
 * Let go anywhere else it returns to where it was: the order here is the lists' own.
 */
function PlanRow({ r, line, today, folders, onToggle, onOpen, onOver, onPlace, onDropped }: { r: Row; line: string; today?: string; folders: Folder[]; onToggle: () => void; onOpen: () => void; onOver: (line: string | null) => void; onPlace: (view: string) => void; onDropped: (line: string) => void }) {
  const controls = useDragControls();
  const el = useRef<HTMLLIElement>(null);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number; start: PointerEvent } | null>(null);
  const lifted = useRef(false);
  const dragging = useRef(false);
  const over = useRef<string | null>(null);
  const [up, setUp] = useState(false);

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    // once lifted, the touch belongs to the carry: no scrolling, no callout
    const still = (e: Event) => lifted.current && e.cancelable && e.preventDefault();
    node.addEventListener("touchmove", still, { passive: false });
    node.addEventListener("contextmenu", still);
    return () => {
      node.removeEventListener("touchmove", still);
      node.removeEventListener("contextmenu", still);
    };
  }, []);

  const cancelHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };
  const release = () => {
    cancelHold();
    lifted.current = false;
    setUp(false);
  };
  const lift = (start: PointerEvent) => {
    cancelHold();
    lifted.current = true;
    dragging.current = true;
    setUp(true);
    controls.start(start);
  };
  const place = placeLabel(r, today) || "No date";

  return (
    <motion.li
      ref={el}
      data-plan-task={r.id}
      drag
      dragListener={false}
      dragControls={controls}
      dragSnapToOrigin
      dragElastic={0}
      animate={{ scale: up ? 1.02 : 1, boxShadow: up ? "var(--shadow-lift)" : "0 0 0 rgba(0,0,0,0)", backgroundColor: up ? "var(--surface-solid)" : "rgba(0,0,0,0)", zIndex: up ? 5 : 0 }}
      whileDrag={{ scale: 1.02, boxShadow: "var(--shadow-lift)", backgroundColor: "var(--surface-solid)", zIndex: 5 }}
      transition={soft}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("[data-nodrag]") || e.button > 0) return;
        if (e.pointerType === "mouse") return controls.start(e);
        const start = e.nativeEvent;
        cancelHold();
        hold.current = { x: e.clientX, y: e.clientY, start, timer: setTimeout(() => lift(start), HOLD_MS) };
      }}
      onPointerMove={(e) => {
        if (!hold.current) return;
        const dx = Math.abs(e.clientX - hold.current.x);
        const dy = Math.abs(e.clientY - hold.current.y);
        if (Math.hypot(dx, dy) <= 8) return;
        if (dx > dy * 1.5) lift(hold.current.start);
        else cancelHold();
      }}
      onPointerUp={() => {
        const was = lifted.current;
        release();
        if (was) setTimeout(() => (dragging.current = false), 50);
      }}
      onPointerCancel={release}
      onDragStart={() => (dragging.current = true)}
      onDrag={(e) => {
        const at = e as PointerEvent;
        const under = document.elementsFromPoint(at.clientX, at.clientY).filter((n) => !el.current?.contains(n));
        const key = under.map((n) => n.closest("[data-plan-line]")).find(Boolean)?.getAttribute("data-plan-line") ?? null;
        const to = key && key !== line ? key : null;
        if (to !== over.current) onOver((over.current = to));
      }}
      onDragEnd={() => {
        const to = over.current;
        over.current = null;
        onOver(null);
        release();
        setTimeout(() => (dragging.current = false), 50);
        if (to) onDropped(to);
      }}
      className="todo-row relative -mx-1 flex cursor-grab touch-pan-y select-none items-start gap-3 rounded-2xl px-2 active:cursor-grabbing"
    >
      <button role="checkbox" aria-checked={r.done} aria-label={r.done ? "Mark not done" : "Mark done"} data-on={r.done} data-nodrag onClick={onToggle} className="check mt-[9px] flex-none">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 6.2l2.4 2.4 4.6-5" />
        </svg>
      </button>
      <div onClick={() => !dragging.current && onOpen()} className={`min-w-0 flex-1 cursor-pointer break-words py-[9px] text-[16px] ${r.done ? "text-ink3 line-through decoration-[var(--line)]" : ""}`}>
        {r.title}
      </div>
      {/* where it sits, and the way to move it: the same lists a task's "Move to" offers */}
      <label data-nodrag data-place className={`relative mt-[5px] flex h-8 flex-none cursor-pointer items-center whitespace-nowrap rounded-full px-2.5 text-[12.5px] transition-colors hover:bg-fill2 ${place === "Today" ? "text-accent" : "text-ink3"}`}>
        {place}
        <select aria-label={`Move ${r.title} to`} value="" onChange={(e) => e.target.value && onPlace(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0">
          <option value="">Move to…</option>
          {movable(folders, r.guest_id).map((x) => (
            <option key={x.key} value={x.key}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
    </motion.li>
  );
}

function List({
  view,
  folder,
  folders,
  today,
  filter,
  onFilter,
  plan,
  focus,
  onFocus,
  onOpen,
  onCarry,
}: {
  view: string;
  folder?: Folder;
  folders: Folder[];
  today?: string;
  /** the tags this list is narrowed to; none shows every task */
  filter: string[];
  onFilter: (tags: string[]) => void;
  plan: PlanItem[];
  /** the line of the plan this list is narrowed to, if any */
  focus: string | null;
  onFocus: (id: string | null) => void;
  onOpen: (id: string) => void;
  onCarry: (folder: string | null) => void;
}) {
  const { data, mutate } = useSWR<{ todos: Row[]; today: string }>(`todos?view=${view}`, fetcher, { refreshInterval: 15_000 });
  const { mutate: globalMutate } = useSWRConfig();
  const [rows, setRows] = useState<Row[] | null>(null);
  // the section a task is being typed into: "" in a list without sections, null when none is open
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const dragging = useRef(false);
  const away = useRef(false);
  // the section of this list a carried task is held over, lit as the day it will land on
  const [overGroup, setOverGroup] = useState<string | null>(null);

  // Tasks typed here that the server has not answered for yet. They show at once and stay put.
  const unsaved = useRef<Row[]>([]);
  // A task keeps the key it was first drawn with, so it does not redraw when its real id arrives.
  const keys = useRef(new Map<string, string>());

  useEffect(() => {
    if (data && !dragging.current) setRows([...data.todos, ...unsaved.current.filter((u) => !data.todos.some((r) => r.id === u.id))]);
  }, [data]);

  const refreshCounts = () => globalMutate("todos/folders");

  const all = view === ALL;
  const multi = view === "week" || view === "next_week" || view === "weekend" || view === "later" || all;
  // this week's Monday, which is the date a task set for the week (not a day) carries
  const monday = today ? plusDays(today, -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7)) : undefined;

  /**
   * The section a row is filed under in a list with sections; "" in a list without. A day is its
   * date; a week is its Monday followed by "w" ("Later" and "All", which span many weeks) or
   * "any" (a week's own list). "All" also has the backlog and what still waits for a day.
   */
  const groupOf = (r: Pick<Row, "scope" | "date">) => {
    if (!multi) return "";
    if (all && r.scope === "backlog") return "backlog";
    if (all && r.scope === "guest") return "waiting";
    if (r.scope !== "week") return r.date!;
    return all || view === "later" ? r.date + "w" : "any";
  };

  /** Where a section sorts in "All": today, the week it is in, the days and weeks after, then the backlog and what waits. */
  const rank = (key: string) => {
    if (key === "backlog") return "z1";
    if (key === "waiting") return "z2";
    if (!key.endsWith("w")) return key + "b";
    const week = key.slice(0, 10);
    // this week's own section follows today; a later week comes before its days
    return monday && week <= monday ? (today ?? week) + "c" : week + "a";
  };

  // the tags on this list's tasks, most used first, and whichever are chosen even if no task here has them
  const tags = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of rows ?? []) for (const t of r.tags ?? []) n.set(t, (n.get(t) ?? 0) + (r.done ? 0 : 1));
    for (const t of filter) if (!n.has(t)) n.set(t, 0);
    return [...n.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [rows, filter]);
  // several tags narrow it to the tasks carrying every one of them
  // the lines of the plan this list has tasks for (a priority counts its parts' tasks), and the chosen one whatever it has
  const lines = useMemo(() => plan.filter((i) => i.id === focus || (rows ?? []).some((r) => r.plan_id && planScope(plan, i.id).has(r.plan_id))), [plan, rows, focus]);
  const focused = focus ? plan.find((i) => i.id === focus) : undefined;
  const shown = useMemo(() => {
    const scope = focus ? planScope(plan, focus) : null;
    return (rows ?? []).filter((r) => filter.every((t) => r.tags?.includes(t)) && (!scope || (!!r.plan_id && scope.has(r.plan_id))));
  }, [rows, filter, focus, plan]);

  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of shown) {
      const k = groupOf(r);
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    if (multi && !all && !map.has("any") && view !== "weekend" && view !== "later") map.set("any", []);
    // every day still to come has its section, empty or not, so a task can be carried onto it
    if (rows) for (const day of daySections(view, today)) if (!map.has(day)) map.set(day, []);
    // "All" always has today, so there is somewhere to add a task
    if (rows && all && today && !map.has(today)) map.set(today, []);
    // plain order of the characters: digits (dates) before letters (the backlog, what waits)
    if (all) return [...map.entries()].sort(([a], [b]) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0));
    return [...map.entries()].sort(([a], [b]) => (a === "any" ? -1 : b === "any" ? 1 : a.localeCompare(b)));
  }, [rows, shown, view, multi, today]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle(r: Row) {
    setRows((rs) => rs!.map((x) => (x.id === r.id ? { ...x, done: !r.done } : x)));
    await api(`todos/${r.id}`, { method: "PATCH", body: { done: !r.done } });
    mutate();
    refreshCounts();
    // a rail module about this task goes when it is finished, and returns if it is unticked
    globalMutate("rail");
  }

  /** The list a section adds to and takes carried tasks into: the day itself, or the list the section stands for. */
  const targetOf = (section: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(section)) return section;
    if (section === "backlog") return "backlog";
    if (section.endsWith("w")) return monday && section.slice(0, 10) <= monday ? "week" : "next_week";
    return view;
  };

  /** Where a task sent to that list will be filed, so it shows in its place before the server answers. */
  const placeOf = (target: string): Pick<Row, "scope" | "date"> => {
    if (target === "backlog") return { scope: "backlog", date: null };
    if (target.startsWith("guest:")) return { scope: "guest", date: null };
    if (target === "week" || target === "next_week") return { scope: "week", date: monday ? plusDays(monday, target === "week" ? 0 : 7) : null };
    const day = /^\d{4}-/.test(target) ? target : target === "weekend" && today ? weekendDay(today) : today;
    return { scope: "day", date: day ?? null };
  };

  async function add() {
    const section = adding ?? "";
    const title = draft.trim();
    if (!title) return setAdding(null);
    setDraft("");
    // a section that is a day adds to that day; "Any day" (and a list without sections) adds to the list itself
    const target = targetOf(section);
    // while the list is narrowed to some tags a new task takes them, or it would vanish as it was added
    const tags = filter;
    // Show it straight away, exactly where it will live; the server's copy replaces it silently.
    // and the line of the plan it is narrowed to
    const temp = { id: `new_${Date.now()}_${unsaved.current.length}`, title, done: false, has_notes: false, ai_unseen: false, guest_id: folder?.guest ?? null, tags, plan_id: focus, plan: focused?.title ?? null, ...placeOf(target) } as unknown as Row;
    unsaved.current.push(temp);
    setRows((rs) => [...(rs ?? []), temp]);
    try {
      const t = await api<Row>("todos", { body: { title, view: target, ...(tags.length ? { tags } : {}), ...(focus ? { plan: focus } : {}) } });
      const row = { ...t, has_notes: false };
      keys.current.set(row.id, temp.id);
      unsaved.current = unsaved.current.filter((u) => u !== temp);
      setRows((rs) => (rs ?? []).map((r) => (r.id === temp.id ? row : r)));
      // Put it in the cached list too; this also discards any refresh already on its way from before the task existed.
      mutate((cur) => (cur ? { ...cur, todos: cur.todos.some((r) => r.id === row.id) ? cur.todos : [...cur.todos, row] } : cur), { revalidate: true });
      refreshCounts();
    } catch {
      // could not be saved: take it back out and give the words back to the box
      unsaved.current = unsaved.current.filter((u) => u !== temp);
      setRows((rs) => (rs ?? []).filter((r) => r.id !== temp.id));
      setDraft(title);
      setAdding(section);
    }
  }

  /** The lists a task may be carried to: the same ones its "Move to" menu offers, less the one it is in. */
  const accepts = (r: Row, key: string) => {
    const to = folders.find((x) => x.key === key);
    return !!to && key !== view && key !== "week" && key !== "later" && key !== ALL && !r.id.startsWith("new_") && (!to.guest || to.guest === r.guest_id);
  };

  /**
   * The sections of this list a task may be carried to: any but its own, a week in "Later" (no
   * single day to land on) and a day already past (it would only roll forward again).
   */
  const acceptsGroup = (r: Row, key: string) => multi && !r.id.startsWith("new_") && key !== groupOf(r) && takes(key);

  /**
   * Whether a section can be given a task, by carrying or typing: not a day already past, and not
   * a whole week unless it is this week or the next (a week further off has no list of its own to
   * add to; a task gets there by being given a date). In "All", the backlog can; what waits for a
   * day cannot (those tasks come from someone else).
   */
  const takes = (key: string) => {
    if (key === "any" || key === "backlog") return true;
    if (key === "waiting") return false;
    if (key.endsWith("w")) return all && !!monday && key.slice(0, 10) <= plusDays(monday, 7);
    return !today || key >= today;
  };

  /** A task let go over another section: it joins that day (or week, or the backlog) at the end, at once, and is saved behind. */
  async function moveToGroup(r: Row, key: string) {
    const to = targetOf(key);
    // "Any day" in a week's own list keeps the date the week's other tasks carry
    const place = key === "any" ? { scope: "week" as const, date: rows?.find((x) => x.scope === "week")?.date ?? r.date } : placeOf(to);
    setRows((rs) => [...rs!.filter((x) => x.id !== r.id), { ...r, ...place }]);
    try {
      await api(`todos/${r.id}`, { method: "PATCH", body: { view: to } });
    } finally {
      // a task that was waiting for a day has one now, so its module leaves the rail
      globalMutate((k) => typeof k === "string" && (k.startsWith("todos") || k === "rail"));
    }
  }

  /** A task let go over another list: it leaves this one at once, unless this view also shows the day it went to. A person's list keeps its tasks whatever day they are given. */
  async function move(r: Row, to: string) {
    if (!(view === "week" || view === "next_week" || view === "weekend" || all || folder?.guest)) {
      setRows((rs) => rs!.filter((x) => x.id !== r.id));
      mutate((cur) => (cur ? { ...cur, todos: cur.todos.filter((x) => x.id !== r.id) } : cur), { revalidate: false });
    }
    try {
      await api(`todos/${r.id}`, { method: "PATCH", body: { view: to } });
    } finally {
      globalMutate((k) => typeof k === "string" && (k.startsWith("todos") || k === "rail"));
    }
  }

  function reorder(groupKey: string, ordered: Row[]) {
    setRows((rs) => {
      const inGroup = new Set(ordered.map((o) => o.id));
      const out: Row[] = [];
      let placed = false;
      for (const r of rs!) {
        if (!inGroup.has(r.id)) out.push(r);
        else if (!placed) (out.push(...ordered), (placed = true));
      }
      return out;
    });
  }

  const title = folder?.label ?? "";
  const groupName = (key: string) => {
    if (key === "any") return "Any day";
    if (key === "backlog") return "Backlog";
    if (key === "waiting") return "Waiting for a day";
    if (key === today) return "Today";
    // "All" names a section the way a task's date pill does: Tomorrow, Thursday, Thu, Dec 17, Next week
    if (all) return placeLabel({ scope: key.endsWith("w") ? "week" : "day", date: key.slice(0, 10) }, today) || longDate(key.slice(0, 10));
    return view !== "later" ? dayName(key) : key.endsWith("w") ? `Week of ${longDate(key.slice(0, 10)).replace(/^\S+\s/, "")}` : longDate(key);
  };

  /** The plus at the end of a list, or of one of its sections, and the field it opens. */
  const adder = (section: string) => (
    <div className="mt-1 flex items-center gap-3 px-1">
      {adding === section ? (
        <motion.form initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} onSubmit={(e) => (e.preventDefault(), add())} className="flex flex-1 items-center gap-3">
          <span className="check opacity-40" />
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={add} onKeyDown={(e) => e.key === "Escape" && (setDraft(""), setAdding(null))} placeholder="New task" className="flex-1 py-[9px] text-[16px]" />
        </motion.form>
      ) : (
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => setAdding(section)} aria-label={section ? `Add task to ${groupName(section)}` : "Add task"} data-add={section || undefined} className={`grid h-[22px] w-[22px] place-items-center rounded-full bg-fill2 text-ink2 transition-colors hover:bg-accent hover:text-white ${section ? "mb-1 mt-1" : "mt-2"}`}>
          <Plus size={15} strokeWidth={2.4} />
        </motion.button>
      )}
    </div>
  );
  const sub = view === "today" && today ? longDate(today) : /^\d{4}/.test(view) ? longDate(view) : view === "backlog" ? "No date. Pull from here when you have room." : view === "later" ? "Dated beyond next week." : folder?.guest ? "Tasks stay here after you give them a day." : undefined;
  const openCount = shown.filter((r) => !r.done).length;

  return (
    <div>
      <header className="mb-5 flex items-end gap-3 px-1">
        <div className="min-w-0 flex-1">
          <h1 className="text-[30px] font-bold leading-tight tracking-[-0.03em]">{title}</h1>
          <p className="mt-0.5 h-5 truncate text-[14px] text-ink2">{(!filter.length && !focus && sub) || (rows ? (openCount ? `${openCount} to do` : shown.length ? "All done" : "") : "")}</p>
        </div>
        {/* only on a list that has tagged tasks, or while a choice is still in force */}
        {/* likewise, only on a list with tasks that are part of the plan */}
        {lines.length > 0 && <PlanFilter lines={lines} chosen={focus} onChange={onFocus} />}
        {tags.length > 0 && <TagFilter tags={tags} chosen={filter} onChange={onFilter} />}
      </header>

      {groups.map(([key, items]) => (
        <div key={key} data-group={key || undefined} data-over={overGroup === key || undefined} className={`-mx-2 mb-2 rounded-2xl px-2 pb-1 ${key ? "mt-3 pt-2" : ""} ${overGroup === key ? "drop-target" : ""}`}>
          {key && (
            <h2 className={`mb-1 px-1 text-[12.5px] font-semibold uppercase tracking-[0.06em] transition-colors duration-300 ${overGroup === key ? "text-accent" : "text-ink3"}`}>
              {groupName(key)}
            </h2>
          )}
          {/* The group asks for one new order at a time and waits for `values` to change before it
              asks again. An order turned down (the row is away from the list) must still hand it a
              fresh list, or it waits for good and the row never trades places again. */}
          <Reorder.Group axis="y" values={items} onReorder={(o) => (away.current ? setRows((rs) => rs && [...rs]) : reorder(key, o))} as="ul">
            <AnimatePresence initial={false}>
              {items.map((r) => (
                <TodoRow
                  key={keys.current.get(r.id) ?? r.id}
                  r={r}
                  tag={!!r.guest_id && !folder?.guest}
                  place={folder?.guest ? placeLabel(r, data?.today ?? today) : undefined}
                  today={data?.today ?? today}
                  onOpenNext={onOpen}
                  dragging={dragging}
                  away={away}
                  accepts={(k) => accepts(r, k)}
                  acceptsGroup={(k) => acceptsGroup(r, k)}
                  onCarryGroup={setOverGroup}
                  onCarry={onCarry}
                  onToggle={() => !r.id.startsWith("new_") && toggle(r)}
                  onOpen={() => !r.id.startsWith("new_") && onOpen(r.id)}
                  onDropped={(to, group) => (to ? move(r, to) : group !== null ? moveToGroup(r, group) : setRows((rs) => (api("todos/reorder", { body: { ids: rs!.map((x) => x.id).filter((x) => !x.startsWith("new_")) } }), rs)))}
                />
              ))}
            </AnimatePresence>
          </Reorder.Group>
          {/* in a list with sections each one that can take a task has its own plus, which adds to that day */}
          {key && takes(key) && adder(key)}
        </div>
      ))}

      {rows && shown.length === 0 && adding === null && <p className="px-1 py-6 text-ink3">{filter.length ? `Nothing tagged ${filter.join(" and ")} here.` : focused ? `Nothing for ${focused.title} here.` : "Nothing here."}</p>}

      {/* a list without sections has one plus at its end; "Later" adds only through its days, as a task gets there by being given a date */}
      {!multi && adder("")}
    </div>
  );
}

function Detail({ id, backLabel, folders, tags, plan, today, onOpen, onBack }: { id: string; backLabel: string; folders: Folder[]; /** the tags tasks already carry, offered when one is added */ tags: TagCount[]; /** the lines of the plan the task can be part of */ plan: PlanItem[]; today?: string; onOpen: (id: string) => void; onBack: () => void }) {
  const { agent } = useMe();
  const { mutate: globalMutate } = useSWRConfig();
  // While notes typed here are waiting to be saved, background refreshes are held back: nothing
  // re-renders the page under the keyboard, and an older copy can never arrive mid-sentence.
  const saver = useSaver((md) => patch({ notes: md }, true), 600);
  const { data: todo, mutate } = useSWR<Todo>(`todos/${id}`, fetcher, { refreshInterval: 8_000, isPaused: () => saver.dirty() });
  const [title, setTitle] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const railTold = useRef(false);

  // Take the server's notes only when nothing typed here is waiting to be saved.
  useEffect(() => {
    if (!todo) return;
    // opening a task clears a rail module that pointed at it: let the rail catch up
    if (!railTold.current) ((railTold.current = true), globalMutate("rail"));
    if (title === null) setTitle(todo.title);
    if (!saver.dirty()) setNotes(todo.notes);
    if (todo.ai_unseen && !todo.notes.includes("<ins ")) api(`todos/${id}`, { method: "PATCH", body: { seen: true } }).then(() => globalMutate((k) => typeof k === "string" && k.startsWith("todos?")));
  }, [todo]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshLists = () => globalMutate((k) => typeof k === "string" && k.startsWith("todos") && k !== `todos/${id}`);
  /** quiet: a notes save while typing. It changes nothing the lists show, so they are refreshed on leaving instead. */
  async function patch(body: Record<string, unknown>, quiet = false) {
    const t = await api<Todo>(`todos/${id}`, { method: "PATCH", body });
    mutate(t, false);
    if (!quiet) refreshLists();
    // finishing a task takes what the rail said about it away; unticking brings it back
    if ("done" in body) globalMutate("rail");
    return t;
  }
  const flush = saver.flush;
  const onNotes = saver.push;
  useEffect(() => () => void refreshLists(), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!todo || notes === null) return <div className="shimmer mt-16 h-8 w-2/3 rounded-full" />;
  const creator = agent(todo.created_by);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button onClick={async () => (await flush(), onBack())} className="-ml-2 flex items-center gap-0.5 rounded-full py-1.5 pl-1 pr-3 text-[15px] text-accent transition-colors hover:bg-accent-soft">
          <ChevronLeft size={20} />
          {backLabel}
        </button>
        <div className="flex items-center gap-1">
          <select
            aria-label="Move to"
            value=""
            onChange={async (e) => e.target.value && (await patch({ view: e.target.value }), onBack())}
            className="h-8 cursor-pointer appearance-none rounded-full bg-fill px-3 text-[13px] font-medium text-ink2 outline-none transition-colors hover:bg-fill2"
          >
            <option value="">Move to…</option>
            {movable(folders, todo.guest_id).map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
          <ConfirmDelete label="Delete task" onConfirm={async () => (await api(`todos/${id}`, { method: "DELETE" }), globalMutate((k) => typeof k === "string" && k.startsWith("todos")), onBack())} />
        </div>
      </div>

      <div className="flex items-start gap-3.5">
        <button role="checkbox" aria-checked={todo.done} aria-label="Done" data-on={todo.done} onClick={() => patch({ done: !todo.done })} className="check mt-[9px] !h-[26px] !w-[26px]">
          <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 6.2l2.4 2.4 4.6-5" />
          </svg>
        </button>
        <textarea
          value={title ?? ""}
          rows={1}
          aria-label="Task name"
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, ""))}
          onBlur={() => title?.trim() && title !== todo.title && patch({ title })}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
          ref={(el) => {
            if (el) (el.style.height = "0px"), (el.style.height = el.scrollHeight + "px");
          }}
          className={`min-w-0 flex-1 resize-none overflow-hidden text-[26px] font-bold leading-[1.25] tracking-[-0.025em] ${todo.done ? "text-ink3" : ""}`}
        />
      </div>
      {/* when it is for, and whether it comes round again */}
      <div className="ml-[40px] mt-2.5 flex flex-wrap items-center gap-1.5">
        {today && <DatePill label={placeLabel(todo, today) || "No date"} value={todo.scope === "day" ? todo.date : null} today={today} onPick={(d) => patch({ view: d })} />}
        <label className={`relative flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors ${todo.repeat ? "bg-accent-soft text-accent" : "bg-fill text-ink2 hover:bg-fill2"}`}>
          <RepeatIcon size={14} />
          {todo.repeat ? REPEAT_LABELS.find(([k]) => k === todo.repeat)?.[1] : "Repeat"}
          <select aria-label="Repeat" value={todo.repeat ?? ""} onChange={(e) => patch({ repeat: e.target.value || null })} className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0">
            <option value="">Never</option>
            {REPEAT_LABELS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {/* the line of the plan it is part of; only once there is a plan */}
        {plan.length > 0 && (
          <label data-part-of className={`relative flex h-8 max-w-[240px] cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors ${todo.plan_id ? "bg-accent-soft text-accent" : "bg-fill text-ink2 hover:bg-fill2"}`}>
            <Flag size={14} className="flex-none" />
            <span className="truncate">{plan.find((i) => i.id === todo.plan_id)?.title ?? "Part of"}</span>
            <select aria-label="Part of" value={todo.plan_id ?? ""} onChange={(e) => patch({ plan: e.target.value || null })} className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0">
              <option value="">Not in the plan</option>
              {plan.map((i) => (
                <option key={i.id} value={i.id}>
                  {(i.parent_id ? "\u2003" : "") + i.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {/* its tags, and the way to add one; the lists can be narrowed to them */}
        <TagPills tags={todo.tags ?? []} known={tags.map((t) => t.tag)} add="Add tag" onChange={(next) => (mutate({ ...todo, tags: next }, false), patch({ tags: next }))} />
      </div>
      {todo.repeat && !todo.done && <p className="ml-[40px] mt-2 text-[13px] text-ink3">When you finish it, the next one is added {todo.repeat === "daily" ? "for the day after" : `${{ every_3_days: "three days", weekly: "a week", biweekly: "two weeks", monthly: "a month", yearly: "a year" }[todo.repeat]} from that day`}.</p>}
      <AnimatePresence initial={false}>
        {todo.done && todo.next_id && todo.next_date && (
          <motion.div key="next" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={soft} className="ml-[40px] overflow-hidden">
            <NextNote date={todo.next_date} today={today} onOpen={async () => (await flush(), onOpen(todo.next_id!))} className="pt-2 text-[13px]" />
          </motion.div>
        )}
      </AnimatePresence>
      {creator && creator.kind !== "human" && (
        <div className="ml-[40px] mt-1.5 flex items-center gap-1.5 text-[13px] text-ink2">
          <Avatar agent={creator} size={16} /> Added by {creator.name}
        </div>
      )}
      {todo.rail && <FromRail rail={todo.rail} />}
      {todo.guest_id && (
        <div className="ml-[40px] mt-1.5 text-[13px] text-ink2 [&>span]:ml-0">
          <FromTag id={todo.guest_id} />
          <span className="ml-2">{todo.scope === "guest" ? `Not on a day yet. ${agent(todo.guest_id)?.name ?? "They"} can see where you put it.` : `${agent(todo.guest_id)?.name ?? "They"} can see this task, its notes and its day.`}</span>
        </div>
      )}

      <div className="ml-[40px] mt-10 max-md:ml-0">
        <Editor value={notes} onChange={onNotes} onReviewed={() => patch({ seen: true })} />
      </div>
    </div>
  );
}
