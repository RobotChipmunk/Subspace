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

export type Me = { me: Agent; agents: Agent[]; trackers: Tracker[]; timezone: string };

export function useMe() {
  const { data, mutate } = useSWR<Me>("me", fetcher, { refreshInterval: 30_000 });
  return {
    me: data?.me,
    agents: data?.agents ?? [],
    trackers: data?.trackers ?? [],
    agent: (id: string) => data?.agents.find((a) => a.id === id),
    tracker: (id: string | null) => (id ? data?.trackers.find((t) => t.id === id) : undefined),
    refresh: mutate,
  };
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
    return (running.current ??= (async () => {
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
