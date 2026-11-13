"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Box = { left: number; top: number; bottom: number };

/**
 * A popup that floats above everything, anchored to a point on screen. It is rendered at the top
 * of the document so no card can clip it, opens upward when there is no room below, stays inside
 * the viewport, follows its anchor while the page scrolls, and closes on an outside tap or Escape.
 */
export function Floating({ anchor, onDismiss, children, inside }: { anchor: () => Box | null; onDismiss?: () => void; children: ReactNode; inside?: () => Element | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const live = useRef({ anchor, onDismiss, inside });
  live.current = { anchor, onDismiss, inside };

  useLayoutEffect(() => {
    const place = () => {
      const a = live.current.anchor();
      const el = ref.current;
      if (!a || !el) return;
      const { offsetWidth: w, offsetHeight: h } = el;
      const vw = window.innerWidth;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const below = a.bottom + 8;
      const top = below + h <= vh - 8 || a.top - h - 8 < 8 ? below : a.top - h - 8;
      setPos({ left: Math.max(8, Math.min(a.left, vw - w - 8)), top: Math.max(8, top) });
    };
    place();
    const ro = new ResizeObserver(place);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, []);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || live.current.inside?.()?.contains(t)) return;
      live.current.onDismiss?.();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && live.current.onDismiss?.();
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, []);

  return createPortal(
    <div ref={ref} data-floating className="fixed z-[80]" style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}>
      {children}
    </div>,
    document.body,
  );
}
