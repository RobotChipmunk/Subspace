"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useShown, type Showing } from "./client";

/**
 * Tells the server what the owner opens: which screen is in front, which one thing is open on it,
 * and for how long (see core/seen.ts). Nothing typed is ever sent. A look is reported when it
 * ends: when the screen or the open thing changes, or the page is put away.
 */

type Look = { screen: string; item: Showing | null; since: number };
type Event = { screen: string; type?: string; id?: string; title?: string; seconds: number } | { screen: string; search: string; results: number; opened: string | null };

const SCREENS = ["feed", "todos", "journal", "ideas", "context", "following", "agents"];
export const screenOf = (path: string) => {
  const first = path.split("/")[1] ?? "";
  return first === "page" ? "context" : SCREENS.includes(first) ? first : "feed";
};

/** Sent so that it still arrives when the page is on its way out. Failing to send is never shown: it is only a count. */
function report(events: Event[]) {
  if (!events.length) return;
  try {
    void fetch("/api/v1/seen", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events, device: "web" }) }).catch(() => {});
  } catch {}
}

/** A search the owner made: its words, how much it found, and the result they opened, if they opened one. */
export function reportSearch(path: string, search: string, results: number, opened: string | null) {
  if (search.trim().length > 1) report([{ screen: screenOf(path), search: search.trim(), results, opened }]);
}

export function useSeenRecorder() {
  const path = usePathname();
  const item = useShown();
  const look = useRef<Look | null>(null);
  const screen = screenOf(path);

  // one look ends and the next begins whenever the screen or the open thing changes
  const end = () => {
    const l = look.current;
    look.current = null;
    if (!l) return;
    const seconds = Math.round((Date.now() - l.since) / 1000);
    if (seconds >= 2) report([{ screen: l.screen, ...(l.item ? { type: l.item.type, id: l.item.id, title: l.item.title } : {}), seconds }]);
  };
  useEffect(() => {
    if (document.visibilityState === "visible") look.current = { screen, item, since: Date.now() };
    return end;
  }, [screen, item?.type, item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // a page put away is not being looked at; it starts again when it comes back
  useEffect(() => {
    const change = () => {
      if (document.visibilityState === "hidden") end();
      else if (!look.current) look.current = { screen: screenOf(location.pathname), item: null, since: Date.now() };
    };
    document.addEventListener("visibilitychange", change);
    window.addEventListener("pagehide", end);
    return () => {
      document.removeEventListener("visibilitychange", change);
      window.removeEventListener("pagehide", end);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
