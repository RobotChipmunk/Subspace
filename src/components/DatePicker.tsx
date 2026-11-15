"use client";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { soft, spring } from "@/lib/client";
import { Floating } from "./Floating";

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
// Monday first, like the task lists
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * One month of days, in the manner of the iOS date picker: the month's name with arrows to step,
 * a grid of days, today in the accent colour and the chosen day in a filled circle. Days already
 * past cannot be chosen. Stepping a month slides the grid the way the owner is moving.
 */
export function MonthCalendar({ value, today, onPick }: { value: string | null; today: string; onPick: (date: string) => void }) {
  const start = value && value >= today ? value : today;
  const [ym, setYm] = useState({ y: +start.slice(0, 4), m: +start.slice(5, 7) - 1 });
  const [dir, setDir] = useState(0);
  const step = (n: number) => {
    const d = new Date(Date.UTC(ym.y, ym.m + n, 1));
    setDir(n);
    setYm({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  };
  const first = new Date(Date.UTC(ym.y, ym.m, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(ym.y, ym.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const canBack = iso(ym.y, ym.m, 1) > today;
  const arrow = "grid h-9 w-9 place-items-center rounded-full text-accent transition-colors hover:bg-accent-soft disabled:text-ink3 disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div className="w-[304px] max-w-[calc(100vw-16px)] select-none rounded-[22px] border border-line bg-solid p-3 shadow-[var(--shadow-lift)]" data-calendar>
      <div className="flex items-center pl-2">
        <div className="flex-1 text-[16px] font-semibold tracking-[-0.01em]" aria-live="polite">
          {first.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}
        </div>
        <button onClick={() => step(-1)} disabled={!canBack} aria-label="Previous month" className={arrow}>
          <ChevronLeft size={20} />
        </button>
        <button onClick={() => step(1)} aria-label="Next month" className={arrow}>
          <ChevronRight size={20} />
        </button>
      </div>
      <div className="mt-1 grid grid-cols-7 text-center text-[11.5px] font-semibold text-ink3">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="py-1">
            {d}
          </span>
        ))}
      </div>
      {/* always six rows tall, so the panel does not change size from month to month */}
      <div className="relative h-[240px] overflow-hidden">
        <AnimatePresence initial={false} custom={dir}>
          <motion.div
            key={`${ym.y}-${ym.m}`}
            custom={dir}
            variants={{ enter: (n: number) => ({ x: n * 40, opacity: 0 }), show: { x: 0, opacity: 1 }, exit: (n: number) => ({ x: n * -40, opacity: 0 }) }}
            initial="enter"
            animate="show"
            exit="exit"
            transition={soft}
            className="absolute inset-0 grid grid-cols-7 content-start"
          >
            {cells.map((d, i) => {
              if (!d) return <span key={i} />;
              const date = iso(ym.y, ym.m, d);
              const on = date === value;
              const now = date === today;
              return (
                <button
                  key={i}
                  disabled={date < today}
                  aria-pressed={on}
                  aria-label={new Date(date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                  onClick={() => onPick(date)}
                  className="group grid h-10 place-items-center disabled:opacity-30"
                >
                  <motion.span
                    whileTap={{ scale: 0.88 }}
                    transition={spring}
                    className={`grid h-9 w-9 place-items-center rounded-full text-[17px] tabular-nums transition-colors ${on ? "bg-accent font-semibold text-white" : now ? "font-semibold text-accent group-enabled:group-hover:bg-accent-soft" : "group-enabled:group-hover:bg-fill"}`}
                  >
                    {d}
                  </motion.span>
                </button>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/** A quiet pill naming a date; tapping it drops the month calendar open beneath it. */
export function DatePill({ label, value, today, onPick }: { label: string; value: string | null; today: string; onPick: (date: string) => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={btn}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Date: ${label}`}
        className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors ${open ? "bg-accent-soft text-accent" : "bg-fill text-ink2 hover:bg-fill2"}`}
      >
        <CalendarDays size={14} />
        {label}
      </button>
      {open && (
        <Floating anchor={() => btn.current?.getBoundingClientRect() ?? null} inside={() => btn.current} onDismiss={() => setOpen(false)}>
          <motion.div initial={{ opacity: 0, scale: 0.96, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={spring} style={{ transformOrigin: "top left" }} role="dialog" aria-label="Choose a date">
            <MonthCalendar value={value} today={today} onPick={(d) => (setOpen(false), onPick(d))} />
          </motion.div>
        </Floating>
      )}
    </>
  );
}
