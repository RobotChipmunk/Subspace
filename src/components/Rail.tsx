"use client";
import {
  ArrowUpRight, Banknote, BedDouble, Bell, CalendarDays, Car, ChevronDown, CircleCheck, CircleHelp, Clock, CloudSun, CreditCard, FileText, Gift, GraduationCap,
  HeartPulse, House, KeyRound, Mail, MapPin, Package, Phone, Plane, ShoppingCart, Ticket, TrainFront, TriangleAlert, User, Utensils, Wrench, X, type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import useSWR, { useSWRConfig } from "swr";
import { ago, api, fetcher, soft, spring, useMe } from "@/lib/client";
import type { AnyBlock } from "@/lib/blocks";
import type { RailIcon, RailModule } from "@/lib/core/rail";
import { Avatar } from "./bits";
import { BlockView } from "./blocks/BlockView";

/** Width at which the rail docks beside the content instead of opening as a sheet. */
export const RAIL_DOCK = "(min-width: 1100px)";

/** True when the screen is wide enough to dock the rail. */
function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(RAIL_DOCK);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(RAIL_DOCK).matches,
    () => false,
  );
}

export function useRail() {
  const { data, mutate } = useSWR<{ modules: RailModule[] }>("rail", fetcher, { refreshInterval: 30_000 });
  const { mutate: globalMutate } = useSWRConfig();
  const [sheet, setSheet] = useState(false);
  const modules = data?.modules ?? [];
  const wide = useWide();
  /** Takes a module off the screen at once, tells the server why, then lets the rail catch up. */
  const clear = async (id: string, tell: () => Promise<unknown>) => {
    mutate({ modules: modules.filter((m) => m.id !== id) }, false);
    await tell().catch(() => {});
    mutate();
  };
  return {
    modules,
    /** The most serious thing waiting: colours the count on the rail button. */
    level: modules.some((m) => m.level === "error") ? ("error" as const) : modules.some((m) => m.level === "warning") ? ("warning" as const) : ("info" as const),
    wide,
    /** On a wide screen the rail is simply there whenever it has something to show. */
    docked: wide && modules.length > 0,
    /** On a narrow screen there is no room to dock, so it opens as a sheet from the nav. */
    sheet: sheet && !wide && modules.length > 0,
    openSheet: () => setSheet(true),
    close: () => setSheet(false),
    /** Closed without acting on it. */
    dismiss: (id: string) => clear(id, () => api(`rail/${id}`, { method: "DELETE" })),
    /** One of a module's buttons was tapped. That is what it was there for, so it leaves the rail. */
    acted: (m: RailModule, label: string) => clear(m.id, () => api(`rail/${m.id}/action`, { method: "POST", body: { label } })),
    /** "Later": the module becomes a task on that day and leaves the rail. */
    later: (m: RailModule, view: string) => clear(m.id, () => api(`rail/${m.id}/later`, { method: "POST", body: { view } }).then(() => globalMutate((k) => typeof k === "string" && k.startsWith("todos")))),
  };
}
export type RailState = ReturnType<typeof useRail>;

/** The small picture at the front of a module. The names are the ones agents choose from (RAIL_ICONS). */
const ICONS: Record<RailIcon, LucideIcon> = {
  bell: Bell, calendar: CalendarDays, clock: Clock, plane: Plane, train: TrainFront, car: Car, bed: BedDouble, food: Utensils, package: Package, pin: MapPin,
  ticket: Ticket, money: Banknote, card: CreditCard, document: FileText, mail: Mail, phone: Phone, person: User, home: House, health: HeartPulse, cart: ShoppingCart,
  weather: CloudSun, key: KeyRound, tool: Wrench, gift: Gift, school: GraduationCap, alert: TriangleAlert, check: CircleCheck, question: CircleHelp,
};

/** What a module is, at a glance: a problem, something that needs the owner, or something to know. It colours the icon. */
const toneOf = (m: RailModule) => (m.level === "error" ? "error" : m.level === "warning" ? "warning" : m.task || m.todo ? "act" : "know");

/** A real picture of the thing when there is one; otherwise its icon, or the usual one for what it is. */
function Tile({ m }: { m: RailModule }) {
  const [broken, setBroken] = useState(false);
  if (m.image && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={m.image} alt="" loading="lazy" onError={() => setBroken(true)} className="h-9 w-9 flex-none rounded-[11px] bg-fill object-cover" />;
  }
  const Icon = ICONS[m.icon as RailIcon] ?? (m.level !== "info" ? TriangleAlert : m.todo ? User : m.task ? CircleCheck : Bell);
  return (
    <span aria-hidden data-tone={toneOf(m)} className="rail-tile grid h-9 w-9 flex-none place-items-center rounded-[11px]">
      <Icon size={18} strokeWidth={1.9} />
    </span>
  );
}

const PILL = "flex h-8 items-center gap-1 whitespace-nowrap rounded-full px-3 text-[13px] font-medium transition-colors disabled:opacity-40";
/** The one thing to do. */
const PRIMARY = `${PILL} bg-accent-soft text-accent hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)]`;
const QUIET = `${PILL} bg-fill hover:bg-fill2`;

