"use client";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { AlignLeft, ChevronLeft, Plus } from "lucide-react";
import { AnimatePresence, motion, Reorder, useDragControls } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Avatar } from "@/components/bits";
import { Editor } from "@/components/Editor";
import { api, fetcher, soft, spring, useMe, useSaver } from "@/lib/client";
import type { Folder, Todo } from "@/lib/core/todos";

type Row = Omit<Todo, "notes"> & { has_notes: boolean };
type Folders = { today: string; folders: Folder[] };

const dayName = (date: string) => new Date(date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" });
const longDate = (date: string) => new Date(date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

export default function TodosPage() {
  const [view, setView] = useState("today");
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: f } = useSWR<Folders>("todos/folders", fetcher, { refreshInterval: 30_000 });
  const folder = f?.folders.find((x) => x.key === view);

  // If the day rolls over while the app is open, a dated folder may no longer exist.
  useEffect(() => {
    if (f && !folder) setView("today");
  }, [f, folder]);

  return (
    <div className="mx-auto flex max-w-[920px] gap-8 max-md:flex-col max-md:gap-4">
      <aside className="md:w-[200px] md:flex-none md:pt-[70px]">
        <nav className="flex gap-0.5 max-md:-mx-4 max-md:overflow-x-auto max-md:px-4 md:flex-col" aria-label="Lists">
          {f?.folders.map((x, i) => {
            const on = x.key === view;
            const gap = x.key === "next_week" || (i === 2 && x.key !== "weekend");
            return (
              <button
                key={x.key}
                onClick={() => (setView(x.key), setOpenId(null))}
                className={`relative flex h-9 flex-none items-center gap-2 rounded-xl px-3 text-left text-[14.5px] transition-colors ${on ? "font-semibold text-ink" : "text-ink2 hover:text-ink"} ${gap ? "md:mt-3" : ""}`}
              >
                {on && <motion.span layoutId="folder" transition={spring} className="glass absolute inset-0 rounded-xl" />}
                <span className="relative flex-1 whitespace-nowrap">{x.label}</span>
                <motion.span key={x.count} initial={{ scale: 1.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={`relative text-[12.5px] tabular-nums ${on ? "text-accent" : "text-ink3"}`}>
                  {x.count || ""}
                </motion.span>
              </button>
            );
          })}
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
              <List view={view} folder={folder} today={f?.today} onOpen={setOpenId} />
            </motion.div>
          )}
        </AnimatePresence>
      </section>
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
 */
function TodoRow({ r, dragging, onToggle, onOpen, onDropped }: { r: Row; dragging: React.MutableRefObject<boolean>; onToggle: () => void; onOpen: () => void; onDropped: () => void }) {
  const controls = useDragControls();
  const el = useRef<HTMLLIElement>(null);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const lifted = useRef(false);
  const [up, setUp] = useState(false);

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

  return (
    <Reorder.Item
      ref={el}
      value={r}
      as="li"
      dragListener={false}
      dragControls={controls}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto", scale: up ? 1.02 : 1, boxShadow: up ? "var(--shadow-lift)" : "0 0 0 rgba(0,0,0,0)", backgroundColor: up ? "var(--surface-solid)" : "rgba(0,0,0,0)", zIndex: up ? 5 : 0 }}
      exit={{ opacity: 0, height: 0 }}
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
            lifted.current = true;
            dragging.current = true;
            setUp(true);
            controls.start(start);
          }, HOLD_MS),
        };
      }}
      onPointerMove={(e) => hold.current && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 8 && cancelHold()}
      onPointerUp={() => {
        const was = lifted.current;
        release();
        // lifted but never moved: nothing was dragged, so drag-end will not fire
        if (was) setTimeout(() => (dragging.current = false), 50);
      }}
      onPointerCancel={release}
      onDragStart={() => (dragging.current = true)}
      onDragEnd={() => {
        release();
        setTimeout(() => (dragging.current = false), 50);
        onDropped();
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
          {/* an agent changed this task since you last opened it: the dot sits right after the words */}
          {r.ai_unseen && <span title="An agent made changes" aria-label="An agent made changes" className="relative -top-px ml-2 inline-block h-[7px] w-[7px] rounded-full bg-accent align-middle shadow-[0_0_0_3px_var(--accent-soft)]" />}
        </span>
        {r.has_notes && <AlignLeft size={15} className="mt-[5px] flex-none text-ink3" />}
      </div>
    </Reorder.Item>
  );
}

