"use client";
import { Bot, BookOpen, CircleCheck, Radar, Sparkle } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { api, spring, useMe } from "@/lib/client";

const TABS = [
  { href: "/feed", label: "Feed", icon: Sparkle },
  { href: "/todos", label: "Todos", icon: CircleCheck },
  { href: "/context", label: "Context", icon: BookOpen },
  { href: "/following", label: "Following", icon: Radar },
  { href: "/agents", label: "Agents", icon: Bot },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { me } = useMe();

  // Todos follow the owner's local calendar, so keep the server in step with this device.
  useEffect(() => {
    if (!me) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && sessionStorage.getItem("ss_tz") !== tz) {
      sessionStorage.setItem("ss_tz", tz);
      api("me", { method: "PATCH", body: { timezone: tz } }).catch(() => {});
    }
  }, [me]);

  return (
    <div className="relative z-10 flex h-dvh">
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
              </motion.span>
              <span className="pointer-events-none absolute left-full ml-3 hidden translate-x-[-4px] rounded-lg bg-ink px-2 py-1 text-[12px] font-medium text-bg opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 md:block">
                {t.label}
              </span>
            </Link>
          );
        })}
      </nav>
      <main className="scroll h-dvh min-w-0 flex-1 md:pl-[92px]">
        <motion.div key={path.split("/")[1]} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="min-h-full px-4 pb-32 pt-10 md:px-8 md:pt-14">
          {children}
        </motion.div>
      </main>
    </div>
  );
}
