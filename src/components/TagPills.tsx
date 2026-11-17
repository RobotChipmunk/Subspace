"use client";
import { Plus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useState, type ReactNode } from "react";
import { soft } from "@/lib/client";

/** A tag as it is kept: one line, no commas or hashes, at most 30 characters. */
export const tidyTag = (raw: string) => raw.replace(/[\s,#]+/g, " ").trim().slice(0, 30).trim();

/**
 * The tags on one thing (a journal entry, a task): quiet chips, each with a way to take it off, and
 * a pill that opens into a field to add one. Tags already in use are offered as the owner types,
 * and one typed again keeps the spelling it already has. It renders as part of the row it sits in
 * (`display: contents`), so the chips wrap with the pills beside them.
 */
export function TagPills({
  tags,
  known,
  onChange,
  onAdding,
  add = "Tag",
  max = 6,
  children,
}: {
  tags: string[];
  /** tags in use elsewhere, offered while typing */
  known: string[];
  onChange: (tags: string[]) => void;
  /** told when the field opens and closes, for a caller that fetches the known tags only then */
  onAdding?: (adding: boolean) => void;
  /** the words on the pill that opens the field */
  add?: string;
  max?: number;
  /** a note at the end of the row */
  children?: ReactNode;
}) {
  const [adding, setOpen] = useState(false);
  const [text, setText] = useState("");
  const list = useId();
  const setAdding = (on: boolean) => (setOpen(on), onAdding?.(on));
  const offered = known.filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()));

  function commit() {
    const typed = tidyTag(text);
    setText("");
    if (!typed || tags.some((t) => t.toLowerCase() === typed.toLowerCase())) return;
    // a tag already in use keeps its spelling
    onChange([...tags, offered.find((k) => k.toLowerCase() === typed.toLowerCase()) ?? typed]);
  }

  return (
    <div className="contents" role="group" aria-label="Tags">
      <AnimatePresence initial={false} mode="popLayout">
        {tags.map((t) => (
          <motion.span key={t} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={soft} data-tag={t} className="flex h-8 items-center rounded-full bg-fill pl-3 text-[13px] font-medium text-ink2">
            {t}
            <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Remove tag ${t}`} className="grid h-8 w-7 place-items-center rounded-full text-ink3 transition-colors hover:text-ink">
              <X size={13} />
            </button>
          </motion.span>
        ))}
      </AnimatePresence>
      {tags.length < max && (
        <motion.form layout transition={soft} onSubmit={(e) => (e.preventDefault(), commit())} className={`flex h-8 items-center rounded-full text-[13px] transition-colors ${adding ? "bg-fill px-3" : "text-ink3 hover:bg-fill hover:text-ink2"}`}>
          {adding ? (
            <>
              <input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => (commit(), setAdding(false))} onKeyDown={(e) => e.key === "Escape" && (setText(""), setAdding(false))} autoFocus maxLength={30} list={list} placeholder="Tag" aria-label="New tag" className="w-[120px] text-[13px]" />
              <datalist id={list}>
                {offered.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="flex h-8 items-center gap-1 whitespace-nowrap px-2.5 font-medium">
              <Plus size={13} /> {add}
            </button>
          )}
        </motion.form>
      )}
      {children}
    </div>
  );
}
