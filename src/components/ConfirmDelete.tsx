"use client";
import { Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { soft, spring } from "@/lib/client";

/**
 * The one way to remove something. A quiet bin; the first tap arms it, and the same control
 * grows into a red pill naming what will happen. A second tap does it. It disarms by itself
 * after a few seconds, on Escape, or on a tap anywhere else, so nothing is lost by a slip.
 *
 * The confirmation appears exactly where the finger already is: no dialog, no travel.
 */
export function ConfirmDelete({ label, confirm = "Delete", onConfirm, size = 16, className = "" }: { label: string; confirm?: string; onConfirm: () => unknown | Promise<unknown>; size?: number; className?: string }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const el = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!armed) return;
    const calm = setTimeout(() => setArmed(false), 4000);
    const away = (e: PointerEvent) => !el.current?.contains(e.target as Node) && setArmed(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setArmed(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      clearTimeout(calm);
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [armed]);

  async function press() {
    if (busy) return;
    if (!armed) return setArmed(true);
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  return (
    <motion.button
      ref={el}
      type="button"
      onClick={press}
      aria-label={armed ? `${confirm}: confirm ${label.toLowerCase()}` : label}
      title={armed ? `Tap again to ${confirm.toLowerCase()}` : label}
      data-armed={armed}
      whileTap={{ scale: 0.94 }}
      transition={spring}
      className={`confirm-delete flex h-8 flex-none items-center overflow-hidden rounded-full px-2 ${busy ? "opacity-60" : ""} ${className}`}
    >
      {/* the bin gives a small shake as it arms: the one moment of emphasis */}
      <motion.span animate={armed ? { rotate: [0, -14, 10, -4, 0] } : { rotate: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="grid flex-none place-items-center">
        <Trash2 size={size} />
      </motion.span>
      <AnimatePresence initial={false}>
        {armed && (
          <motion.span key="word" initial={{ width: 0, opacity: 0 }} animate={{ width: "auto", opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={soft} className="overflow-hidden whitespace-nowrap text-[13px] font-medium">
            <span className="block pl-1.5 pr-1">{confirm}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
