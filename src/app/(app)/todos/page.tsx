"use client";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { AlignLeft, ChevronLeft, Plus, Repeat as RepeatIcon, Undo2 } from "lucide-react";
import { AnimatePresence, motion, Reorder, useDragControls } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Avatar } from "@/components/bits";
import { DatePill } from "@/components/DatePicker";
import { Editor } from "@/components/Editor";
import { api, fetcher, soft, spring, useMe, useSaver } from "@/lib/client";
import type { BinnedTodo, Folder, Repeat, Todo } from "@/lib/core/todos";

type Row = Omit<Todo, "notes"> & { has_notes: boolean };
type Folders = { today: string; folders: Folder[]; bin: number };
const BIN = "bin";

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

/** The small tag on a task that came from a guest ("From Meredith"). */
function FromTag({ id }: { id: string | null }) {
  const { agent } = useMe();
  const g = agent(id);
  if (!g) return null;
  return <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-accent-soft px-2 py-[1px] align-middle text-[11.5px] font-medium text-accent">From {g.name}</span>;
}

export default function TodosPage() {
  const [view, setView] = useState("today");
  const [openId, setOpenId] = useState<string | null>(null);
  // the list a carried task is being held over, lit as the place it will land
  const [carry, setCarry] = useState<string | null>(null);

  // The rail links here with ?open=<task id> to show one task.
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("open");
    if (id) (setOpenId(id), history.replaceState(null, "", location.pathname));
  }, []);
  const { data: f } = useSWR<Folders>("todos/folders", fetcher, { refreshInterval: 30_000 });
  const folder = f?.folders.find((x) => x.key === view);

  // If the day rolls over while the app is open, a dated folder may no longer exist.
  useEffect(() => {
    if (f && !folder && view !== BIN) setView("today");
    // the bin's entry goes away once it is empty; do not strand the owner on a list with no way back
    if (f && view === BIN && !f.bin) setView("today");
  }, [f, folder, view]);

  return (
    <div className="mx-auto flex max-w-[920px] gap-8 max-md:flex-col max-md:gap-4">
      <aside className="relative z-10 md:w-[200px] md:flex-none md:pt-[70px]">
        <nav className="flex gap-0.5 max-md:-mx-4 max-md:overflow-x-auto max-md:px-4 md:flex-col" aria-label="Lists">
          {f?.folders.map((x, i) => {
            const on = x.key === view;
            const gap = x.key === "next_week" || (i === 2 && x.key !== "weekend") || (!!x.guest && !f.folders[i - 1]?.guest);
            return (
              <button
                key={x.key}
                data-folder={x.key}
                data-over={carry === x.key || undefined}
                onClick={() => (setView(x.key), setOpenId(null))}
                className={`relative flex h-9 flex-none items-center gap-2 rounded-xl px-3 text-left text-[14.5px] transition-colors ${carry === x.key ? "drop-target font-semibold text-accent" : on ? "font-semibold text-ink" : "text-ink2 hover:text-ink"} ${gap ? "md:mt-3" : ""}`}
              >
                {on && <motion.span layoutId="folder" transition={spring} className="glass absolute inset-0 rounded-xl" />}
                <span className="relative flex-1 whitespace-nowrap">{x.label}</span>
                <motion.span key={x.count} initial={{ scale: 1.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={`relative text-[12.5px] tabular-nums ${on ? "text-accent" : "text-ink3"}`}>
                  {x.count || ""}
                </motion.span>
              </button>
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
                onClick={() => (setView(BIN), setOpenId(null))}
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
              <Detail key={openId} id={openId} backLabel={folder?.label ?? "Back"} folders={f?.folders ?? []} today={f?.today} onOpen={setOpenId} onBack={() => setOpenId(null)} />
            </motion.div>
          ) : (
            <motion.div key={"list-" + view} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
              {view === BIN ? <Bin /> : <List view={view} folder={folder} folders={f?.folders ?? []} today={f?.today} onOpen={setOpenId} onCarry={setCarry} />}
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
          {/* someone else changed this task since you last opened it: the dot sits right after the words */}
          {r.ai_unseen && <span title="Changed since you last looked" aria-label="Changed since you last looked" className="relative -top-px ml-2 inline-block h-[7px] w-[7px] rounded-full bg-accent align-middle shadow-[0_0_0_3px_var(--accent-soft)]" />}
          {r.done && r.next_id && r.next_date && <NextNote date={r.next_date} today={today} onOpen={() => onOpenNext(r.next_id!)} className="mt-0.5" />}
        </span>
        {r.repeat && !r.done && <RepeatIcon size={14} aria-label="Repeats" className="mt-[6px] flex-none text-ink3" />}
        {place && <span data-place className="mt-[4px] flex-none whitespace-nowrap text-[12.5px] text-ink3">{place}</span>}
        {r.has_notes && <AlignLeft size={15} className="mt-[5px] flex-none text-ink3" />}
      </div>
    </Reorder.Item>
  );
}

function List({ view, folder, folders, today, onOpen, onCarry }: { view: string; folder?: Folder; folders: Folder[]; today?: string; onOpen: (id: string) => void; onCarry: (folder: string | null) => void }) {
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

  const multi = view === "week" || view === "next_week" || view === "weekend" || view === "later";
  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows ?? []) {
      // "Later" spans many weeks, so a task set for a week (not a day) is filed under that week
      const k = !multi ? "" : r.scope !== "week" ? r.date! : view === "later" ? r.date + "w" : "any";
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    if (multi && !map.has("any") && view !== "weekend" && view !== "later") map.set("any", []);
    // every day still to come has its section, empty or not, so a task can be carried onto it
    if (rows) for (const day of daySections(view, today)) if (!map.has(day)) map.set(day, []);
    return [...map.entries()].sort(([a], [b]) => (a === "any" ? -1 : b === "any" ? 1 : a.localeCompare(b)));
  }, [rows, view, multi, today]);

  async function toggle(r: Row) {
    setRows((rs) => rs!.map((x) => (x.id === r.id ? { ...x, done: !r.done } : x)));
    await api(`todos/${r.id}`, { method: "PATCH", body: { done: !r.done } });
    mutate();
    refreshCounts();
  }

  async function add() {
    const section = adding ?? "";
    const title = draft.trim();
    if (!title) return setAdding(null);
    setDraft("");
    // a section that is a day adds to that day; "Any day" (and a list without sections) adds to the list itself
    const target = /^\d{4}-/.test(section) ? section : view;
    // Show it straight away, exactly where it will live; the server's copy replaces it silently.
    // the same place the server will file it, so it does not jump between groups when saved
    const day = /^\d{4}-/.test(target) ? target : target === "today" ? today : target === "weekend" && today ? weekendDay(today) : null;
    const temp = { id: `new_${Date.now()}_${unsaved.current.length}`, title, done: false, has_notes: false, ai_unseen: false, scope: view === "backlog" ? "backlog" : folder?.guest ? "guest" : day ? "day" : "week", guest_id: folder?.guest ?? null, date: day ?? null } as unknown as Row;
    unsaved.current.push(temp);
    setRows((rs) => [...(rs ?? []), temp]);
    try {
      const t = await api<Row>("todos", { body: { title, view: target } });
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
    return !!to && key !== view && key !== "week" && key !== "later" && !r.id.startsWith("new_") && (!to.guest || to.guest === r.guest_id);
  };

  /** The section a row is filed under in a list with sections; "" in a list without. */
  const groupOf = (r: Row) => (!multi ? "" : r.scope !== "week" ? r.date! : view === "later" ? r.date + "w" : "any");

  /**
   * The sections of this list a task may be carried to: any but its own, a week in "Later" (no
   * single day to land on) and a day already past (it would only roll forward again).
   */
  const acceptsGroup = (r: Row, key: string) => multi && !r.id.startsWith("new_") && key !== groupOf(r) && takes(key);

  /** Whether a section can be given a task, by carrying or typing: not a whole week in "Later" (no single day) nor a day already past. */
  const takes = (key: string) => !key.endsWith("w") && (key === "any" || !today || key >= today);

  /** A task let go over another section: it joins that day (or "Any day") at the end, at once, and is saved behind. */
  async function moveToGroup(r: Row, key: string) {
    const to = key === "any" ? view : key;
    setRows((rs) => [...rs!.filter((x) => x.id !== r.id), { ...r, scope: key === "any" ? "week" : "day", date: key === "any" ? (rs!.find((x) => x.scope === "week")?.date ?? r.date) : key }]);
    try {
      await api(`todos/${r.id}`, { method: "PATCH", body: { view: to } });
    } finally {
      globalMutate((k) => typeof k === "string" && k.startsWith("todos"));
    }
  }

  /** A task let go over another list: it leaves this one at once, unless this view also shows the day it went to. A person's list keeps its tasks whatever day they are given. */
  async function move(r: Row, to: string) {
    if (!(view === "week" || view === "next_week" || view === "weekend" || folder?.guest)) {
      setRows((rs) => rs!.filter((x) => x.id !== r.id));
      mutate((cur) => (cur ? { ...cur, todos: cur.todos.filter((x) => x.id !== r.id) } : cur), { revalidate: false });
    }
    try {
      await api(`todos/${r.id}`, { method: "PATCH", body: { view: to } });
    } finally {
      globalMutate((k) => typeof k === "string" && k.startsWith("todos"));
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
  const groupName = (key: string) => (key === "any" ? "Any day" : key === today ? "Today" : view !== "later" ? dayName(key) : key.endsWith("w") ? `Week of ${longDate(key.slice(0, 10)).replace(/^\S+\s/, "")}` : longDate(key));

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
  const openCount = rows?.filter((r) => !r.done).length ?? 0;

  return (
    <div>
      <header className="mb-5 px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.03em]">{title}</h1>
        <p className="mt-0.5 h-5 text-[14px] text-ink2">{sub ?? (rows ? (openCount ? `${openCount} to do` : rows.length ? "All done" : "") : "")}</p>
      </header>

      {groups.map(([key, items]) => (
        <div key={key} data-group={key || undefined} data-over={overGroup === key || undefined} className={`-mx-2 mb-2 rounded-2xl px-2 pb-1 ${key ? "mt-3 pt-2" : ""} ${overGroup === key ? "drop-target" : ""}`}>
          {key && (
            <h2 className={`mb-1 px-1 text-[12.5px] font-semibold uppercase tracking-[0.06em] transition-colors duration-300 ${overGroup === key ? "text-accent" : "text-ink3"}`}>
              {groupName(key)}
            </h2>
          )}
          <Reorder.Group axis="y" values={items} onReorder={(o) => !away.current && reorder(key, o)} as="ul">
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

      {rows && rows.length === 0 && adding === null && <p className="px-1 py-6 text-ink3">Nothing here.</p>}

      {/* a list without sections has one plus at its end; "Later" adds only through its days, as a task gets there by being given a date */}
      {!multi && adder("")}
    </div>
  );
}

function Detail({ id, backLabel, folders, today, onOpen, onBack }: { id: string; backLabel: string; folders: Folder[]; today?: string; onOpen: (id: string) => void; onBack: () => void }) {
  const { agent } = useMe();
  const { mutate: globalMutate } = useSWRConfig();
  // While notes typed here are waiting to be saved, background refreshes are held back: nothing
  // re-renders the page under the keyboard, and an older copy can never arrive mid-sentence.
  const saver = useSaver((md) => patch({ notes: md }, true), 600);
  const { data: todo, mutate } = useSWR<Todo>(`todos/${id}`, fetcher, { refreshInterval: 8_000, isPaused: () => saver.dirty() });
  const [title, setTitle] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  // Take the server's notes only when nothing typed here is waiting to be saved.
  useEffect(() => {
    if (!todo) return;
    if (title === null) setTitle(todo.title);
    if (!saver.dirty()) setNotes(todo.notes);
    if (todo.ai_unseen && !todo.notes.includes("<ins ")) api(`todos/${id}`, { method: "PATCH", body: { seen: true } }).then(() => globalMutate((k) => typeof k === "string" && k.startsWith("todos?")));
  }, [todo]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshLists = () => globalMutate((k) => typeof k === "string" && k.startsWith("todos") && k !== `todos/${id}`);
  /** quiet: a notes save while typing. It changes nothing the lists show except the notes mark, so they are refreshed on leaving instead. */
  async function patch(body: Record<string, unknown>, quiet = false) {
    const t = await api<Todo>(`todos/${id}`, { method: "PATCH", body });
    mutate(t, false);
    if (!quiet) refreshLists();
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
            {folders.filter((x) => x.key !== "week" && x.key !== "later" && (!x.guest || x.guest === todo.guest_id)).map((x) => (
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
