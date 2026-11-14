"use client";
import { Bot, BookOpen, CircleCheck, PanelRight, Radar, Sparkle } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, spring, useDirectUnread, useMe } from "@/lib/client";
import { Rail, useRail } from "./Rail";

const TABS = [
  { href: "/feed", label: "Feed", icon: Sparkle },
  { href: "/todos", label: "Todos", icon: CircleCheck },
  { href: "/context", label: "Context", icon: BookOpen },
  { href: "/following", label: "Following", icon: Radar },
  { href: "/agents", label: "Agents", icon: Bot },
];

/**
 * The comments panel beside the feed. The shell owns whether it is open, because the page has to
 * make room for it and the docked rail has to step aside while it is there.
 */
const Comments = createContext<{ open: boolean; set: (open: boolean) => void }>({ open: false, set: () => {} });
export const useComments = () => useContext(Comments);

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { me } = useMe();
  const rail = useRail();
  const direct = useDirectUnread();
  const [commentsOpen, setComments] = useState(false);
  const comments = useMemo(() => ({ open: commentsOpen, set: setComments }), [commentsOpen]);
  // Comments take the rail's place while they are open; the rail returns when they close.
  const railDocked = rail.docked && !commentsOpen;

  // Todos follow the owner's local calendar, so keep the server in step with this device.
  // Mark the page as "typing" while a text field or the editor has the keyboard, so heavy
  // decoration can pause (see html[data-typing] in globals.css).
  useEffect(() => {
    const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && !["checkbox", "radio", "button"].includes((t as HTMLInputElement).type)));
    const on = (e: FocusEvent) => editable(e.target) && document.documentElement.setAttribute("data-typing", "");
    const off = (e: FocusEvent) => !editable(e.relatedTarget) && document.documentElement.removeAttribute("data-typing");
    document.addEventListener("focusin", on);
    document.addEventListener("focusout", off);
    return () => {
      document.removeEventListener("focusin", on);
      document.removeEventListener("focusout", off);
      document.documentElement.removeAttribute("data-typing");
    };
  }, []);

  useEffect(() => {
    if (!me) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && sessionStorage.getItem("ss_tz") !== tz) {
      sessionStorage.setItem("ss_tz", tz);
      api("me", { method: "PATCH", body: { timezone: tz } }).catch(() => {});
    }
  }, [me]);

  return (
    <div className="group/shell relative z-10 flex h-dvh" data-rail={railDocked ? "open" : "closed"} data-comments={commentsOpen ? "open" : "closed"}>
      <nav
        aria-label="Apps"
        className="glass nav fixed z-30 flex items-center gap-1 rounded-[26px] p-1.5 max-md:inset-x-0 max-md:bottom-[max(12px,env(safe-area-inset-bottom))] max-md:mx-auto max-md:w-fit md:left-4 md:top-1/2 md:-translate-y-1/2 md:flex-col"
      >
        {TABS.map((t) => {
          const on = path.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} aria-label={t.label} aria-current={on ? "page" : undefined} className="group relative grid h-12 w-12 place-items-center rounded-[20px] outline-offset-0">
              {on && <motion.span layoutId="tab" transition={spring} className="pill absolute inset-0 rounded-[20px]" />}
              <motion.span whileTap={{ scale: 0.86 }} transition={spring} className={`relative transition-colors duration-300 ${on ? "text-accent" : "text-ink2 group-hover:text-ink"}`}>
                <t.icon size={21} strokeWidth={on ? 2.2 : 1.8} />
                {t.href === "/agents" && direct.any && <span aria-label="New message" className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent" />}
              </motion.span>
              <span className="pointer-events-none absolute left-full ml-3 hidden translate-x-[-4px] rounded-lg bg-ink px-2 py-1 text-[12px] font-medium text-bg opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 md:block">
                {t.label}
              </span>
            </Link>
          );
        })}
        {/* A wide screen docks the rail on its own; a narrow one needs a way to open it, and only when there is something in it. */}
        {rail.modules.length > 0 && (
          <>
            <span className="mx-1 h-6 w-px bg-[var(--line)] min-[1100px]:hidden md:mx-0 md:my-1 md:h-px md:w-6" aria-hidden />
            <button onClick={rail.openSheet} aria-label={`Now: ${rail.modules.length} ${rail.modules.length === 1 ? "thing" : "things"} to know`} aria-pressed={rail.sheet} className="group relative grid h-12 w-12 place-items-center rounded-[20px] min-[1100px]:hidden">
              <motion.span whileTap={{ scale: 0.86 }} transition={spring} className={`relative transition-colors duration-300 ${rail.sheet ? "text-accent" : "text-ink2 group-hover:text-ink"}`}>
                <PanelRight size={21} strokeWidth={1.8} />
                <span className={`absolute -right-2 -top-1.5 grid h-[17px] min-w-[17px] place-items-center rounded-full px-1 text-[10.5px] font-semibold leading-none text-white ${rail.level === "error" ? "bg-danger" : rail.level === "warning" ? "bg-[var(--warn)]" : "bg-accent"}`}>{rail.modules.length}</span>
              </motion.span>
              <span className="pointer-events-none absolute left-full ml-3 hidden translate-x-[-4px] rounded-lg bg-ink px-2 py-1 text-[12px] font-medium text-bg opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 md:block">Now</span>
            </button>
          </>
        )}
      </nav>
      <main className="scroll h-dvh min-w-0 flex-1 transition-[padding] duration-500 ease-out-soft md:pl-[92px] min-[1100px]:group-data-[rail=open]/shell:pr-[280px] md:group-data-[comments=open]/shell:pr-[var(--comments-w)]">
        <motion.div key={path.split("/")[1]} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="min-h-full px-4 pb-32 pt-10 md:px-8 md:pt-14">
          <Comments.Provider value={comments}>{children}</Comments.Provider>
        </motion.div>
      </main>
      <Rail rail={rail} docked={railDocked} />
    </div>
  );
}
