"use client";
import { ArrowUpRight, PanelRightClose, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import useSWR from "swr";
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
  const [open, setOpenState] = useState(true);
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("ss_rail") === "closed") setOpenState(false);
    } catch {}
  }, []);
  const setOpen = (v: boolean) => {
    setOpenState(v);
    try {
      localStorage.setItem("ss_rail", v ? "open" : "closed");
    } catch {}
  };
  const modules = data?.modules ?? [];
  const wide = useWide();
  return {
    modules,
    open,
    docked: wide && open && modules.length > 0,
    sheet: sheet && !wide,
    /** The one control: docks or undocks on a wide screen, opens the sheet on a narrow one. */
    toggle: () => (wide ? setOpen(!open) : setSheet(!sheet)),
    close: () => (wide ? setOpen(false) : setSheet(false)),
    dismiss: async (id: string) => {
      mutate({ modules: modules.filter((m) => m.id !== id) }, false);
      await api(`rail/${id}`, { method: "DELETE" });
      mutate();
    },
  };
}
export type RailState = ReturnType<typeof useRail>;

function Module({ m, onDismiss }: { m: RailModule; onDismiss: () => void }) {
  const { agent } = useMe();
  const by = agent(m.author);
  const actions = [...m.actions, ...(m.page ? [{ label: "Open page", url: `/page/${m.page.id}` }] : [])];
  return (
    <motion.article layout="position" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={soft} className="glass group/mod relative overflow-hidden rounded-[22px]" data-rail-module={m.key}>
      {m.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.image} alt="" loading="lazy" className="h-[112px] w-full bg-fill object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
      )}
      <button onClick={onDismiss} aria-label={`Dismiss ${m.title}`} title="Dismiss" className="absolute right-2 top-2 z-[1] grid h-7 w-7 place-items-center rounded-full text-ink3 opacity-60 transition-all hover:bg-fill hover:text-ink hover:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/mod:opacity-100">
        <X size={14} />
      </button>
      <div className="p-3.5">
        {m.label && <div className="mb-0.5 pr-7 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-accent">{m.label}</div>}
        <h3 className="pr-7 text-[15.5px] font-semibold leading-snug">{m.title}</h3>
        {m.subtitle && <p className="text-[13px] leading-snug text-ink2">{m.subtitle}</p>}
        {m.blocks.length > 0 && (
          <div className="rail-blocks mt-3 flex flex-col gap-2.5">
            {m.blocks.map((b, i) => (
              <BlockView key={i} block={(b.type === "cards" ? { ...b, layout: "list" } : b) as AnyBlock} />
            ))}
          </div>
        )}
        {actions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {actions.map((a, i) =>
              a.url.startsWith("/") ? (
                <Link key={i} href={a.url} className="flex h-8 items-center gap-1 rounded-full bg-fill px-3 text-[13px] font-medium transition-colors hover:bg-fill2">
                  {a.label}
                </Link>
              ) : (
                <a key={i} href={a.url} {...(a.url.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})} className="flex h-8 items-center gap-1 rounded-full bg-fill px-3 text-[13px] font-medium transition-colors hover:bg-fill2">
                  {a.label}
                  {a.url.startsWith("http") && <ArrowUpRight size={12} className="text-ink3" />}
                </a>
              ),
            )}
          </div>
        )}
        <div className="mt-2.5 flex items-center gap-1.5 text-[11.5px] text-ink3">
          {by && <Avatar agent={by} size={14} />}
          {by?.name} · {ago(m.updated_at)}
        </div>
      </div>
    </motion.article>
  );
}

function Modules({ rail }: { rail: RailState }) {
  return (
    <div className="flex flex-col gap-3">
      <AnimatePresence initial={false} mode="popLayout">
        {rail.modules.map((m) => (
          <Module key={m.id} m={m} onDismiss={() => rail.dismiss(m.id)} />
        ))}
      </AnimatePresence>
      {rail.modules.length === 0 && (
        <p className="px-2 py-10 text-center text-[13.5px] leading-relaxed text-ink3">
          Nothing timely right now.
          <br />
          Agents put things here when you need them: bookings, deliveries, deadlines.
        </p>
      )}
    </div>
  );
}

const Header = ({ rail }: { rail: RailState }) => (
  <div className="mb-3 flex items-center justify-between px-1">
    <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink3">Now</h2>
    <button onClick={rail.close} aria-label="Hide the rail" title="Hide" className="grid h-8 w-8 place-items-center rounded-full text-ink3 transition-colors hover:bg-fill hover:text-ink">
      <PanelRightClose size={16} />
    </button>
  </div>
);

/** Docked beside the content on a wide screen; a sheet from the right edge on a narrow one. */
export function Rail({ rail }: { rail: RailState }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && rail.sheet && rail.close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <>
      <AnimatePresence initial={false}>
        {rail.docked && (
          <motion.aside key="dock" aria-label="Now" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={soft} className="scroll fixed bottom-0 right-0 top-0 z-20 w-[340px] px-4 pb-6 pt-5">
            <Header rail={rail} />
            <Modules rail={rail} />
          </motion.aside>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {rail.sheet && (
          <motion.div key="sheet" className="fixed inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <div className="absolute inset-0 bg-black/25" onClick={rail.close} />
            <motion.aside aria-label="Now" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={spring} className="rail-sheet scroll absolute inset-y-0 right-0 w-[min(360px,90vw)] px-4 pb-10 pt-5">
              <Header rail={rail} />
              <Modules rail={rail} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
