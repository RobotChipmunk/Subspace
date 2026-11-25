"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";
import useSWR from "swr";
import type { Agent } from "./core/util";
import type { Tracker } from "./core/trackers";

export async function api<T = any>(path: string, init?: { method?: string; body?: unknown; form?: FormData }): Promise<T> {
  const res = await fetch(`/api/v1/${path}`, {
    method: init?.method ?? (init?.body || init?.form ? "POST" : "GET"),
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.form ?? (init?.body ? JSON.stringify(init.body) : undefined),
  });
  if (res.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login")) location.href = "/login";
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data as T;
}

export const fetcher = (path: string) => api(path);

export type Me = { me: Agent; agents: Agent[]; guests: Agent[]; trackers: Tracker[]; timezone: string; direct?: Record<string, string>; default_agent?: string | null };

export function useMe() {
  const { data, mutate } = useSWR<Me>("me", fetcher, { refreshInterval: 30_000 });
  return {
    me: data?.me,
    agents: data?.agents ?? [],
    /** Other people whose agents may add tasks (see core/guests.ts). Kept apart from agents. */
    guests: data?.guests ?? [],
    trackers: data?.trackers ?? [],
    /** Anyone by id: the owner, an agent or a guest. */
    agent: (id: string | null | undefined) => (id ? (data?.agents.find((a) => a.id === id) ?? data?.guests?.find((a) => a.id === id)) : undefined),
    tracker: (id: string | null) => (id ? data?.trackers.find((t) => t.id === id) : undefined),
    /** Per agent id: when it last said something in its direct conversation with the owner. */
    direct: data?.direct ?? NO_DIRECT,
    /** The agent a chat message goes to when it names nobody. */
    defaultAgent: data?.agents.find((a) => a.id === data.default_agent),
    refresh: mutate,
  };
}
const NO_DIRECT: Record<string, string> = {};

// Which direct conversations have been read is remembered on this device.
const SEEN_KEY = "ss_direct_seen";
const seenListeners = new Set<() => void>();
const seenRaw = () => {
  try {
    return localStorage.getItem(SEEN_KEY) ?? "{}";
  } catch {
    return "{}";
  }
};
/** Tells which agents have said something in a direct conversation since the owner last opened it. */
export function useDirectUnread() {
  const { direct } = useMe();
  const raw = useSyncExternalStore(
    (cb) => (seenListeners.add(cb), window.addEventListener("storage", cb), () => (seenListeners.delete(cb), window.removeEventListener("storage", cb))),
    seenRaw,
    () => "{}",
  );
  const seen: Record<string, string> = JSON.parse(raw);
  return {
    unread: (agentId: string) => !!direct[agentId] && direct[agentId] > (seen[agentId] ?? ""),
    any: Object.keys(direct).some((id) => direct[id] > (seen[id] ?? "")),
    markRead: (agentId: string, at: string) => {
      const cur: Record<string, string> = JSON.parse(seenRaw());
      if ((cur[agentId] ?? "") >= at) return;
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify({ ...cur, [agentId]: at }));
      } catch {}
      seenListeners.forEach((l) => l());
    },
  };
}

// What is open on screen right now (a task, an entry, a topic), so chat can say what a message is about.
export type Showing = { type: string; id: string; title: string };
let showing: Showing | null = null;
const showingListeners = new Set<() => void>();
const setShowing = (next: Showing | null) => {
  showing = next;
  showingListeners.forEach((l) => l());
};
/** A screen calls this with the one thing it has open, or null. It is forgotten when the screen goes. */
export function useShowing(type: string, id: string | null | undefined, title: string | null | undefined) {
  useEffect(() => {
    if (!id) return;
    const mine = { type, id, title: (title ?? "").trim() };
    setShowing(mine);
    // only what this screen set is cleared: another screen may already have put its own thing there
    return () => void (showing === mine && setShowing(null));
  }, [type, id, title]);
}
/** The thing open on screen, if any. */
export function useShown(): Showing | null {
  return useSyncExternalStore(
    (cb) => (showingListeners.add(cb), () => void showingListeners.delete(cb)),
    () => showing,
    () => null,
  );
}

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 50) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 6) return `${Math.round(s / 86400)}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}

export const spring = { type: "spring", stiffness: 420, damping: 36, mass: 0.9 } as const;
export const soft = { type: "spring", stiffness: 260, damping: 30 } as const;

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");
/** True when the device is in dark mode; updates live when it changes. */
export function useDark(): boolean {
  return useSyncExternalStore(
    (cb) => (darkQuery().addEventListener("change", cb), () => darkQuery().removeEventListener("change", cb)),
    () => darkQuery().matches,
    () => false,
  );
}

/**
 * Saves what is being typed a moment after typing stops. Saves never overlap: while one is on its
 * way the next waits, so a slow connection cannot deliver an older version after a newer one.
 * `dirty()` says whether something typed here is still waiting to be saved.
 */
export function useSaver(save: (text: string) => Promise<unknown>, delay = 700) {
  const latest = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (running.current) return running.current;
    // Nothing to save: do not start a run. One that finishes before it is stored here would be
    // remembered as still running, and every later save would wait on it and never be sent.
    if (latest.current === null) return Promise.resolve();
    return (running.current = (async () => {
      try {
        while (latest.current !== null) {
          const text = latest.current;
          await saveRef.current(text);
          if (latest.current === text) latest.current = null;
        }
      } catch {
        // left dirty: the next keystroke, or leaving the page, tries again
      } finally {
        running.current = null;
      }
    })());
  };
  const push = (text: string) => {
    latest.current = text;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };
  useEffect(() => () => void flush(), []); // eslint-disable-line react-hooks/exhaustive-deps
  return { push, flush, dirty: () => latest.current !== null };
}
