"use client";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { ArrowUpRight, Check, ChevronLeft, ImagePlus, Moon, Plus, Scissors, Sparkles, Sprout, Star, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Avatar } from "@/components/bits";
import { ago, api, fetcher, hash, soft, spring, useMe, useShowing } from "@/lib/client";
import type { Idea, IdeaCanvas, IdeaCard, IdeaItem, IdeaLink } from "@/lib/core/ideas";
import { PALETTES } from "@/lib/palettes";

/**
 * Ideas: a place to let an idea grow. The first screen is the ideas themselves, each a small
 * picture of its canvas. An idea opened is the canvas: a calm, free surface. The owner puts text
 * and pictures on it anywhere; agents branch from those a little each day; and the owner steers
 * with their hands rather than with controls:
 *   double-tap empty space   write something there
 *   drag a piece             move it
 *   drag it onto another     the two belong together (a join is drawn)
 *   double-tap a piece       keep it (more like this); on your own text, edit it
 *   press and hold           more of this, please
 *   flick it away            prune it (not this way); it can be brought back for a moment
 * A selected piece also offers the same things as three quiet buttons, for anyone who would
 * rather tap, or cannot make the gesture.
 *
 * An idea has a life of its own, and says so quietly under its name: that it looks ready to act
 * on (one tap makes it a task), and which other ideas it has something in common with (one tap
 * goes there). Left alone for a fortnight it rests by itself; something an agent finds can wake it.
 */
export default function IdeasPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const router = useRouter();
  const id = useSearchParams().get("idea");
  const open = (next: string | null) => router.push(next ? `/ideas?idea=${next}` : "/ideas", { scroll: false });
  return id ? <Canvas key={id} id={id} onBack={() => open(null)} onOpen={open} /> : <Shelf onOpen={open} />;
}

// ---------- The ideas ----------

