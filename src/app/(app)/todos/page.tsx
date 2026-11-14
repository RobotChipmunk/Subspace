"use client";
import { AlignLeft, ChevronLeft, Plus, Trash2 } from "lucide-react";
import { AnimatePresence, motion, Reorder, useDragControls } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Avatar } from "@/components/bits";
import { Editor } from "@/components/Editor";
import { api, fetcher, soft, spring, useMe } from "@/lib/client";
import type { Folder, Todo } from "@/lib/core/todos";

type Row = Omit<Todo, "notes"> & { has_notes: boolean };
type Folders = { today: string; folders: Folder[] };

const dayName = (date: string) => new Date(date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" });
const longDate = (date: string) => new Date(date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

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

  // The rail links here with ?open=<task id> to show one task.
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("open");
    if (id) (setOpenId(id), history.replaceState(null, "", location.pathname));
  }, []);
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
            const gap = x.key === "next_week" || (i === 2 && x.key !== "weekend") || (!!x.guest && !f.folders[i - 1]?.guest);
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


/** How long a finger rests on a task before it lifts for reordering. Shorter than the system's own long-press. */
const HOLD_MS = 260;

/**
 * One task in the list. With a mouse it drags straight away. With a finger, a quick swipe scrolls
 * the page as usual; resting on the row for a moment lifts it, and from then on the page is held
 * still so the row can travel any distance. (Safari hands a moving touch to scrolling and cancels
 * the drag unless the page is told to stay put, which is why a row used to move only one place.)
 */
function TodoRow({ r, tag, dragging, onToggle, onOpen, onDropped }: { r: Row; tag: boolean; dragging: React.MutableRefObject<boolean>; onToggle: () => void; onOpen: () => void; onDropped: () => void }) {
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
          {tag && <FromTag id={r.guest_id} />}
          {/* someone else changed this task since you last opened it: the dot sits right after the words */}
          {r.ai_unseen && <span title="Changed since you last looked" aria-label="Changed since you last looked" className="relative -top-px ml-2 inline-block h-[7px] w-[7px] rounded-full bg-accent align-middle shadow-[0_0_0_3px_var(--accent-soft)]" />}
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

  useEffect(() => {
    if (data && !dragging.current) setRows(data.todos);
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
    const t = await api<Row>("todos", { body: { title, view } });
    setRows((rs) => [...(rs ?? []), { ...t, has_notes: false }]);
    mutate();
    refreshCounts();
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
  const sub = view === "today" && today ? longDate(today) : /^\d{4}/.test(view) ? longDate(view) : view === "backlog" ? "No date. Pull from here when you have room." : folder?.guest ? "Waiting for a day. Open one and move it when you are ready." : undefined;
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
                  key={r.id}
                  r={r}
                  tag={!!r.guest_id && !folder?.guest}
                  dragging={dragging}
                  onToggle={() => toggle(r)}
                  onOpen={() => onOpen(r.id)}
                  onDropped={() => setRows((rs) => (api("todos/reorder", { body: { ids: rs!.map((x) => x.id) } }), rs))}
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
  const { data: todo, mutate } = useSWR<Todo>(`todos/${id}`, fetcher, { refreshInterval: 8_000 });
  const [title, setTitle] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<string | null>(null);

  // Take the server's notes only when nothing typed here is waiting to be saved.
  useEffect(() => {
    if (!todo) return;
    if (title === null) setTitle(todo.title);
    if (latest.current === null) setNotes(todo.notes);
    if (todo.ai_unseen && !todo.notes.includes("<ins ")) api(`todos/${id}`, { method: "PATCH", body: { seen: true } }).then(() => globalMutate((k) => typeof k === "string" && k.startsWith("todos?")));
  }, [todo]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = async (body: Record<string, unknown>) => {
    const t = await api<Todo>(`todos/${id}`, { method: "PATCH", body });
    mutate(t, false);
    globalMutate((k) => typeof k === "string" && k.startsWith("todos") && k !== `todos/${id}`);
    return t;
  };

  async function flush() {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    if (latest.current === null) return;
    const md = latest.current;
    await patch({ notes: md });
    if (latest.current === md) latest.current = null;
  }

  function onNotes(md: string) {
    latest.current = md;
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(flush, 600);
  }

  useEffect(() => () => void flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

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
            {folders.filter((x) => x.key !== "week" && (!x.guest || x.guest === todo.guest_id)).map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
          <button aria-label="Delete task" onClick={async () => (await api(`todos/${id}`, { method: "DELETE" }), globalMutate((k) => typeof k === "string" && k.startsWith("todos")), onBack())} className="grid h-8 w-8 place-items-center rounded-full text-ink3 transition-colors hover:bg-fill hover:text-danger">
            <Trash2 size={16} />
          </button>
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