function List({ view, folder, today, onOpen }: { view: string; folder?: Folder; today?: string; onOpen: (id: string) => void }) {
  const { data, mutate } = useSWR<{ todos: Row[]; today: string }>(`todos?view=${view}`, fetcher, { refreshInterval: 15_000 });
  const { mutate: globalMutate } = useSWRConfig();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const dragging = useRef(false);

  // Tasks typed here that the server has not answered for yet. They show at once and stay put.
  const unsaved = useRef<Row[]>([]);
  // A task keeps the key it was first drawn with, so it does not redraw when its real id arrives.
  const keys = useRef(new Map<string, string>());

  useEffect(() => {
    if (data && !dragging.current) setRows([...data.todos, ...unsaved.current.filter((u) => !data.todos.some((r) => r.id === u.id))]);
  }, [data]);

  const refreshCounts = () => globalMutate("todos/folders");

  const groups = useMemo(() => {
    const multi = view === "week" || view === "next_week" || view === "weekend";
    const map = new Map<string, Row[]>();
    for (const r of rows ?? []) {
      const k = !multi ? "" : r.scope === "week" ? "any" : r.date!;
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    if (multi && !map.has("any") && view !== "weekend") map.set("any", []);
    return [...map.entries()].sort(([a], [b]) => (a === "any" ? -1 : b === "any" ? 1 : a.localeCompare(b)));
  }, [rows, view]);

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
    // Show it straight away, exactly where it will live; the server's copy replaces it silently.
    // the same place the server will file it, so it does not jump between groups when saved
    const day = /^\d{4}-/.test(view) ? view : view === "today" ? today : view === "weekend" && today ? weekendDay(today) : null;
    const temp = { id: `new_${Date.now()}_${unsaved.current.length}`, title, done: false, has_notes: false, ai_unseen: false, scope: view === "backlog" ? "backlog" : day ? "day" : "week", date: day ?? null } as unknown as Row;
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
  const sub = view === "today" && today ? longDate(today) : /^\d{4}/.test(view) ? longDate(view) : view === "backlog" ? "No date. Pull from here when you have room." : undefined;
  const openCount = rows?.filter((r) => !r.done).length ?? 0;

  return (
    <div>
      <header className="mb-5 px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.03em]">{title}</h1>
        <p className="mt-0.5 h-5 text-[14px] text-ink2">{sub ?? (rows ? (openCount ? `${openCount} to do` : rows.length ? "All done" : "") : "")}</p>
      </header>

      {groups.map(([key, items]) => (
        <div key={key} className="mb-2">
          {key && (
            <h2 className="mb-1 mt-5 px-1 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-ink3">
              {key === "any" ? "Any day" : key === today ? "Today" : dayName(key)}
            </h2>
          )}
          <Reorder.Group axis="y" values={items} onReorder={(o) => reorder(key, o)} as="ul">
            <AnimatePresence initial={false}>
              {items.map((r) => (
                <TodoRow
                  key={keys.current.get(r.id) ?? r.id}
                  r={r}
                  dragging={dragging}
                  onToggle={() => !r.id.startsWith("new_") && toggle(r)}
                  onOpen={() => !r.id.startsWith("new_") && onOpen(r.id)}
                  onDropped={() => setRows((rs) => (api("todos/reorder", { body: { ids: rs!.map((x) => x.id).filter((x) => !x.startsWith("new_")) } }), rs))}
                />
              ))}
            </AnimatePresence>
          </Reorder.Group>
        </div>
      ))}

      {rows && rows.length === 0 && !adding && <p className="px-1 py-6 text-ink3">Nothing here.</p>}

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
            {folders.filter((x) => x.key !== "week").map((x) => (
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
      {creator && creator.kind === "agent" && (
        <div className="ml-[40px] mt-1.5 flex items-center gap-1.5 text-[13px] text-ink2">
          <Avatar agent={creator} size={16} /> Added by {creator.name}
        </div>
      )}

      <div className="ml-[40px] mt-10 max-md:ml-0">
        <Editor value={notes} onChange={onNotes} onReviewed={() => patch({ seen: true })} />
      </div>
    </div>
  );
}