function Shelf({ onOpen }: { onOpen: (id: string) => void }) {
  const { agent } = useMe();
  const { data, mutate } = useSWR<{ ideas: IdeaCard[] }>("ideas", fetcher, { refreshInterval: 30_000 });
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    try {
      const idea = await api<Idea>("ideas", { body: {} });
      await mutate();
      onOpen(idea.id);
    } finally {
      setBusy(false);
    }
  }
  const ideas = data?.ideas ?? [];
  return (
    <div className="mx-auto max-w-[880px]">
      <header className="mb-6 px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.03em]">Ideas</h1>
        <p className="mt-0.5 text-[14px] text-ink2">Put an idea down and let it grow. Your agents add to it a little each day; you keep what you like.</p>
      </header>
      <div className="grid grid-cols-3 gap-3 max-md:grid-cols-2 max-sm:grid-cols-1">
        <motion.button whileTap={{ scale: 0.98 }} disabled={busy} onClick={start} className="flex min-h-[188px] flex-col items-center justify-center gap-2 rounded-[26px] border border-dashed border-[var(--fill-strong)] text-[14.5px] text-ink2 transition-colors hover:border-accent hover:text-accent">
          <Plus size={20} /> New idea
        </motion.button>
        {ideas.map((idea, i) => (
          <motion.button key={idea.id} data-idea={idea.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...soft, delay: Math.min(i, 10) * 0.035 }} whileTap={{ scale: 0.985 }} onClick={() => onOpen(idea.id)} className="glass flex min-h-[188px] flex-col overflow-hidden rounded-[26px] text-left">
            <Thumb idea={idea} />
            <div className="px-4 pb-3.5 pt-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[15.5px] font-semibold">{idea.title || "Untitled idea"}</span>
                {idea.unseen > 0 && <span aria-label={`${idea.unseen} new`} className="h-2 w-2 flex-none rounded-full bg-accent" />}
              </div>
              <div className="truncate text-[12.5px] text-ink3">
                {idea.woken_by ? `Woken by ${agent(idea.woken_by)?.name ?? "an agent"}` : idea.state === "resting" ? "Resting" : idea.last_grown_at ? `Grew ${ago(idea.last_grown_at)}${ago(idea.last_grown_at) === "now" ? "" : " ago"}` : "Not grown yet"} · {idea.items} {idea.items === 1 ? "piece" : "pieces"}
                {idea.ripe && <span data-ripe className="text-accent"> · Ready</span>}
              </div>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

/** A small picture of a canvas: a dot where each piece sits, the owner's in ink and the agents' in accent. */
function Thumb({ idea }: { idea: IdeaCard }) {
  const pts = idea.preview;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const span = Math.max(400, Math.max(...xs, 0) - Math.min(...xs, 0), (Math.max(...ys, 0) - Math.min(...ys, 0)) * 1.6);
  const cx = pts.length ? (Math.max(...xs) + Math.min(...xs)) / 2 : 0;
  const cy = pts.length ? (Math.max(...ys) + Math.min(...ys)) / 2 : 0;
  return (
    <svg viewBox="0 0 160 100" className="h-[124px] w-full flex-none" aria-hidden>
      {pts.map((p, i) => (
        <circle key={i} cx={80 + ((p.x - cx) / span) * 120} cy={50 + ((p.y - cy) / span) * 120} r={p.mine ? 4.2 : 3.2} fill={p.mine ? "var(--ink)" : "var(--accent)"} opacity={p.mine ? 0.55 : 0.7} />
      ))}
      {!pts.length && <circle cx={80} cy={50} r={3} fill="var(--ink3)" opacity={0.5} />}
    </svg>
  );
}

// ---------- The canvas ----------

type View = { x: number; y: number; k: number };
type Size = { w: number; h: number };
const FONT = ["", "text-[15px] leading-snug", "text-[20px] leading-snug font-medium", "text-[30px] leading-tight font-semibold tracking-[-0.01em]", "text-[46px] leading-[1.08] font-bold tracking-[-0.02em]"];
const KIND_WORD: Record<string, string> = { riff: "riff", found: "found", counter: "but", question: "?", image: "" };
const HOLD_MS = 560;
const FLICK = 1.5; // pixels a millisecond: quicker than this on letting go, and the piece is thrown away
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
/** A copy of a record without one of its entries. */
function without<T>(m: Record<string, T>, key: string): Record<string, T> {
  const next = { ...m };
  delete next[key];
  return next;
}

function Canvas({ id, onBack, onOpen }: { id: string; onBack: () => void; onOpen: (id: string) => void }) {
  const { agent } = useMe();
  const { data, mutate } = useSWR<IdeaCanvas>(`ideas/${id}`, fetcher, { refreshInterval: 15_000 });
  useShowing("idea", data ? id : null, data?.idea.title);
  const surface = useRef<HTMLDivElement>(null);
  const life = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const fitted = useRef(false);
  /** Where pieces are being dragged to, before the server knows. */
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [thrown, setThrown] = useState<Record<string, { dx: number; dy: number }>>({});
  const [undo, setUndo] = useState<{ id: string; text: string } | null>(null);
  const [said, setSaid] = useState<{ id: string; text: string } | null>(null);
  const [sizes, setSizes] = useState<Record<string, Size>>({});
  const [title, setTitle] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const idea = data?.idea;
  const items = useMemo(() => (data?.items ?? []).filter((i) => !thrown[i.id]).map((i) => (moved[i.id] ? { ...i, ...moved[i.id] } : i)), [data, moved, thrown]);
  const links = data?.links ?? [];
  const mine = (i: IdeaItem) => agent(i.author)?.kind === "human";

  // the owner has looked: after a moment nothing here counts as new
  useEffect(() => {
    const t = setTimeout(() => void api(`ideas/${id}/seen`, { method: "POST" }).catch(() => {}), 2500);
    return () => clearTimeout(t);
  }, [id]);

  // the first time the pieces arrive, frame them all
  useEffect(() => {
    const el = surface.current;
    if (fitted.current || !data || !el) return;
    fitted.current = true;
    if (!data.items.length) return;
    const xs = data.items.map((i) => i.x);
    const ys = data.items.map((i) => i.y);
    const w = Math.max(...xs) - Math.min(...xs) + 520;
    const h = Math.max(...ys) - Math.min(...ys) + 420;
    // on a narrow screen what the idea says under its name takes the top: the pieces are framed beneath it
    const under = life.current && life.current.offsetWidth > el.clientWidth * 0.45 ? life.current.offsetTop + life.current.offsetHeight + 8 : 0;
    const k = clamp(Math.min(el.clientWidth / w, (el.clientHeight - under) / h), 0.35, 1);
    setView({ k, x: (-(Math.max(...xs) + Math.min(...xs)) / 2) * k, y: (-(Math.max(...ys) + Math.min(...ys)) / 2) * k + under / 2 });
  }, [data]);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const r = surface.current!.getBoundingClientRect();
      return { x: (clientX - r.left - r.width / 2 - view.x) / view.k, y: (clientY - r.top - r.height / 2 - view.y) / view.k };
    },
    [view],
  );

  // ----- moving about: drag the empty canvas, pinch or ctrl-scroll to zoom -----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pan = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean; pinch?: { d: number; k: number } } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);

  const zoomAt = (clientX: number, clientY: number, k: number) => {
    const r = surface.current!.getBoundingClientRect();
    const px = clientX - r.left - r.width / 2;
    const py = clientY - r.top - r.height / 2;
    setView((v) => {
      const next = clamp(k, 0.3, 2.5);
      return { k: next, x: px - ((px - v.x) / v.k) * next, y: py - ((py - v.y) / v.k) * next };
    });
  };

  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    // a trackpad pinch arrives as a wheel with ctrl held; plain scrolling moves the canvas
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const px = e.clientX - r.left - r.width / 2;
        const py = e.clientY - r.top - r.height / 2;
        setView((v) => {
          const next = clamp(v.k * Math.exp(-e.deltaY * 0.01), 0.3, 2.5);
          return { k: next, x: px - ((px - v.x) / v.k) * next, y: py - ((py - v.y) / v.k) * next };
        });
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  function downOnCanvas(e: React.PointerEvent) {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.canvasBg) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setSelected(null);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pan.current = { x: view.x, y: view.y, vx: 0, vy: 0, moved: true, pinch: { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k } };
    } else pan.current = { x: e.clientX - view.x, y: e.clientY - view.y, vx: e.clientX, vy: e.clientY, moved: false };
  }
  function moveOnCanvas(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId) || !pan.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pan.current;
    if (p.pinch && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (p.pinch.k * Math.hypot(a.x - b.x, a.y - b.y)) / p.pinch.d);
      return;
    }
    if (Math.hypot(e.clientX - p.vx, e.clientY - p.vy) > 4) p.moved = true;
    if (p.moved && !p.pinch) setView((v) => ({ ...v, x: e.clientX - p.x, y: e.clientY - p.y }));
  }
  function upOnCanvas(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const p = pan.current;
    if (pointers.current.size === 0) pan.current = null;
    if (!p || p.moved) return;
    // a second tap in the same place, soon after the first: write here
    const now = performance.now();
    const before = lastTap.current;
    if (before && now - before.t < 340 && Math.hypot(e.clientX - before.x, e.clientY - before.y) < 28) {
      lastTap.current = null;
      setEditing(null);
      setDraft(toWorld(e.clientX, e.clientY));
    } else lastTap.current = { t: now, x: e.clientX, y: e.clientY };
  }

  // ----- what the owner does to a piece -----
  const patchItem = async (itemId: string, body: Record<string, unknown>) => {
    await api(`idea-items/${itemId}`, { method: "PATCH", body }).catch(() => {});
    await mutate();
  };
  const keep = (it: IdeaItem) => {
    void mutate((d) => d && { ...d, items: d.items.map((x) => (x.id === it.id ? { ...x, kept: !it.kept } : x)) }, false);
    void patchItem(it.id, { kept: !it.kept });
  };
  const more = async (it: IdeaItem) => {
    setSaid({ id: it.id, text: "Asking for more" });
    try {
      const r = await api<{ to: string[] }>(`idea-items/${it.id}/more`, { method: "POST" });
      setSaid({ id: it.id, text: r.to?.length ? `Asked ${r.to.join(" and ")} for more` : "Asked for more" });
    } catch {
      setSaid({ id: it.id, text: "Could not ask just now" });
    }
    setTimeout(() => setSaid((s) => (s?.id === it.id ? null : s)), 2200);
  };
  const prune = (it: IdeaItem, fling = { dx: 0, dy: -120 }) => {
    setSelected(null);
    setThrown((t) => ({ ...t, [it.id]: fling }));
    setUndo({ id: it.id, text: it.text ? `“${it.text.length > 32 ? it.text.slice(0, 32) + "…" : it.text}”` : "A picture" });
    void api(`idea-items/${it.id}`, { method: "DELETE" }).catch(() => {});
  };
  const bringBack = async () => {
    if (!undo) return;
    const back = undo.id;
    setUndo(null);
    await api(`idea-items/${back}/restore`, { method: "POST" }).catch(() => {});
    await mutate();
    setThrown((t) => without(t, back));
  };
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(t);
  }, [undo]);

  const join = async (a: string, b: string) => {
    await api(`ideas/${id}/joins`, { body: { a, b } }).catch(() => {});
    await mutate();
  };

  // ----- dragging a piece: move it, join it, throw it, or (held still) ask for more of it -----
  const drag = useRef<{ id: string; ox: number; oy: number; sx: number; sy: number; moved: boolean; hold: ReturnType<typeof setTimeout> | null; held: boolean; trail: { t: number; x: number; y: number }[] } | null>(null);
  const pieceTap = useRef<{ t: number; id: string } | null>(null);

  function downOnPiece(e: React.PointerEvent, it: IdeaItem) {
    if (editing === it.id) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const hold = setTimeout(() => {
      const d = drag.current;
      if (d && d.id === it.id && !d.moved) {
        d.held = true;
        void more(it);
      }
    }, HOLD_MS);
    drag.current = { id: it.id, ox: it.x, oy: it.y, sx: e.clientX, sy: e.clientY, moved: false, hold, held: false, trail: [{ t: performance.now(), x: e.clientX, y: e.clientY }] };
  }
  function moveOnPiece(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    if (d.hold) clearTimeout(d.hold);
    d.trail.push({ t: performance.now(), x: e.clientX, y: e.clientY });
    if (d.trail.length > 6) d.trail.shift();
    const x = d.ox + dx / view.k;
    const y = d.oy + dy / view.k;
    setMoved((m) => ({ ...m, [d.id]: { x, y } }));
    // over another piece: letting go here joins the two
    const over = items.find((o) => o.id !== d.id && Math.abs(o.x - x) < (sizes[o.id]?.w ?? 160) / 2 && Math.abs(o.y - y) < (sizes[o.id]?.h ?? 60) / 2);
    setTarget(over?.id ?? null);
  }
  function upOnPiece(e: React.PointerEvent, it: IdeaItem) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.hold) clearTimeout(d.hold);
    const settle = () => setMoved((m) => without(m, d.id));
    if (!d.moved) {
      if (d.held) return;
      // a second tap soon after the first: keep it, or, on your own words, change them
      const now = performance.now();
      if (pieceTap.current && pieceTap.current.id === it.id && now - pieceTap.current.t < 340) {
        pieceTap.current = null;
        if (mine(it) && it.kind === "text") (setSelected(null), setEditing(it.id));
        else keep(it);
      } else {
        pieceTap.current = { t: now, id: it.id };
        setSelected(it.id);
      }
      return;
    }
    const first = d.trail[0];
    const last = d.trail[d.trail.length - 1];
    const dt = Math.max(1, last.t - first.t);
    const vx = (last.x - first.x) / dt;
    const vy = (last.y - first.y) / dt;
    const over = target;
    setTarget(null);
    if (over) {
      // they belong together: the piece goes home and a join is drawn
      settle();
      void join(d.id, over);
    } else if (Math.hypot(vx, vy) > FLICK && performance.now() - last.t < 80) {
      settle();
      prune(it, { dx: vx * 420, dy: vy * 420 });
    } else {
      const at = { x: d.ox + (e.clientX - d.sx) / view.k, y: d.oy + (e.clientY - d.sy) / view.k };
      void mutate((cur) => cur && { ...cur, items: cur.items.map((x) => (x.id === d.id ? { ...x, ...at } : x)) }, false).then(settle);
      void patchItem(d.id, at);
    }
  }

  // ----- putting things down -----
  async function addText(text: string, at: { x: number; y: number }) {
    setDraft(null);
    if (!text.trim()) return;
    await api(`ideas/${id}/items`, { body: { kind: "text", text: text.trim(), x: at.x, y: at.y, size: text.trim().length <= 28 ? 3 : 2 } }).catch(() => {});
    await mutate();
  }
  async function addImages(files: FileList | File[], at: { x: number; y: number }) {
    let n = 0;
    for (const f of [...files].filter((x) => x.type.startsWith("image/")).slice(0, 6)) {
      const form = new FormData();
      form.append("file", f);
      try {
        const { url } = await api<{ url: string }>("media", { form });
        await api(`ideas/${id}/items`, { body: { kind: "image", image: url, x: at.x + n * 36, y: at.y + n * 36 } });
        n++;
      } catch {
        // a picture that would not upload is left out; the rest still go down
      }
    }
    if (n) await mutate();
  }
  const middle = () => {
    const r = surface.current!.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height / 2);
  };
  useEffect(() => {
    // pasting puts a picture, or a line of text, in the middle of what is in view
    const paste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.some((f) => f.type.startsWith("image/"))) (e.preventDefault(), void addImages(files, middle()));
      else {
        const text = e.clipboardData?.getData("text/plain")?.trim();
        if (text) (e.preventDefault(), void addText(text.slice(0, 2000), middle()));
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  });

  const measure = useCallback((itemId: string, el: HTMLElement | null) => {
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setSizes((s) => (s[itemId]?.w === w && s[itemId]?.h === h ? s : { ...s, [itemId]: { w, h } }));
  }, []);

  const growing = idea?.state !== "resting";
  const chosen = selected ? items.find((i) => i.id === selected) : null;

  // ----- the idea's own life: ready to act on, and the ideas it is near -----
  const [making, setMaking] = useState(false);
  const makeTask = async () => {
    setMaking(true);
    await api(`ideas/${id}/task`, { method: "POST" }).catch(() => {});
    await mutate();
    setMaking(false);
  };
  const notYet = async () => {
    void mutate((d) => d && { ...d, ripe: null }, false);
    await api(`ideas/${id}/not-yet`, { method: "POST" }).catch(() => {});
    await mutate();
  };
  const setAside = async (nearId: string) => {
    void mutate((d) => d && { ...d, near: d.near.filter((n) => n.id !== nearId) }, false);
    await api(`idea-nears/${nearId}`, { method: "DELETE" }).catch(() => {});
    await mutate();
  };

  return (
    <div
      ref={surface}
      data-canvas={id}
      onPointerDown={downOnCanvas}
      onPointerMove={moveOnCanvas}
      onPointerUp={upOnCanvas}
      onPointerCancel={upOnCanvas}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => (e.preventDefault(), e.dataTransfer.files.length && void addImages(e.dataTransfer.files, toWorld(e.clientX, e.clientY)))}
      className="relative -mx-4 -mb-32 -mt-10 h-dvh touch-none select-none overflow-hidden md:-mx-8 md:-mt-14"
      style={{ cursor: pan.current?.moved ? "grabbing" : "default" }}
    >
      {/* a faint field of dots that moves with the canvas, so moving about feels like moving over something */}
      <div data-canvas-bg="1" className="absolute inset-0" style={{ backgroundImage: "radial-gradient(circle, color-mix(in srgb, var(--ink) 9%, transparent) 1px, transparent 1.5px)", backgroundSize: `${28 * view.k}px ${28 * view.k}px`, backgroundPosition: `calc(50% + ${view.x}px) calc(50% + ${view.y}px)` }} />

      <div className="pointer-events-none absolute left-1/2 top-1/2" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: "0 0" }}>
        <Joins items={items} links={links} sizes={sizes} isOwner={(a) => agent(a)?.kind === "human"} />
        <AnimatePresence>
          {items.map((it) => (
            <Piece
              key={it.id}
              it={it}
              owner={mine(it)}
              by={agent(it.author)}
              selected={selected === it.id}
              target={target === it.id}
              dragging={!!moved[it.id]}
              editing={editing === it.id}
              said={said?.id === it.id ? said.text : null}
              measure={measure}
              onDown={(e) => downOnPiece(e, it)}
              onMove={moveOnPiece}
              onUp={(e) => upOnPiece(e, it)}
              onEdited={(text) => (setEditing(null), text.trim() && text.trim() !== it.text && void patchItem(it.id, { text: text.trim() }))}
            />
          ))}
        </AnimatePresence>
        {/* thrown pieces leave in the direction they were flicked */}
        <AnimatePresence>
          {(data?.items ?? [])
            .filter((i) => thrown[i.id])
            .map((it) => (
              <motion.div key={"gone-" + it.id} initial={{ opacity: 0.9, x: it.x, y: it.y }} animate={{ opacity: 0, x: it.x + thrown[it.id].dx, y: it.y + thrown[it.id].dy, rotate: 14, scale: 0.8 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="absolute left-0 top-0 max-w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-[18px] bg-fill px-3 py-2 text-[14px] text-ink2">
                {it.text || "A picture"}
              </motion.div>
            ))}
        </AnimatePresence>
        {draft && <Draft at={draft} onDone={(text) => addText(text, draft)} />}
      </div>

      {/* what a chosen piece offers, for anyone who would rather tap than gesture */}
      <AnimatePresence>
        {chosen && !editing && (
          <motion.div key="acts" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={soft} data-piece-actions className="glass absolute bottom-[calc(max(12px,env(safe-area-inset-bottom))_+_72px)] left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-full p-1 md:bottom-6" onPointerDown={(e) => e.stopPropagation()}>
            <Act label={chosen.kept ? "Kept. Tap to let go" : "Keep: more like this"} on={chosen.kept} onClick={() => keep(chosen)}>
              <Star size={16} fill={chosen.kept ? "currentColor" : "none"} />
            </Act>
            <Act label="More of this" onClick={() => more(chosen)}>
              <Sparkles size={16} />
            </Act>
            {mine(chosen) && chosen.kind === "text" && (
              <>
                <Act label="Smaller" onClick={() => patchItem(chosen.id, { size: clamp(chosen.size - 1, 1, 4) })}>
                  <span className="text-[12px] font-semibold">A</span>
                </Act>
                <Act label="Larger" onClick={() => patchItem(chosen.id, { size: clamp(chosen.size + 1, 1, 4) })}>
                  <span className="text-[17px] font-semibold">A</span>
                </Act>
              </>
            )}
            <Act label="Prune: not this way" onClick={() => prune(chosen)}>
              <Scissors size={16} />
            </Act>
          </motion.div>
        )}
      </AnimatePresence>

      {/* the way back, and the idea's name */}
      <div className="absolute left-3 top-3 z-20 flex max-w-[calc(100%-120px)] items-center gap-1.5 md:left-5 md:top-5" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={onBack} aria-label="All ideas" className="glass grid h-10 w-10 flex-none place-items-center rounded-full text-ink2 transition-colors hover:text-ink">
          <ChevronLeft size={18} />
        </button>
        <input
          value={title ?? idea?.title ?? ""}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== null && title !== idea?.title && void api(`ideas/${id}`, { method: "PATCH", body: { title } }).then(() => mutate())}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          placeholder="Untitled idea"
          aria-label="Idea name"
          className="glass h-10 min-w-0 select-text rounded-full px-4 text-[15px] font-semibold"
          style={{ width: `${clamp((title ?? idea?.title ?? "").length + 4, 14, 34)}ch` }}
        />
      </div>
      <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5 md:right-5 md:top-5" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => file.current?.click()} aria-label="Add a picture" title="Add a picture" className="glass grid h-10 w-10 place-items-center rounded-full text-ink2 transition-colors hover:text-ink">
          <ImagePlus size={17} />
        </button>
        <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => (e.target.files && void addImages(e.target.files, middle()), (e.target.value = ""))} />
        <button
          onClick={() => void api(`ideas/${id}`, { method: "PATCH", body: { state: growing ? "resting" : "growing" } }).then(() => mutate())}
          aria-pressed={!growing}
          aria-label={growing ? "Growing. Tap to let it rest" : "Resting. Tap to let it grow"}
          title={growing ? "Growing: your agents add to it. Tap to let it rest" : "Resting: nothing is added. Tap to let it grow"}
          className={`glass flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-medium transition-colors ${growing ? "text-accent" : "text-ink3"}`}
        >
          {growing ? <Sprout size={16} /> : <Moon size={15} />}
          {growing ? "Growing" : "Resting"}
        </button>
        <div className="glass grid h-10 w-10 place-items-center rounded-full">
          <ConfirmDelete label="Remove idea" confirm="Remove" size={16} onConfirm={async () => (await api(`ideas/${id}`, { method: "DELETE" }), onBack())} />
        </div>
      </div>

      {/* under the name, the idea's own life: ready to act on, the task made of it, and the ideas it is near */}
      {data && (data.ripe || data.task || (data.near?.length ?? 0) > 0) && (
        <div ref={life} data-idea-life className="absolute left-3 top-[60px] z-10 flex max-w-[min(330px,calc(100%-24px))] flex-col items-start gap-1.5 md:left-5 md:top-[68px]" onPointerDown={(e) => e.stopPropagation()}>
          <AnimatePresence initial={false}>
            {data.ripe && (
              <motion.div key="ripe" data-ripe layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={soft} className="glass rounded-[20px] px-3.5 py-2.5">
                <div className="text-[12px] text-ink3">{data.ripe.by ? `${agent(data.ripe.by)?.name ?? "An agent"} thinks this is ready` : "You have kept enough here to act on"}</div>
                {data.ripe.step && <p className="idea-hand mt-0.5 select-text text-[15.5px] font-medium leading-snug [overflow-wrap:anywhere]">{data.ripe.step}</p>}
                <div className="mt-2 flex items-center gap-1.5">
                  <button onClick={makeTask} disabled={making} className="h-8 rounded-full bg-accent-soft px-3 text-[13px] font-medium text-accent disabled:opacity-60">
                    Make a task
                  </button>
                  <button onClick={notYet} className="h-8 rounded-full px-3 text-[13px] text-ink2 transition-colors hover:bg-fill hover:text-ink">
                    Not yet
                  </button>
                </div>
              </motion.div>
            )}
            {data.task && (
              <motion.div key="task" layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={soft}>
                <Link href={`/todos?open=${data.task.id}`} data-idea-task className="glass flex h-9 max-w-full items-center gap-1.5 rounded-full pl-2.5 pr-3.5 text-[13px] text-ink2 transition-colors hover:text-ink">
                  <span className={`grid h-5 w-5 flex-none place-items-center rounded-full ${data.task.done ? "bg-accent text-white" : "border border-[var(--fill-strong)]"}`}>{data.task.done && <Check size={12} strokeWidth={3} />}</span>
                  <span className={`truncate ${data.task.done ? "line-through decoration-[var(--line)]" : ""}`}>{data.task.title}</span>
                </Link>
              </motion.div>
            )}
            {(data.near ?? []).map((n) => (
              <motion.div key={n.id} data-near={n.idea.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={soft} className="glass flex h-9 max-w-full items-center rounded-full pl-3.5 pr-1 text-[13px]">
                <button onClick={() => onOpen(n.idea.id)} title={`${agent(n.author)?.name ?? "An agent"}: ${n.label}`} className="flex min-w-0 items-baseline gap-1.5 text-left text-ink2 transition-colors hover:text-ink">
                  <span className="flex-none text-ink3">Near</span>
                  <span className="truncate font-medium">{n.idea.title || "Untitled idea"}</span>
                  <span className="idea-hand hidden truncate text-[12px] italic text-ink3 sm:inline">{n.label}</span>
                </button>
                <button onClick={() => setAside(n.id)} aria-label={`Not related to ${n.idea.title || "that idea"}`} title="Not related" className="ml-1 grid h-7 w-7 flex-none place-items-center rounded-full text-ink3 transition-colors hover:bg-fill hover:text-ink">
                  <X size={13} />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* an empty canvas says how to begin, once, in a line */}
      {data && !items.length && !draft && (
        <p className="pointer-events-none absolute inset-x-6 top-1/2 -translate-y-1/2 text-center text-[15px] leading-relaxed text-ink3">
          Double-tap anywhere to put something down.
          <br />
          Drop or paste a picture.
        </p>
      )}

      {/* a pruned piece can be brought back for a moment */}
      <AnimatePresence>
        {undo && (
          <motion.div key="undo" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={soft} role="status" className="glass absolute bottom-[calc(max(12px,env(safe-area-inset-bottom))_+_72px)] left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full py-1.5 pl-4 pr-1.5 text-[13.5px] text-ink2 md:bottom-6" onPointerDown={(e) => e.stopPropagation()}>
            <span className="max-w-[46vw] truncate">Pruned {undo.text}</span>
            <button onClick={bringBack} className="h-8 rounded-full bg-accent-soft px-3 font-medium text-accent">
              Bring back
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Act({ label, on, onClick, children }: { label: string; on?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} aria-pressed={on} onClick={onClick} className={`grid h-10 w-10 place-items-center rounded-full transition-colors ${on ? "bg-accent-soft text-accent" : "text-ink2 hover:bg-fill hover:text-ink"}`}>
      {children}
    </button>
  );
}

/** Text being written straight onto the canvas. Enter puts it down; Escape, or leaving it empty, puts nothing. */
function Draft({ at, onDone }: { at: { x: number; y: number }; onDone: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const finish = (text: string) => {
    if (done.current) return;
    done.current = true;
    onDone(text);
  };
  // placed a frame after it appears, as anything focused on arrival must be
  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);
  return (
    <textarea
      ref={ref}
      rows={1}
      aria-label="Write on the canvas"
      placeholder="Write…"
      onPointerDown={(e) => e.stopPropagation()}
      onInput={(e) => ((e.currentTarget.style.height = "0px"), (e.currentTarget.style.height = e.currentTarget.scrollHeight + "px"))}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), finish(e.currentTarget.value));
        if (e.key === "Escape") finish("");
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      className="idea-hand pointer-events-auto absolute left-0 top-0 w-[320px] -translate-x-1/2 -translate-y-1/2 select-text resize-none overflow-hidden rounded-[16px] bg-[color-mix(in_srgb,var(--surface)_70%,transparent)] px-3 py-2 text-center text-[24px] font-semibold leading-tight outline-none ring-2 ring-[var(--accent-soft)]"
      style={{ transform: `translate(${at.x}px, ${at.y}px)` }}
    />
  );
}

/** A tilt of a degree or two, the same every time for the same piece, so pictures sit as if placed by hand. */
const tilt = (id: string) => ((hash(id) % 300) / 100 - 1.5).toFixed(2);

function Piece({
  it,
  owner,
  by,
  selected,
  target,
  dragging,
  editing,
  said,
  measure,
  onDown,
  onMove,
  onUp,
  onEdited,
}: {
  it: IdeaItem;
  owner: boolean;
  by: ReturnType<ReturnType<typeof useMe>["agent"]>;
  selected: boolean;
  target: boolean;
  dragging: boolean;
  editing: boolean;
  said: string | null;
  measure: (id: string, el: HTMLElement | null) => void;
  onDown: (e: React.PointerEvent) => void;
  onMove: (e: React.PointerEvent) => void;
  onUp: (e: React.PointerEvent) => void;
  onEdited: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => measure(it.id, ref.current));
  // each agent's pieces carry its own quiet tint, so who added what is seen without a label
  const tint = PALETTES[hash(by?.handle ?? "?") % PALETTES.length];
  const ring = target ? "ring-2 ring-accent" : selected ? "ring-2 ring-[var(--accent-soft)]" : "";
  return (
    <motion.div
      ref={ref}
      data-piece={it.id}
      data-kind={it.kind}
      data-by={owner ? "owner" : "agent"}
      data-kept={it.kept || undefined}
      initial={{ opacity: 0, scale: 0.7, x: it.x, y: it.y }}
      animate={{ opacity: 1, scale: dragging ? 1.04 : 1, x: it.x, y: it.y }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={dragging ? { duration: 0 } : spring}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className={`pointer-events-auto absolute left-0 top-0 w-max -translate-x-1/2 -translate-y-1/2 ${dragging ? "z-10 cursor-grabbing" : "cursor-grab"}`}
    >
      {owner && it.kind === "text" ? (
        editing ? (
          <textarea
            defaultValue={it.text}
            autoFocus
            aria-label="Change the words"
            onPointerDown={(e) => e.stopPropagation()}
            onFocus={(e) => ((e.currentTarget.style.height = e.currentTarget.scrollHeight + "px"), e.currentTarget.select())}
            onInput={(e) => ((e.currentTarget.style.height = "0px"), (e.currentTarget.style.height = e.currentTarget.scrollHeight + "px"))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), e.currentTarget.blur());
              if (e.key === "Escape") ((e.currentTarget.value = it.text), e.currentTarget.blur());
            }}
            onBlur={(e) => onEdited(e.currentTarget.value)}
            className={`idea-hand w-[320px] select-text resize-none overflow-hidden rounded-[16px] bg-[color-mix(in_srgb,var(--surface)_70%,transparent)] px-3 py-2 text-center outline-none ring-2 ring-[var(--accent-soft)] ${FONT[it.size] ?? FONT[2]}`}
          />
        ) : (
          <div className={`idea-hand max-w-[340px] whitespace-pre-wrap rounded-[16px] px-3 py-2 text-center [overflow-wrap:anywhere] ${FONT[it.size] ?? FONT[2]} ${ring}`}>{it.text}</div>
        )
      ) : it.kind === "image" && owner ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={it.image ?? ""} alt="" draggable={false} className={`block max-h-[260px] max-w-[280px] rounded-[20px] object-cover shadow-[0_10px_30px_rgba(0,0,0,.12)] ${ring}`} style={{ rotate: `${tilt(it.id)}deg` }} />
      ) : (
        <div className={`relative w-[236px] overflow-hidden rounded-[20px] ${ring}`} style={{ background: `color-mix(in srgb, ${tint.colors[0]} 26%, var(--surface))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tint.colors[0]} 55%, transparent), 0 8px 24px rgba(0,0,0,.07)` }}>
          {it.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={it.image} alt="" draggable={false} className="block max-h-[170px] w-full object-cover" />
          )}
          <div className="px-3.5 pb-3 pt-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-[11.5px] text-ink3">
              {by && <Avatar agent={by} size={15} />}
              <span className="truncate">{by?.name}</span>
              {KIND_WORD[it.kind] && <span className="rounded-full bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] px-1.5 py-px font-medium">{KIND_WORD[it.kind]}</span>}
            </div>
            {it.text && <p className="whitespace-pre-wrap text-[14.5px] leading-snug text-ink [overflow-wrap:anywhere]">{it.text}</p>}
            {it.source?.url && (
              <a href={it.source.url} target="_blank" rel="noreferrer" onPointerDown={(e) => e.stopPropagation()} className="mt-1.5 inline-flex max-w-full items-center gap-0.5 text-[12px] text-ink2 underline decoration-[var(--line)] underline-offset-[3px] hover:text-ink">
                <span className="truncate">{it.source.name || it.source.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}</span>
                <ArrowUpRight size={11} className="flex-none text-ink3" />
              </a>
            )}
          </div>
        </div>
      )}
      {/* kept: a small star at its corner. New since the owner last looked: a soft accent dot. */}
      {it.kept && (
        <span aria-label="Kept" className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-accent text-white shadow-[0_2px_6px_rgba(0,0,0,.18)]">
          <Star size={11} fill="currentColor" />
        </span>
      )}
      {!it.seen && !it.kept && <span aria-label="New" className="idea-new absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-accent" />}
      <AnimatePresence>
        {said && (
          <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status" className="glass absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-[12.5px] font-medium text-accent">
            {said}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** Where a line from the middle of a box towards a point leaves the box, a little outside it. */
function edge(c: { x: number; y: number }, s: Size | undefined, to: { x: number; y: number }) {
  const hw = (s?.w ?? 120) / 2 + 10;
  const hh = (s?.h ?? 44) / 2 + 10;
  const dx = to.x - c.x;
  const dy = to.y - c.y;
  if (!dx && !dy) return c;
  const t = Math.min(hw / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6));
  return { x: c.x + dx * Math.min(t, 1), y: c.y + dy * Math.min(t, 1) };
}

/**
 * The joins: soft curved lines between pieces that belong together, each bowed a little to one
 * side so no two look ruled. An agent's join carries its two or three words; the owner's own are
 * drawn in accent.
 */
function Joins({ items, links, sizes, isOwner }: { items: IdeaItem[]; links: IdeaLink[]; sizes: Record<string, Size>; isOwner: (author: string) => boolean }) {
  const at = (id: string) => items.find((i) => i.id === id);
  return (
    <svg className="absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden>
      {links.map((l) => {
        const a = at(l.a);
        const b = at(l.b);
        if (!a || !b) return null;
        const p = edge(a, sizes[a.id], b);
        const q = edge(b, sizes[b.id], a);
        const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        // bowed to one side or the other, by an amount that depends on the join and never changes
        const bow = (hash(l.id) % 2 ? 1 : -1) * (0.1 + (hash(l.id) % 9) / 100) * len;
        const mx = (p.x + q.x) / 2 + (-(q.y - p.y) / len) * bow;
        const my = (p.y + q.y) / 2 + ((q.x - p.x) / len) * bow;
        const mine = isOwner(l.author);
        return (
          <g key={l.id} data-join={l.id}>
            <motion.path
              d={`M ${p.x} ${p.y} Q ${mx} ${my} ${q.x} ${q.y}`}
              fill="none"
              stroke={mine ? "var(--accent)" : "var(--ink3)"}
              strokeOpacity={mine ? 0.55 : 0.5}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeDasharray={mine ? undefined : "0.1 7"}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            />
            <circle cx={q.x} cy={q.y} r={2.6} fill={mine ? "var(--accent)" : "var(--ink3)"} opacity={0.6} />
            {l.label && (
              <text x={(p.x + 2 * mx + q.x) / 4} y={(p.y + 2 * my + q.y) / 4 - 6} textAnchor="middle" className="idea-hand" fontSize={12} fontStyle="italic" fill="var(--ink3)">
                {l.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
