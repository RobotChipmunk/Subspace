"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { spring, useMe } from "@/lib/client";
import type { Agent } from "@/lib/core/util";
import { Avatar } from "./bits";
import { Floating } from "./Floating";

export function useMentionMatches(query: string | null): Agent[] {
  const { agents, me } = useMe();
  if (query === null) return [];
  const ql = query.toLowerCase();
  return agents.filter((a) => a.id !== me?.id && (a.handle.startsWith(ql) || a.name.toLowerCase().startsWith(ql))).slice(0, 6);
}

export function MentionMenu({ matches, active, onPick, onHover }: { matches: Agent[]; active: number; onPick: (a: Agent) => void; onHover: (i: number) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.98 }}
      transition={spring}
      className="menu w-60 overflow-hidden rounded-2xl p-1.5"
    >
      {matches.map((a, i) => (
        <button
          key={a.id}
          type="button"
          onMouseDown={(e) => (e.preventDefault(), onPick(a))}
          onMouseEnter={() => onHover(i)}
          className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors ${i === active ? "bg-fill2" : ""}`}
        >
          <Avatar agent={a} size={26} />
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{a.name}</span>
          <span className="text-[13px] text-ink3">@{a.handle}</span>
        </button>
      ))}
    </motion.div>
  );
}

/** A growing text field where typing @ offers your agents. Enter sends, Shift+Enter breaks the line. */
export function MentionInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  autoFocus,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const matches = useMentionMatches(query);

  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = el.scrollHeight + "px";
    if (caret.current !== null) {
      el.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [value]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  function track(el: HTMLTextAreaElement) {
    const m = el.value.slice(0, el.selectionStart).match(/(^|\s)@([a-zA-Z0-9_-]*)$/);
    setQuery(m ? m[2] : null);
    setActive(0);
  }

  function pick(a: Agent) {
    const el = ref.current!;
    const pos = el.selectionStart;
    const before = value.slice(0, pos).replace(/@([a-zA-Z0-9_-]*)$/, `@${a.handle} `);
    // The caret is placed as soon as the new text is in the field (see the layout effect), not a
    // frame later: a letter typed in between would otherwise land in the wrong place.
    caret.current = before.length;
    onChange(before + value.slice(pos));
    setQuery(null);
    el.focus();
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length) {
      if (e.key === "ArrowDown") return e.preventDefault(), setActive((i) => (i + 1) % matches.length);
      if (e.key === "ArrowUp") return e.preventDefault(), setActive((i) => (i - 1 + matches.length) % matches.length);
      if (e.key === "Enter" || e.key === "Tab") return e.preventDefault(), pick(matches[active]);
      if (e.key === "Escape") return e.stopPropagation(), setQuery(null);
    }
    if (e.key === "Enter" && !e.shiftKey && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <div className="relative min-w-0 flex-1">
      <textarea
        ref={ref}
        rows={1}
        value={value}
        placeholder={placeholder}
        onChange={(e) => (onChange(e.target.value), track(e.target))}
        onKeyDown={onKey}
        onClick={(e) => track(e.currentTarget)}
        className={`block w-full resize-none overflow-hidden ${className}`}
      />
      <AnimatePresence>
        {matches.length > 0 && (
          <Floating anchor={() => ref.current?.getBoundingClientRect() ?? null} inside={() => ref.current} onDismiss={() => setQuery(null)}>
            <MentionMenu matches={matches} active={active} onPick={pick} onHover={setActive} />
          </Floating>
        )}
      </AnimatePresence>
    </div>
  );
}