/** The days a module can be kept for, or a waiting task given. */
const DAYS = [["today", "Today"], ["tomorrow", "Tomorrow"], ["week", "This week"]] as const;
function Days({ busy, onPick, primary, only = DAYS.length, even }: { busy: boolean; onPick: (view: string) => void; /** the first is the usual choice */ primary?: boolean; /** how many to offer */ only?: number; /** share one line equally */ even?: boolean }) {
  return (
    <>
      {DAYS.slice(0, only).map(([view, label], i) => (
        <button key={view} disabled={busy} onClick={() => onPick(view)} className={`${primary && i === 0 ? PRIMARY : QUIET} ${even ? "flex-1 justify-center !px-1" : ""}`}>
          {label}
        </button>
      ))}
    </>
  );
}

type Button = { label: string; url: string };

/**
 * One module: a notification. Closed, it is a glance: a picture or icon, when, what, and the one
 * thing to do. Opened, it adds a sentence, one small block and its other buttons. Any button
 * takes it off the rail; "Later" keeps it as a task first.
 */
function Module({ m, open, onToggle, onDismiss, onAct, onLater, onLeave }: { m: RailModule; open: boolean; onToggle: () => void; onDismiss: () => void; /** one of its buttons was tapped */ onAct: (label: string) => void; onLater: (view: string) => void; /** a button leads to another screen of the app */ onLeave: () => void }) {
  const { agent } = useMe();
  const { mutate } = useSWRConfig();
  const by = agent(m.author);
  const [busy, setBusy] = useState(false);
  // "Later" asks which day; closing the module takes the question back
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!open) setAsking(false);
  }, [open]);
  // what it offers, most important first: its own actions, then the task and the page it points at
  const buttons: Button[] = [...m.actions, ...(m.task ? [{ label: "Open task", url: `/todos?open=${m.task.id}` }] : []), ...(m.page ? [{ label: "Open page", url: `/page/${m.page.id}` }] : [])];
  const shown = open ? buttons : buttons.slice(0, 1);
  const waiting = m.todo;
  /** A task waiting for a day is given one, and leaves the rail by having it. */
  const place = async (view: string) => {
    setBusy(true);
    try {
      await api(`todos/${waiting!.id}`, { method: "PATCH", body: { view } });
      await mutate((k) => typeof k === "string" && (k === "rail" || k.startsWith("todos")));
    } finally {
      setBusy(false);
    }
  };
  const tone = toneOf(m);
  const tint = tone === "error" ? "text-danger" : tone === "warning" ? "text-[var(--warn)]" : "text-ink3";
  return (
    <motion.article layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={soft} className={`rail-module relative rounded-[18px] ${open ? "is-open" : ""}`} data-rail-module={m.key} data-level={m.level} data-tone={tone}>
      <button onClick={onToggle} aria-expanded={open} className={`flex w-full items-start gap-2.5 rounded-[18px] pb-1.5 pl-3 pt-3 text-left ${waiting ? "pr-3" : "pr-9"}`}>
        <Tile m={m} />
        <span className="min-w-0 flex-1">
          {(m.label || m.level !== "info") && (
            <span className={`flex items-center gap-1.5 text-[11.5px] font-medium leading-[1.35] ${tint}`}>
              <span className="truncate">{m.label || (m.level === "error" ? "Error" : "Warning")}</span>
              {m.level !== "info" && m.label && <span className="sr-only">{m.level}</span>}
            </span>
          )}
          <span data-rail-title className={`text-[14.5px] font-medium leading-snug [overflow-wrap:anywhere] ${open ? "block" : "line-clamp-2"}`}>
            {m.title}
          </span>
        </span>
      </button>
      {/* closed without acting. A waiting task has none: it leaves by being given a day, so it cannot be missed. */}
      {!waiting && (
        <button onClick={onDismiss} aria-label={`Dismiss ${m.title}`} title="Dismiss" className="rail-x absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-full text-ink3 transition-colors hover:bg-fill hover:text-ink">
          <X size={14} />
        </button>
      )}
      <AnimatePresence initial={false}>
        {open && (m.subtitle || m.blocks.length > 0) && (
          <motion.div key="more" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={soft} className="overflow-hidden">
            <div className="pb-2 pl-[58px] pr-3">
              {m.subtitle && <p className="text-[13px] leading-snug text-ink2 [overflow-wrap:anywhere]">{m.subtitle}</p>}
              {m.blocks.length > 0 && (
                <div className={`rail-blocks -ml-[46px] flex flex-col gap-2.5 ${m.subtitle ? "mt-2.5" : "mt-1"}`}>
                  {m.blocks.map((b, i) => (
                    <BlockView key={i} block={(b.type === "cards" ? { ...b, layout: "list" } : b) as AnyBlock} />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {asking ? (
        // "Later" asks one thing: which day. It takes the whole width, so the three days sit on one line.
        <div className="px-3 pb-3" data-rail-later>
          <div className="mb-1.5 flex h-6 items-center justify-between text-[11.5px] text-ink3">
            <span>Keep as a task for</span>
            <button onClick={() => setAsking(false)} className="-mr-1.5 rounded-full px-2 py-1 transition-colors hover:bg-fill hover:text-ink">
              Cancel
            </button>
          </div>
          <div className="flex gap-1.5">
            <Days busy={busy} onPick={(view) => (setBusy(true), onLater(view))} even />
          </div>
        </div>
      ) : (
        // what to do about it: always in sight, and in the same place opened or closed
        <div className={`flex items-end gap-1 pl-[58px] pr-1.5 ${open ? "pb-1" : "pb-2.5"}`}>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" data-rail-actions>
            {waiting ? (
              <>
                <Days busy={busy} onPick={place} primary only={open ? 3 : 2} />
                {open && (
                  <Link href={`/todos?open=${waiting.id}`} onClick={onLeave} className={`${QUIET} text-ink2`}>
                    Open
                  </Link>
                )}
              </>
            ) : (
              <>
                {shown.map((a, i) =>
                  a.url.startsWith("/") ? (
                    <Link key={i} href={a.url} onClick={() => (onLeave(), onAct(a.label))} className={i === 0 ? PRIMARY : QUIET}>
                      {a.label}
                    </Link>
                  ) : (
                    <a key={i} href={a.url} onClick={() => onAct(a.label)} {...(a.url.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})} className={i === 0 ? PRIMARY : QUIET}>
                      {a.label}
                      {a.url.startsWith("http") && <ArrowUpRight size={12} className="opacity-60" />}
                    </a>
                  ),
                )}
                {/* nothing to do but know it: saying so is the action */}
                {buttons.length === 0 && (
                  <button onClick={() => onAct("Got it")} className={`${QUIET} text-ink2`}>
                    Got it
                  </button>
                )}
              </>
            )}
          </div>
          <button onClick={onToggle} tabIndex={-1} aria-hidden className="grid h-8 w-8 flex-none place-items-center rounded-full text-ink3 transition-colors hover:bg-fill hover:text-ink">
            <ChevronDown size={15} className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      )}
      <AnimatePresence initial={false}>
        {open && !asking && (
          <motion.div key="foot" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={soft} className="overflow-hidden">
            {/* who says so, and the way to put it off without losing it */}
            <div className="flex h-9 items-center gap-1.5 pb-1 pl-[58px] pr-1.5 text-[11.5px] text-ink3">
              {by && <Avatar agent={by} size={14} />}
              <span className="min-w-0 flex-1 truncate">{[by?.name, ago(m.updated_at)].filter(Boolean).join(" · ")}</span>
              {!waiting && (
                <button onClick={() => setAsking(true)} className="flex h-8 items-center rounded-full px-2.5 text-[13px] font-medium text-ink2 transition-colors hover:bg-fill hover:text-ink">
                  Later
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

function Modules({ rail }: { rail: RailState }) {
  // one open at a time, so the rail never grows into a second page
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <AnimatePresence initial={false} mode="popLayout">
        {rail.modules.map((m) => (
          <Module key={m.id} m={m} open={openId === m.id} onToggle={() => setOpenId(openId === m.id ? null : m.id)} onDismiss={() => rail.dismiss(m.id)} onAct={(label) => rail.acted(m, label)} onLater={(view) => rail.later(m, view)} onLeave={rail.close} />
        ))}
      </AnimatePresence>
      {rail.modules.length === 0 && <p className="px-3 py-8 text-[13.5px] text-ink3">Nothing timely right now.</p>}
    </div>
  );
}

const Header = ({ onClose }: { onClose?: () => void }) => (
  <div className="mb-2 flex h-8 items-center justify-between pl-3">
    <h2 className="text-[13px] font-semibold text-ink3">Now</h2>
    {onClose && (
      <button onClick={onClose} aria-label="Close" title="Close" className="grid h-8 w-8 place-items-center rounded-full text-ink3 transition-colors hover:bg-fill hover:text-ink">
        <X size={16} />
      </button>
    )}
  </div>
);

/** Docked beside the content on a wide screen; a sheet from the right edge on a narrow one. */
export function Rail({ rail, docked = rail.docked }: { rail: RailState; docked?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && rail.sheet && rail.close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <>
      <AnimatePresence initial={false}>
        {docked && (
          <motion.aside key="dock" aria-label="Now" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={soft} className="scroll fixed bottom-0 right-0 top-0 z-20 w-[var(--rail-w)] px-3 pb-6 pt-5">
            <Header />
            <Modules rail={rail} />
          </motion.aside>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {rail.sheet && (
          <motion.div key="sheet" className="fixed inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <div className="absolute inset-0 bg-black/25" onClick={rail.close} />
            <motion.aside aria-label="Now" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={spring} className="rail-sheet scroll absolute inset-y-0 right-0 w-[min(360px,88vw)] px-3 pb-10 pt-5">
              <Header onClose={rail.close} />
              <Modules rail={rail} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
