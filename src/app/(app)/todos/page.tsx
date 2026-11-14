"use client";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { AlignLeft, ChevronLeft, Plus, Undo2 } from "lucide-react";
import { AnimatePresence, motion, Reorder, useDragControls } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Avatar } from "@/components/bits";
import { Editor } from "@/components/Editor";
import { api, fetcher, soft, spring, useMe, useSaver } from "@/lib/client";
import type { BinnedTodo, Folder, Todo } from "@/lib/core/todos";

type Row = Omit<Todo, "notes"> & { has_notes: boolean };
type Folders = { today: string; folders: Folder[]; bin: number };
const BIN = "bin";
const LAST = "last_week";

const dayName = (date: string) => new Date(date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" });
const longDate = (date: string) => new Date(date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

const addDays = (date: string, n: number) => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const mondayOf = (date: string) => addDays(date, -((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7));

/** Lists that span several days and show them as sections. */
const MULTI = new Set(["week", "next_week", LAST, "weekend"]);
/** The Monday of the week such a list covers. */
const weekOf = (view: string, today: string) => addDays(mondayOf(today), view === "next_week" ? 7 : view === LAST ? -7 : 0);

/**
 * The days a list always shows, with or without tasks, so each is there to drag a task onto: what is
 * left of this week up to Friday, the five weekdays of next and last week, what is left of the
 * weekend. Other days (the weekend in a week, days already gone) show only while they hold something.
 */
function standingDays(view: string, today: string): string[] {
  const monday = weekOf(view, today);
  if (view === "weekend") return [5, 6].map((n) => addDays(monday, n)).filter((d) => d >= today);
  const days = [0, 1, 2, 3, 4].map((n) => addDays(monday, n));
  if (view !== "week") return days;
  const left = days.filter((d) => d >= today);
  return left.length ? left : [today];
}

type Place = { scope: Todo["scope"]; date: string | null };
/** Where a task dropped on a list ends up. The server decides; this is the same answer, to show it at once. */
function placeFor(key: string, today: string): Place {
  if (key === "today") return { scope: "day", date: today };
  if (/^\d{4}-/.test(key)) return { scope: "day", date: key };
  if (key === "weekend") return { scope: "day", date: weekendDay(today) };
  if (key === "backlog") return { scope: "backlog", date: null };
  if (key.startsWith("guest:")) return { scope: "guest", date: null };
  return { scope: "week", date: weekOf(key, today) };
}
/** Whether a task in that place belongs to this list. */
function inView(view: string, today: string, p: Place): boolean {
  if (view === "backlog" || view.startsWith("guest:")) return p.scope === placeFor(view, today).scope;
  if (!MULTI.has(view)) return p.scope === "day" && p.date === placeFor(view, today).date;
  const monday = weekOf(view, today);
  if (view === "weekend") return p.scope === "day" && !!p.date && p.date >= addDays(monday, 5) && p.date <= addDays(monday, 6);
  return p.scope === "week" ? p.date === monday : p.scope === "day" && !!p.date && p.date >= monday && p.date <= addDays(monday, 6);
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
  // the list a dragged task is being held over
  const [hot, setHot] = useState<string | null>(null);

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
      <aside data-lists className="relative z-10 md:w-[200px] md:flex-none md:pt-[70px]">
        <nav className="flex gap-0.5 max-md:-mx-4 max-md:overflow-x-auto max-md:px-4 md:flex-col" aria-label="Lists">
          {f?.folders.filter((x) => x.key !== LAST).map((x, i) => {
            const on = x.key === view;
            const gap = x.key === "next_week" || (i === 2 && x.key !== "weekend") || (!!x.guest && !f.folders[i - 1]?.guest);
            return (
              <button
                key={x.key}
                data-folder={x.key}
                onClick={() => (setView(x.key), setOpenId(null))}
                className={`relative flex h-9 flex-none items-center gap-2 rounded-xl px-3 text-left text-[14.5px] transition-colors ${hot === x.key ? "bg-solid text-accent shadow-[var(--shadow)]" : on ? "font-semibold text-ink" : "text-ink2 hover:text-ink"} ${gap ? "md:mt-3" : ""}`}
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
          {/* what was finished last week: quiet, and last, beneath the bin */}
          {f?.folders.some((x) => x.key === LAST) && (
            <button
              data-folder={LAST}
              onClick={() => (setView(LAST), setOpenId(null))}
              className={`relative flex h-9 flex-none items-center gap-2 rounded-xl px-3 text-left text-[14.5px] transition-colors ${f.bin ? "" : "md:mt-3"} ${hot === LAST ? "bg-solid text-accent shadow-[var(--shadow)]" : view === LAST ? "font-semibold text-ink" : "text-ink3 hover:text-ink2"}`}
            >
              {view === LAST && <motion.span layoutId="folder" transition={spring} className="glass absolute inset-0 rounded-xl" />}
              <span className="relative flex-1 whitespace-nowrap">Last week</span>
            </button>
          )}
        </nav>
      </aside>

      <section className="relative min-w-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          {openId ? (
            <motion.div key="detail" initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 28 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
              <Detail id={openId} backLabel={folder?.label ?? "Back"} folders={f?.folders ?? []} onBack={() => setOpenId(null)} />
            </motion.div>
          ) : (
            <motion.div key={"list-" + view} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
              {view === BIN ? <Bin /> : <List view={view} folder={folder} folders={f?.folders ?? []} today={f?.today} onOpen={setOpenId} onHot={setHot} />}
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

/** Where a task added to "Weekend" goes: Saturday, or today when it is already Sunday. */
function weekendDay(today: string): string {
  const d = new Date(today + "T12:00:00Z");
  const dow = d.getUTCDay();
  if (dow !== 0) d.setUTCDate(d.getUTCDate() + (6 - dow));
  return d.toISOString().slice(0, 10);
}

/** How long a finger rests on a task before it lifts for reordering. Shorter than the system's own long-press. */
const HOLD_MS = 260;

/**
 * One task in the list. With a mouse it drags straight away. With a finger, a quick swipe scrolls
 * the page as usual; resting on the row for a moment lifts it, and from then on the page is held
 * still so the row can travel any distance. (Safari hands a moving touch to scrolling and cancels
 * the drag unless the page is told to stay put, which is why a row used to move only one place.)
 *
 * A row can be carried into another day's section, where it is drawn afresh mid-drag. `lifted`
 * (the id of the row a finger holds) is therefore shared by the list, not kept by the row.
 */
function TodoRow({
  r, tag, arrived, dragging, lifted, onToggle, onOpen, onGrab, onCarry, onDropped,
}: {
  r: Row;
  tag: boolean;
  /** Carried here from another section mid-drag: it is already on screen, so it does not fade in again. */
  arrived: boolean;
  dragging: React.MutableRefObject<boolean>;
  lifted: React.MutableRefObject<string | null>;
  onToggle: () => void;
  onOpen: () => void;
  onGrab: () => void;
  onCarry: (x: number, y: number, el: HTMLElement | null) => void;
  onDropped: (el: HTMLElement | null) => void;
}) {
  const controls = useDragControls();
  const el = useRef<HTMLLIElement>(null);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const [up, setUp] = useState(false);
  const id = r.id;

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    // once a row is lifted, the touch belongs to the drag: no scrolling, no text selection, no callout
    const still = (e: Event) => lifted.current === id && e.cancelable && e.preventDefault();
    const off = () => {
      node.removeEventListener("touchmove", still);
      node.removeEventListener("contextmenu", still);
    };
    node.addEventListener("touchmove", still, { passive: false });
    node.addEventListener("contextmenu", still);
    return () => {
      // Carried into another section mid-drag: this element has left the page, but the finger's
      // touch still reports to it, so it goes on holding the page still until the finger lifts.
      if (lifted.current !== id) return off();
      node.addEventListener("touchend", off, { once: true });
      node.addEventListener("touchcancel", off, { once: true });
    };
  }, [id, lifted]);

  const cancelHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };
  const release = () => {
    cancelHold();
    if (lifted.current === id) lifted.current = null;
    setUp(false);
  };

  return (
    <Reorder.Item
      ref={el}
      value={r.id}
      as="li"
      dragListener={false}
      dragControls={controls}
      initial={arrived ? false : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto", scale: up ? 1.02 : 1, boxShadow: up ? "var(--shadow-lift)" : "0 0 0 rgba(0,0,0,0)", backgroundColor: up ? "var(--surface-solid)" : "rgba(0,0,0,0)", zIndex: up ? 5 : 0 }}
      transition={soft}
      whileDrag={{ scale: 1.02, boxShadow: "var(--shadow-lift)", backgroundColor: "var(--surface-solid)", zIndex: 5 }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("[role=checkbox]") || e.button > 0) return;
        if (e.pointerType === "mouse") return controls.start(e);
        const start = e.nativeEvent;
        cancelHold();
        hold.current = {
          x: e.clientX,
          y: e.clientY,
          timer: setTimeout(() => {
            hold.current = null;
            lifted.current = id;
            dragging.current = true;
            setUp(true);
            controls.start(start);
          }, HOLD_MS),
        };
      }}
      onPointerMove={(e) => hold.current && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 8 && cancelHold()}
      onPointerUp={() => {
        const was = lifted.current === id;
        release();
        // lifted but never moved: nothing was dragged, so drag-end will not fire
        if (was) setTimeout(() => (dragging.current = false), 50);
      }}
      onPointerCancel={release}
      onDragStart={() => ((dragging.current = true), onGrab())}
      onDrag={(e) => "clientX" in e && onCarry(e.clientX, e.clientY, el.current)}
      onDragEnd={() => {
        release();
        setTimeout(() => (dragging.current = false), 50);
        onDropped(el.current);
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
        </span>
        {r.has_notes && <AlignLeft size={15} className="mt-[5px] flex-none text-ink3" />}
      </div>
    </Reorder.Item>
  );
}

function List({ view, folder, folders, today: knownToday, onOpen, onHot }: { view: string; folder?: Folder; folders: Folder[]; today?: string; onOpen: (id: string) => void; onHot: (key: string | null) => void }) {
  const { data, mutate } = useSWR<{ todos: Row[]; today: string }>(`todos?view=${view}`, fetcher, { refreshInterval: 15_000 });
  const { mutate: globalMutate } = useSWRConfig();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const today = data?.today ?? knownToday;
  const multi = MULTI.has(view);

  const dragging = useRef(false);
  /** The row a finger is holding (see TodoRow). */
  const lifted = useRef<string | null>(null);
  /** A move is being saved: a refresh from before it must not put the task back. */
  const saving = useRef(0);
  /** The task being dragged and where it was picked up from. */
  const grabbed = useRef<{ id: string; group: string } | null>(null);
  /** The task that last crossed into another section. */
  const carried = useRef<string | null>(null);
  /** The list in the side panel the dragged task is over, if it can go there. */
  const over = useRef<string | null>(null);
  const latest = useRef<Row[]>([]);
  latest.current = rows ?? [];

  // Tasks typed here that the server has not answered for yet. They show at once and stay put.
  const unsaved = useRef<Row[]>([]);
  // A task keeps the key it was first drawn with, so it does not redraw when its real id arrives.
  const keys = useRef(new Map<string, string>());

  useEffect(() => {
    if (data && !dragging.current && !saving.current) setRows([...data.todos, ...unsaved.current.filter((u) => !data.todos.some((r) => r.id === u.id))]);
  }, [data]);

  const refreshCounts = () => globalMutate("todos/folders");

  /** The section a task sits in: its day, "any" for the week as a whole, or "" in a list with no sections. */
  const groupOf = useCallback((r: Row) => (!multi ? "" : r.scope === "week" ? "any" : r.date!), [multi]);

  const { groups, keyOf } = useMemo(() => {
    const map = new Map<string, Row[]>();
    if (!multi) map.set("", []);
    else if (today) {
      if (view === "week" || view === "next_week") map.set("any", []);
      for (const d of standingDays(view, today)) map.set(d, []);
    }
    for (const r of rows ?? []) {
      const k = groupOf(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    // A section is known to the drag by its tasks' ids: an id stays the same thing when its task changes day.
    const groups = [...map.entries()].sort(([a], [b]) => (a === "any" ? -1 : b === "any" ? 1 : a.localeCompare(b))).map(([key, items]) => ({ key, items, ids: items.map((r) => r.id) }));
    // lets a drag be judged by the section it is heading for
    const keyOf = new Map(groups.map((g) => [g.ids, g.key]));
    return { groups, keyOf };
  }, [rows, view, today, multi, groupOf]);

  async function toggle(r: Row) {
    setRows((rs) => rs!.map((x) => (x.id === r.id ? { ...x, done: !r.done } : x)));
    await api(`todos/${r.id}`, { method: "PATCH", body: { done: !r.done } });
    mutate();
    refreshCounts();
  }

  async function add() {
    const title = draft.trim();
    if (!title) return setAdding(false);
    setDraft("");
    // Show it straight away, in the same place the server will file it, so it does not jump
    // between sections when saved; the server's copy replaces it silently.
    const temp = { id: `new_${Date.now()}_${unsaved.current.length}`, title, done: false, has_notes: false, ai_unseen: false, ...(today ? placeFor(view, today) : { scope: "week", date: null }) } as unknown as Row;
    unsaved.current.push(temp);
    setRows((rs) => [...(rs ?? []), temp]);
    try {
      const t = await api<Row>("todos", { body: { title, view } });
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
      setAdding(true);
    }
  }

  /**
   * A section's new order. When a task is carried between two sections both report in turn: the
   * one it left without it, the one it joined with it, where it takes on that section's day.
   */
  function arrange(group: string, ids: string[], moved?: string) {
    const was = latest.current.find((r) => r.id === moved);
    if (was && ids.includes(was.id) && groupOf(was) !== group) carried.current = was.id;
    setRows((rs) => {
      const place: Place | null = !group || !today ? null : group === "any" ? placeFor(view, today) : { scope: "day", date: group };
      const here = new Set(ids);
      // the dragged task is kept aside while it is between sections; the one it joins names it next
      const all = new Map([...latest.current, ...(rs ?? [])].map((r) => [r.id, r]));
      const rest = (rs ?? []).filter((r) => !here.has(r.id) && groupOf(r) !== group);
      const ordered = ids.map((id) => all.get(id)).filter((r): r is Row => !!r);
      return [...rest, ...ordered.map((o) => (place && (o.scope !== place.scope || o.date !== place.date) ? { ...o, ...place } : o))];
    });
  }

  /** Days already gone hold only finished tasks: an unfinished one put there would roll straight back to today. */
  const canJoin = (id: string, _from: string[], to: string[]) => {
    const k = keyOf.get(to);
    const r = latest.current.find((t) => t.id === id);
    return k !== undefined && !!r && !id.startsWith("new_") && (k === "any" || r.done || !today || k >= today);
  };

  /** Whether a task can be dropped on a list in the side panel. */
  function accepts(key: string, r: Row) {
    const f = folders.find((x) => x.key === key);
    if (!f || !today || r.id.startsWith("new_")) return false;
    // only a task that person shared can go back to their list; last week takes only what is finished
    if (f.guest ? f.guest !== r.guest_id : key === LAST && !r.done) return false;
    return key !== view || (multi && view !== "weekend");
  }

  /** While a task is dragged: note the list in the side panel it is over, and let that list show through it. */
  function carry(id: string, x: number, y: number, el: HTMLElement | null) {
    const under = document.elementsFromPoint(x, y).find((h) => !el?.contains(h));
    el?.classList.toggle("over-lists", !!under?.closest("[data-lists]"));
    const key = under?.closest("[data-folder]")?.getAttribute("data-folder") ?? null;
    const r = key ? latest.current.find((t) => t.id === id) : undefined;
    const next = key && r && accepts(key, r) ? key : null;
    if (next !== over.current) onHot((over.current = next));
  }

  async function dropped(id: string, el: HTMLElement | null) {
    el?.classList.remove("over-lists");
    const from = grabbed.current;
    const list = over.current;
    grabbed.current = carried.current = over.current = null;
    onHot(null);
    const row = latest.current.find((r) => r.id === id);
    if (!row || id.startsWith("new_") || !today) return;

    // which list or day it went to, if it went anywhere
    const to = list ?? (from && groupOf(row) !== from.group ? (groupOf(row) === "any" ? view : row.date!) : null);
    if (list) {
      const place = placeFor(list, today);
      setRows((rs) => [...rs!.filter((r) => r.id !== id), ...(inView(view, today, place) ? [{ ...row, ...place }] : [])]);
    }
    const ids = latest.current.map((r) => r.id).filter((x) => !x.startsWith("new_"));
    saving.current++;
    try {
      if (to) await api(`todos/${id}`, { method: "PATCH", body: { view: to } });
      // dropped on a list it joins at the end; dropped in the page it keeps the place it was put
      if (!list) await api("todos/reorder", { body: { ids } });
    } finally {
      saving.current--;
      if (to) (mutate(), refreshCounts());
    }
  }

  const title = folder?.label ?? "";
  const sub = view === "today" && today ? longDate(today) : /^\d{4}/.test(view) ? longDate(view) : view === "backlog" ? "No date. Pull from here when you have room." : folder?.guest ? "Waiting for a day. Open one and move it when you are ready." : undefined;

  return (
    <div>
      <header className="mb-5 px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.03em]">{title}</h1>
        {sub && <p className="mt-0.5 text-[14px] text-ink2">{sub}</p>}
      </header>

      <Reorder.Board canMove={canJoin}>
        {groups.map(({ key, items, ids }) => (
          <div key={key} className={key ? "mt-4" : "mb-2"} data-day={key || undefined}>
            {key && <h2 className="h-5 px-1 text-[12.5px] font-semibold uppercase leading-5 tracking-[0.06em] text-ink3">{key === "any" ? "Any day" : key === today ? "Today" : dayName(key)}</h2>}
            {/* a day's section reaches up behind its heading, so an empty day is still somewhere to drop a task */}
            <Reorder.Group axis="y" values={ids} onReorder={(o: string[], moved?: string) => arrange(key, o, moved)} as="ul" className={key ? "-mt-5 pb-2 pt-6" : ""}>
              {items.map((r) => (
                <TodoRow
                  key={keys.current.get(r.id) ?? r.id}
                  r={r}
                  tag={!!r.guest_id && !folder?.guest}
                  arrived={carried.current === r.id}
                  dragging={dragging}
                  lifted={lifted}
                  onToggle={() => !r.id.startsWith("new_") && toggle(r)}
                  onOpen={() => !r.id.startsWith("new_") && onOpen(r.id)}
                  onGrab={() => (grabbed.current = { id: r.id, group: groupOf(r) })}
                  onCarry={(x, y, el) => carry(r.id, x, y, el)}
                  onDropped={(el) => dropped(r.id, el)}
                />
              ))}
            </Reorder.Group>
          </div>
        ))}
      </Reorder.Board>

      {rows && rows.length === 0 && !adding && !multi && <p className="px-1 py-6 text-ink3">Nothing here.</p>}

      {view !== LAST && (
        <div className="mt-1 flex items-center gap-3 px-1">
          {adding ? (
            <motion.form initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} onSubmit={(e) => (e.preventDefault(), add())} className="flex flex-1 items-center gap-3">
              <span className="check opacity-40" />
              <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={add} onKeyDown={(e) => e.key === "Escape" && (setDraft(""), setAdding(false))} placeholder="New task" className="flex-1 py-[9px] text-[16px]" />
            </motion.form>
          ) : (
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => setAdding(true)} aria-label="Add task" className="mt-2 grid h-[22px] w-[22px] place-items-center rounded-full bg-fill2 text-ink2 transition-colors hover:bg-accent hover:text-white">
              <Plus size={15} strokeWidth={2.4} />
            </motion.button>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ id, backLabel, folders, onBack }: { id: string; backLabel: string; folders: Folder[]; onBack: () => void }) {
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
            {folders.filter((x) => x.key !== "week" && x.key !== LAST && (!x.guest || x.guest === todo.guest_id)).map((x) => (
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
