"use client";
import { ChevronRight, Plus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { DatePill } from "@/components/DatePicker";
import { Editor } from "@/components/Editor";
import { api, fetcher, soft, useSaver } from "@/lib/client";
import type { ContextNode } from "@/lib/core/context";
import type { JournalEntry, JournalMonth, JournalPage } from "@/lib/core/journal";
import { MOOD_NAMES, toneOf } from "@/lib/moods";

export default function Journal() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}

const at = (day: string) => new Date(day + "T12:00:00Z");
const monthName = (ym: string) => at(ym + "-01").toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const weekdayName = (day: string) => at(day).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
/** "Today", "Mon, Nov 16", and the year too once it is not this one. */
function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  return at(day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC", ...(day.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}) });
}

/** A mood's tone as a small dot: the only colour a mood gets. */
function ToneDot({ mood, size = 8 }: { mood: string | null; size?: number }) {
  const tone = toneOf(mood);
  return <span aria-hidden className={`inline-block flex-none rounded-full ${tone === "up" ? "bg-[var(--good)]" : tone === "down" ? "bg-[var(--warn)]" : "bg-[var(--ink-3)]"}`} style={{ width: size, height: size }} />;
}

/** The mood most entries share (the earliest of equals). */
function leadMood(moods: string[]): string | null {
  const n = new Map<string, number>();
  for (const m of moods) n.set(m, (n.get(m) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * A month at a glance, under its heading: a dot per entry in day order, coloured by how it felt;
 * a line naming the prevailing mood and the themes; and the month's digest when one has been written.
 */
function MonthGlance({ month }: { month: JournalMonth }) {
  const lead = leadMood(month.moods);
  if (!lead && !month.summary) return null;
  const line = [lead ? `Mostly ${lead.toLowerCase()}` : "", month.tags.join(", ")].filter(Boolean).join(" · ");
  return (
    <div className="mb-2 px-3" data-month-glance={month.ym} aria-label={`${monthName(month.ym)}: ${line}. ${month.summary}`}>
      {month.moods.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 pb-1 pt-0.5" aria-hidden>
          {month.moods.slice(0, 31).map((m, i) => (
            <ToneDot key={i} mood={m} />
          ))}
        </div>
      )}
      {line && <p className="text-[12.5px] text-ink3">{line}</p>}
      {month.summary && <p className="mt-1 max-w-[62ch] text-[13.5px] leading-snug text-ink2">{month.summary}</p>}
    </div>
  );
}

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const entryId = params.get("entry");
  const tag = params.get("tag");
  const go = (to: { entry?: string | null; tag?: string | null }) => {
    const next = { entry: entryId, tag, ...to };
    const s = new URLSearchParams();
    if (next.tag) s.set("tag", next.tag);
    if (next.entry) s.set("entry", next.entry);
    router.push(`/journal${s.size ? `?${s}` : ""}`, { scroll: false });
  };
  const [starting, setStarting] = useState(false);

  async function newEntry() {
    if (starting) return;
    setStarting(true);
    try {
      const n = await api<ContextNode>("journal", { body: {} });
      go({ entry: n.id });
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="mx-auto max-w-[880px]">
      <header className="mb-6 flex items-center gap-4 px-1">
        <nav className="flex min-w-0 flex-1 items-center gap-1 text-[30px] font-bold leading-tight tracking-[-0.03em]" aria-label="Breadcrumb">
          <button onClick={() => go({ entry: null })} className={`transition-colors ${entryId ? "text-ink3 hover:text-ink" : ""}`}>
            Journal
          </button>
          {entryId && tag && (
            <span className="flex min-w-0 items-center gap-1 text-[17px] font-semibold tracking-normal">
              <ChevronRight size={18} className="flex-none text-ink3" />
              <button onClick={() => go({ entry: null })} className="truncate text-ink3 transition-colors hover:text-ink">
                {tag}
              </button>
            </span>
          )}
        </nav>
        <motion.button whileTap={{ scale: 0.96 }} onClick={newEntry} disabled={starting} className="glass flex h-10 flex-none items-center gap-1.5 rounded-full px-3.5 text-[14.5px] font-medium text-ink2 transition-colors hover:text-ink">
          <Plus size={16} /> New entry
        </motion.button>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={entryId ?? "list"} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
          {entryId ? <Entry id={entryId} onDeleted={() => go({ entry: null })} /> : <Entries tag={tag} onTag={(t) => go({ tag: t })} onOpen={(id) => go({ entry: id })} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Entries a page at a time, newest day first: all of them, or those carrying one tag. */
function useEntryPages(tag: string | null) {
  const { data, size, setSize, isValidating } = useSWRInfinite<JournalPage>(
    (_i, prev: JournalPage | null) => (prev && !prev.next ? null : `journal?${tag ? `tag=${encodeURIComponent(tag)}&` : ""}${prev?.next ? `before=${encodeURIComponent(prev.next)}` : ""}`),
    fetcher,
    { refreshInterval: 30_000, revalidateFirstPage: true, keepPreviousData: true },
  );
  const last = data?.[data.length - 1];
  return {
    loaded: !!data,
    entries: data?.flatMap((d) => d.entries) ?? [],
    months: data?.flatMap((d) => d.months) ?? [],
    total: data?.[0]?.total ?? 0,
    tags: data?.[0]?.tags ?? [],
    today: data?.[0]?.today ?? "",
    more: !!last?.next,
    busy: isValidating,
    loadMore: () => !isValidating && last?.next && setSize(size + 1),
  };
}

const TAGS_SHOWN = 14;

function Entries({ tag, onTag, onOpen }: { tag: string | null; onTag: (tag: string | null) => void; onOpen: (id: string) => void }) {
  const pages = useEntryPages(tag);
  const end = useRef<HTMLDivElement>(null);
  const loadMore = useRef(pages.loadMore);
  loadMore.current = pages.loadMore;
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const seen = new IntersectionObserver((e) => e[0].isIntersecting && loadMore.current(), { rootMargin: "600px" });
    seen.observe(el);
    return () => seen.disconnect();
  }, [pages.more]);
  // rows that arrive with a later page do not replay the staggered entrance of the first screen
  const first = useRef(0);
  if (!first.current && pages.entries.length) first.current = pages.entries.length;

  // the most used tags, and the chosen one even when it is not among them
  const tags = pages.tags.slice(0, TAGS_SHOWN);
  if (tag && !tags.some((t) => t.tag === tag)) tags.unshift({ tag, count: pages.total });

  const months: { ym: string; entries: JournalEntry[] }[] = [];
  for (const e of pages.entries) {
    const ym = (e.entry_date ?? e.created_at).slice(0, 7);
    if (months[months.length - 1]?.ym === ym) months[months.length - 1].entries.push(e);
    else months.push({ ym, entries: [e] });
  }
  let n = 0;
  const glance = (ym: string) => pages.months.find((x) => x.ym === ym);

  return (
    <div>
      {tags.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-1.5 px-1" role="group" aria-label="Tags">
          {tags.map((t) => {
            const on = t.tag === tag;
            return (
              <motion.button key={t.tag} whileTap={{ scale: 0.95 }} onClick={() => onTag(on ? null : t.tag)} aria-pressed={on} className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors ${on ? "bg-accent-soft text-accent" : "bg-fill text-ink2 hover:bg-fill2"}`}>
                {t.tag}
                <span className={`text-[12px] font-normal tabular-nums ${on ? "" : "text-ink3"}`}>{t.count}</span>
              </motion.button>
            );
          })}
        </div>
      )}
      {months.map((m) => (
        <section key={m.ym} className="mb-5" aria-label={monthName(m.ym)}>
          <h2 className="mb-1 px-3 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-ink3">{monthName(m.ym)}</h2>
          {glance(m.ym) && <MonthGlance month={glance(m.ym)!} />}
          <div className="flex flex-col gap-2.5">
            {m.entries.map((e, i) => {
              const index = n++;
              return <EntryRow key={e.id} entry={e} index={index < first.current ? index : 0} today={pages.today} showDay={e.entry_date !== m.entries[i - 1]?.entry_date} onOpen={() => onOpen(e.id)} />;
            })}
          </div>
        </section>
      ))}
      {pages.more && (
        <div ref={end} className="flex justify-center py-4">
          <button onClick={() => pages.loadMore()} className="h-9 rounded-full px-4 text-[13.5px] text-ink3 transition-colors hover:bg-fill hover:text-ink2">
            {pages.busy ? "Loading" : `Show more · ${pages.entries.length} of ${pages.total.toLocaleString()}`}
          </button>
        </div>
      )}
      {pages.loaded && !pages.entries.length && <p className="py-14 text-center text-[14.5px] text-ink3">{tag ? `Nothing tagged “${tag}” yet.` : "Nothing written yet. New entry starts one for today."}</p>}
    </div>
  );
}

/**
 * One entry in the list, as a card: its day at the left (once per day), then the title, the gist,
 * the mood and tags, and beneath them every picture in the entry, each at its own shape.
 */
function EntryRow({ entry, index, today, showDay, onOpen }: { entry: JournalEntry; index: number; today: string; showDay: boolean; onOpen: () => void }) {
  const day = entry.entry_date ?? entry.created_at.slice(0, 10);
  const images = entry.images ?? (entry.image ? [entry.image] : []);
  return (
    <motion.div
      role="button"
      tabIndex={0}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...soft, delay: Math.min(index, 12) * 0.025 }}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      data-entry={entry.id}
      aria-label={entry.title}
      className="glass entry-card cursor-pointer rounded-[22px] p-4 text-left"
    >
      <div className="flex items-start gap-3">
        <span className="w-10 flex-none pt-0.5 text-center" aria-label={showDay ? dayLabel(day, today) : undefined}>
          {showDay && (
            <>
              <span className={`block text-[20px] font-semibold leading-none tabular-nums tracking-[-0.02em] ${day === today ? "text-accent" : ""}`}>{+day.slice(8)}</span>
              <span className="mt-1 block text-[11.5px] font-medium leading-none text-ink3">{weekdayName(day)}</span>
            </>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold">{entry.title}</span>
          {(entry.summary || entry.excerpt) && <span className="line-clamp-2 text-[13.5px] leading-snug text-ink2">{entry.summary || entry.excerpt}</span>}
          {(entry.mood || entry.tags.length > 0) && (
            <span className="mt-1.5 flex flex-wrap gap-1">
              {entry.mood && (
                <span data-mood={entry.mood} className="flex items-center gap-1 rounded-full bg-fill px-2 py-0.5 text-[11.5px] text-ink2">
                  <ToneDot mood={entry.mood} size={6} />
                  {entry.mood}
                </span>
              )}
              {entry.tags.map((t) => (
                <span key={t} className="rounded-full bg-fill px-2 py-0.5 text-[11.5px] text-ink2">
                  {t}
                </span>
              ))}
            </span>
          )}
        </span>
      </div>
      {images.length > 0 && <EntryPictures images={images} />}
    </motion.div>
  );
}

/**
 * An entry's pictures in its card, none of them cropped. One is shown whole across the card, up
 * to a height; several sit in one row at a common height, each as wide as its shape needs, and
 * the row scrolls sideways when they do not fit.
 */
function EntryPictures({ images }: { images: string[] }) {
  const one = images.length === 1;
  return (
    <div data-scroll-x={one ? undefined : ""} className={one ? "mt-3 sm:pl-[52px]" : "entry-strip mt-3 flex snap-x gap-2 overflow-x-auto pb-1 sm:ml-[52px]"} data-pictures={images.length}>
      {images.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src + i}
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          onError={(e) => (e.currentTarget.style.display = "none")}
          className={one ? "block h-auto max-h-[360px] w-auto max-w-full rounded-[16px] bg-fill max-sm:max-h-[300px]" : "block h-[200px] w-auto max-w-none flex-none snap-start rounded-[14px] bg-fill max-sm:h-[160px]"}
        />
      ))}
    </div>
  );
}

function Entry({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const { data, error, mutate } = useSWR<{ entry: ContextNode; today: string }>(`journal/${id}`, fetcher, { refreshInterval: 20_000 });
  if (error) return <p className="py-14 text-center text-[14.5px] text-ink3">This entry is no longer here.</p>;
  if (!data || data.entry.id !== id) return null;
  return <EntryEditor key={id} entry={data.entry} today={data.today} onChanged={() => mutate()} onDeleted={onDeleted} />;
}

/** Sizes a one-line text area to its content so long titles wrap instead of being cut off. */
const grow = (el: HTMLTextAreaElement | null) => {
  if (el) (el.style.height = "0px"), (el.style.height = el.scrollHeight + "px");
};

/** How long after the last saved keystroke the entry is read for its themes. */
const SETTLE_MS = 2500;

function EntryEditor({ entry, today, onChanged, onDeleted }: { entry: ContextNode; today: string; onChanged: () => void; onDeleted: () => void }) {
  const [title, setTitle] = useState(entry.title);
  const [body, setBody] = useState(entry.body);
  const [tags, setTags] = useState(entry.tags);
  const [tagsBy, setTagsBy] = useState(entry.tags_by);
  const [day, setDay] = useState(entry.entry_date ?? today);
  const [mood, setMood] = useState(entry.mood);
  const [gist, setGist] = useState(entry.summary);
  const panel = useRef<HTMLDivElement>(null);

  const patch = async (b: Record<string, unknown>) => (await api(`context/${entry.id}`, { method: "PATCH", body: b }), onChanged());

  // The entry is read (tags, mood, gist) a moment after writing stops, and once more on the way
  // out. The server keeps tags and a mood the owner chose, so asking is always harmless.
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chosen = useRef(0); // counts the owner's own choices, so a reply that set out before one does not undo it
  const categorize = () => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = null;
    return api<ContextNode>(`journal/${entry.id}/categorize`, { method: "POST" }).catch(() => null);
  };
  const written = () => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(async () => {
      const before = chosen.current;
      const n = await categorize();
      if (!n || before !== chosen.current) return;
      setTags(n.tags), setTagsBy(n.tags_by), setMood(n.mood), setGist(n.summary);
      onChanged();
    }, SETTLE_MS);
  };
  // safe on a component that stays mounted: it only sends what is waiting and leaves nothing behind
  useEffect(() => () => void (settle.current && categorize()), []); // eslint-disable-line react-hooks/exhaustive-deps

  const saver = useSaver(async (md) => (await patch({ body: md }), written()), 700);

  // Fresh content flows in (an agent's edit, tags worked out elsewhere) unless something typed here is still unsaved.
  useEffect(() => {
    if (!saver.dirty()) setBody(entry.body);
  }, [entry.body]); // eslint-disable-line react-hooks/exhaustive-deps
  const serverTags = entry.tags.join("\n");
  useEffect(() => {
    setTags(entry.tags);
    setTagsBy(entry.tags_by);
    setMood(entry.mood);
    setGist(entry.summary);
  }, [serverTags, entry.tags_by, entry.mood, entry.summary]); // eslint-disable-line react-hooks/exhaustive-deps

  function chooseTags(next: string[]) {
    chosen.current++;
    setTags(next);
    setTagsBy("owner");
    void patch({ tags: next });
  }

  async function chooseMood(next: string) {
    chosen.current++;
    // "" hands the choice back to the app, which reads the entry again
    setMood(next || null);
    await patch({ mood: next || null });
    if (!next) written();
  }

  return (
    <div ref={panel} className="glass mb-5 rounded-[26px] p-6 max-md:p-5">
      {/* one row of pills: the day, the mood, then the tags and the way to add one; the bin stays at the end */}
      <div className="mb-3 flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <DatePill label={dayLabel(day, today)} value={day} today={today} past onPick={(d) => (setDay(d), void patch({ entry_date: d }))} />
        <label className={`relative flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors ${mood ? "bg-fill text-ink2 hover:bg-fill2" : "text-ink3 hover:bg-fill hover:text-ink2"}`} data-mood={mood ?? ""}>
          {mood && <ToneDot mood={mood} />}
          {mood ?? "Mood"}
          <select aria-label="Mood" value={mood ?? ""} onChange={(e) => void chooseMood(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0">
            {!mood && <option value="">Mood</option>}
            {MOOD_NAMES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            {mood && entry.mood_by === "owner" && <option value="">Let Subspace choose</option>}
          </select>
        </label>
        <Tags tags={tags} auto={tagsBy === "auto"} onChange={chooseTags} />
        </div>
        <ConfirmDelete label="Delete entry" confirm="Delete" onConfirm={async () => (await api(`context/${entry.id}`, { method: "DELETE" }), onDeleted())} />
      </div>
      <textarea
        value={title}
        rows={1}
        aria-label="Title"
        onChange={(e) => setTitle(e.target.value.replace(/\n/g, ""))}
        onBlur={async () => title.trim() && title !== entry.title && (await patch({ title }), written())}
        // Enter moves on to the writing itself
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), (panel.current?.querySelector(".ProseMirror") as HTMLElement | null)?.focus())}
        autoFocus={entry.title === "Untitled"}
        onFocus={(e) => entry.title === "Untitled" && e.currentTarget.select()}
        ref={grow}
        className="block w-full resize-none overflow-hidden text-[26px] font-bold leading-[1.2] tracking-[-0.025em]"
      />
      {gist && (
        <p className="mt-1 pr-[72px] text-[15px] leading-snug text-ink2" data-gist aria-label="Gist">
          {gist}
        </p>
      )}
      {/* room for the editor's link and picture buttons, which sit just above it */}
      <div className="h-10" aria-hidden />
      <div className="editor-compact">
        <Editor value={body} linkPreviews placeholder="Write. Paste a link on a line of its own to show its preview." onChange={saver.push} />
      </div>
    </div>
  );
}

/**
 * An entry's tags: quiet chips, each with a way to take it off, and a pill that opens into a field
 * to add one. They sit in the entry's top row after the date and mood pills, and wrap with them.
 * Tags chosen by the app say so, in a meta note at the end of the row, until the owner changes them.
 */
function Tags({ tags, auto, onChange }: { tags: string[]; auto: boolean; onChange: (tags: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  // tags already used anywhere in the journal are offered as the owner types
  const { data } = useSWR<JournalPage>(adding ? "journal?" : null, fetcher);
  const known = (data?.tags ?? []).map((t) => t.tag).filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()));

  function add() {
    const typed = text.replace(/[\s,#]+/g, " ").trim().slice(0, 30).trim();
    setText("");
    if (!typed || tags.some((t) => t.toLowerCase() === typed.toLowerCase())) return;
    // a tag the journal already has keeps its spelling
    onChange([...tags, known.find((k) => k.toLowerCase() === typed.toLowerCase()) ?? typed]);
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
      {tags.length < 6 && (
        <motion.form layout transition={soft} onSubmit={(e) => (e.preventDefault(), add())} className={`flex h-8 items-center rounded-full text-[13px] transition-colors ${adding ? "bg-fill px-3" : "text-ink3 hover:bg-fill hover:text-ink2"}`}>
          {adding ? (
            <>
              <input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => (add(), setAdding(false))} onKeyDown={(e) => e.key === "Escape" && (setText(""), setAdding(false))} autoFocus maxLength={30} list="journal-tags" placeholder="Tag" aria-label="New tag" className="w-[120px] text-[13px]" />
              <datalist id="journal-tags">
                {known.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="flex h-8 items-center gap-1 px-2.5 font-medium">
              <Plus size={13} /> Tag
            </button>
          )}
        </motion.form>
      )}
      {auto && tags.length > 0 && <span className="pl-1 text-[12px] text-ink3">Tagged for you</span>}
    </div>
  );
}
