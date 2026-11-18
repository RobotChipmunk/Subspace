"use client";
import { ArrowUpRight, ChevronDown, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import useSWR, { useSWRConfig } from "swr";
import { ago, api, fetcher, soft, spring, useMe } from "@/lib/client";
import type { AnyBlock } from "@/lib/blocks";
import type { RailModule } from "@/lib/core/rail";
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
  const [sheet, setSheet] = useState(false);
  const modules = data?.modules ?? [];
  const wide = useWide();
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
    dismiss: async (id: string) => {
      mutate({ modules: modules.filter((m) => m.id !== id) }, false);
      await api(`rail/${id}`, { method: "DELETE" });
      mutate();
    },
    /**
     * One of a module's buttons was tapped (an action, its page or its task). A module that
     * clears on that leaves the rail at once; any other stays where it is.
     */
    acted: async (m: RailModule) => {
      if (m.clears_on !== "action") return;
      mutate({ modules: modules.filter((x) => x.id !== m.id) }, false);
      await api(`rail/${m.id}/action`, { method: "POST" }).catch(() => {});
      mutate();
    },
  };
}
export type RailState = ReturnType<typeof useRail>;

/**
 * One module. Closed, it is quiet: when, and what in at most two lines. Everything else
 * (picture, details, buttons) waits behind a tap.
 */
/** For a task waiting for a day: one tap puts it on the list. It leaves the rail as soon as it has a place. */
function Place({ id, onOpen }: { id: string; onOpen: () => void }) {
  const { mutate } = useSWRConfig();
  const [busy, setBusy] = useState(false);
  const move = async (view: string) => {
    setBusy(true);
    try {
      await api(`todos/${id}`, { method: "PATCH", body: { view } });
      await mutate((k) => typeof k === "string" && (k === "rail" || k.startsWith("todos")));
    } finally {
      setBusy(false);
    }
  };
  const cls = "flex h-8 items-center rounded-full bg-fill px-3 text-[13px] font-medium transition-colors hover:bg-fill2 disabled:opacity-40";
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {[["today", "Today"], ["tomorrow", "Tomorrow"], ["week", "This week"]].map(([view, label]) => (
        <button key={view} disabled={busy} onClick={() => move(view)} className={cls}>
          {label}
        </button>
      ))}
      <Link href={`/todos?open=${id}`} onClick={onOpen} className={`${cls} text-ink2`}>
        Open
      </Link>
    </div>
  );
}

function Module({ m, open, onToggle, onDismiss, onAct }: { m: RailModule; open: boolean; onToggle: () => void; onDismiss: () => void; /** one of its buttons was tapped; inside: it leads to another screen of the app */ onAct: (inside: boolean) => void }) {
  const { agent } = useMe();
  const by = agent(m.author);
  // the task it is about comes first: for a follow-up that is the one thing to do here
  const actions = [...(m.task ? [{ label: "Open task", url: `/todos?open=${m.task.id}` }] : []), ...m.actions, ...(m.page ? [{ label: "Open page", url: `/page/${m.page.id}` }] : [])];
  return (
    <motion.article layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={soft} className={`rail-module overflow-hidden rounded-[18px] ${open ? "is-open" : ""}`} data-rail-module={m.key} data-level={m.level}>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <span className="min-w-0 flex-1">
          {(m.label || m.level !== "info") && (
            <span className={`flex items-center gap-1.5 text-[11.5px] font-medium ${m.level === "error" ? "text-danger" : m.level === "warning" ? "text-[var(--warn)]" : "text-ink3"}`}>
              {m.level !== "info" && <span aria-hidden className="h-[6px] w-[6px] flex-none rounded-full bg-current" />}
              <span className="truncate">{m.label || (m.level === "error" ? "Error" : "Warning")}</span>
              {m.level !== "info" && m.label && <span className="sr-only">{m.level}</span>}
            </span>
          )}
          <span className={`text-[14.5px] font-medium leading-snug [overflow-wrap:anywhere] ${open ? "block" : "line-clamp-2"}`}>{m.title}</span>
        </span>
        <ChevronDown size={15} className={`shrink-0 text-ink3 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="more" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={soft} className="overflow-hidden">
            <div className="px-3 pb-3">
              {m.subtitle && <p className="text-[13px] leading-snug text-ink2">{m.subtitle}</p>}
              {m.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.image} alt="" loading="lazy" className="mt-2.5 h-[104px] w-full rounded-[12px] bg-fill object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
              )}
              {m.blocks.length > 0 && (
                <div className="rail-blocks mt-2.5 flex flex-col gap-2.5">
                  {m.blocks.map((b, i) => (
                    <BlockView key={i} block={(b.type === "cards" ? { ...b, layout: "list" } : b) as AnyBlock} />
                  ))}
                </div>
              )}
              {m.todo && <Place id={m.todo.id} onOpen={() => onAct(true)} />}
              {actions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {actions.map((a, i) =>
                    a.url.startsWith("/") ? (
                      <Link key={i} href={a.url} onClick={() => onAct(true)} className="flex h-8 items-center gap-1 rounded-full bg-fill px-3 text-[13px] font-medium transition-colors hover:bg-fill2">
                        {a.label}
                      </Link>
                    ) : (
                      <a key={i} href={a.url} onClick={() => onAct(false)} {...(a.url.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})} className="flex h-8 items-center gap-1 rounded-full bg-fill px-3 text-[13px] font-medium transition-colors hover:bg-fill2">
                        {a.label}
                        {a.url.startsWith("http") && <ArrowUpRight size={12} className="text-ink3" />}
                      </a>
                    ),
                  )}
                </div>
              )}
              <div className="mt-3 flex items-center gap-1.5 text-[11.5px] text-ink3">
                {by && <Avatar agent={by} size={14} />}
                <span className="min-w-0 flex-1 truncate">
                  {by?.name} · {ago(m.updated_at)}
                </span>
                {/* a waiting task stays until it is given a day, so it cannot be missed */}
                {!m.todo && (
                  <button onClick={onDismiss} aria-label={`Dismiss ${m.title}`} className="-my-1 rounded-full px-2 py-1 transition-colors hover:bg-fill hover:text-ink">
                    Dismiss
                  </button>
                )}
              </div>
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
    <div className="flex flex-col gap-0.5">
      <AnimatePresence initial={false} mode="popLayout">
        {rail.modules.map((m) => (
          <Module key={m.id} m={m} open={openId === m.id} onToggle={() => setOpenId(openId === m.id ? null : m.id)} onDismiss={() => rail.dismiss(m.id)} onAct={(inside) => (inside && rail.close(), rail.acted(m))} />
        ))}
      </AnimatePresence>
      {rail.modules.length === 0 && <p className="px-3 py-8 text-[13.5px] text-ink3">Nothing timely right now.</p>}
    </div>
  );
}

const Header = ({ onClose }: { onClose?: () => void }) => (
  <div className="mb-1.5 flex h-8 items-center justify-between pl-3">
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
          <motion.aside key="dock" aria-label="Now" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={soft} className="scroll fixed bottom-0 right-0 top-0 z-20 w-[288px] px-3 pb-6 pt-5">
            <Header />
            <Modules rail={rail} />
          </motion.aside>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {rail.sheet && (
          <motion.div key="sheet" className="fixed inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <div className="absolute inset-0 bg-black/25" onClick={rail.close} />
            <motion.aside aria-label="Now" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={spring} className="rail-sheet scroll absolute inset-y-0 right-0 w-[min(340px,88vw)] px-3 pb-10 pt-5">
              <Header onClose={rail.close} />
              <Modules rail={rail} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
