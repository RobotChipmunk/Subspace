"use client";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";

/**
 * Temporary, for the iPad fault where the notes editor stops taking typing: a short record of what
 * the keyboard, focus and the editor did, shown under the note when typing stops landing so it can
 * be screenshotted. It records which kind of thing happened and when, never what was typed.
 *
 * It shows itself in two cases: keys reach the page but the note does not change, or the note is
 * tapped four times in a row with nothing typed after typing had been working.
 */
type Trace = { note: (token: string) => void };

const KEEP = 60;
const ROUTINE = new Set(["kd:char", "bi:insertText", "in:insertText", "tx+", "tx", "render"]);

export function useTypingTrace(editor: Editor | null): Trace & { report: string | null; close: () => void } {
  const [report, setReport] = useState<string | null>(null);
  const log = useRef<{ t: number; e: string; run?: Record<string, number> }[]>([]);
  const counts = useRef<Record<string, number>>({});
  const started = useRef(0);
  const note = useRef((token: string) => {
    const last = log.current[log.current.length - 1];
    const t = performance.now();
    const kind = token.split(/[:>@ ]/)[0];
    counts.current[kind] = (counts.current[kind] ?? 0) + 1;
    // Ordinary typing is the same few things over and over. A stretch of it is one entry with
    // counts, so a minute of sentences does not push out the moment something else happened.
    if (ROUTINE.has(token)) {
      if (last?.run && t - last.t < 3000) {
        last.run[token] = (last.run[token] ?? 0) + 1;
        last.t = t;
      } else log.current.push({ t, e: "", run: { [token]: 1 } });
    } else if (last && !last.run && last.e.replace(/ x\d+$/, "") === token && t - last.t < 4000) {
      last.e = `${token} x${Number(last.e.match(/ x(\d+)$/)?.[1] ?? 1) + 1}`;
      last.t = t;
    } else log.current.push({ t, e: token });
    if (log.current.length > KEEP) log.current.shift();
  }).current;

  useEffect(() => {
    if (!editor) return;
    started.current = performance.now();
    const dom = editor.view.dom as HTMLElement;
    const inside = (t: EventTarget | null) => t instanceof Node && dom.contains(t);
    const tag = (t: EventTarget | null) => (t instanceof HTMLElement ? t.tagName.toLowerCase() + (t === dom ? "(note)" : "") : "none");
    let docChanges = 0;
    let missed = 0; // keys in a row that changed nothing
    let taps: number[] = [];
    let shown = false;

    const snapshot = (why: string) => {
      const now = performance.now();
      const a = document.activeElement;
      const sel = document.getSelection();
      const view = editor.view as unknown as { composing: boolean; hasFocus: () => boolean; domObserver?: { queue?: unknown[]; flushingSoon?: number; observer?: unknown } };
      const state = [
        `active=${tag(a)}`,
        `focused=${editor.isFocused}/${view.hasFocus()}`,
        `docFocus=${document.hasFocus()}`,
        `composing=${view.composing}`,
        `editable=${editor.isEditable}/${dom.getAttribute("contenteditable")}`,
        `destroyed=${editor.isDestroyed}`,
        `selInNote=${!!sel?.anchorNode && inside(sel.anchorNode)}`,
        `selType=${sel?.type}`,
        `len dom=${dom.innerText.length} state=${editor.state.doc.textContent.length}`,
        `observer=${view.domObserver?.observer ? "on" : "off"} queue=${view.domObserver?.queue?.length ?? "?"} flushing=${view.domObserver?.flushingSoon ?? "?"}`,
        `editors=${document.querySelectorAll(".ProseMirror").length}`,
        `popups=${document.querySelectorAll("[data-floating]").length}`,
        `visible=${document.visibilityState}`,
        `at=${Math.round((now - started.current) / 1000)}s`,
      ].join("  ");
      const totals = Object.entries(counts.current).map(([k, n]) => `${k}=${n}`).join(" ");
      const events = log.current.map((x) => `${((x.t - now) / 1000).toFixed(1)} ${x.run ? `[${Object.entries(x.run).map(([k, n]) => `${k} ${n}`).join(", ")}]` : x.e}`).join(" | ");
      return [`Typing trace: ${why}`, navigator.userAgent.replace(/^Mozilla\/5\.0 /, ""), state, `totals: ${totals}`, events].join("\n");
    };
    const show = (why: string) => {
      if (shown) return;
      shown = true;
      setReport(snapshot(why));
    };

    const onTx = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) {
        docChanges++;
        missed = 0;
        taps = [];
        note("tx+");
      } else note("tx");
    };
    const expectChange = () => {
      const before = docChanges;
      setTimeout(() => {
        if (docChanges !== before || editor.isDestroyed) return;
        note("miss");
        if (++missed >= 3) show("keys reach the page but the note does not change");
      }, 1000);
    };
    const key = (e: KeyboardEvent) => {
      const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
      note(`kd:${printable ? "char" : e.key}${inside(e.target) ? "" : "@" + tag(e.target)}`);
      taps = [];
      if (printable && inside(e.target)) expectChange();
    };
    const before = (e: Event) => inside(e.target) && note(`bi:${(e as InputEvent).inputType}${e.defaultPrevented ? "(stopped)" : ""}`);
    const input = (e: Event) => inside(e.target) && note(`in:${(e as InputEvent).inputType ?? ""}`);
    const comp = (e: Event) => inside(e.target) && note(e.type === "compositionstart" ? "comp>" : "comp<");
    const focusin = (e: FocusEvent) => note(`fi:${tag(e.target)}`);
    const focusout = (e: FocusEvent) => note(`fo:${tag(e.target)}>${tag(e.relatedTarget)}`);
    const down = (e: PointerEvent) => {
      if (!inside(e.target)) return void note(`pd@${tag(e.target)}`);
      note("pd");
      const now = performance.now();
      taps = [...taps.filter((t) => now - t < 12_000), now];
      if (taps.length >= 4 && docChanges >= 10) show("the note was tapped four times and nothing was typed");
    };
    const vis = () => note(`vis:${document.visibilityState}`);
    const err = (e: ErrorEvent) => note(`err:${String(e.message).slice(0, 80)}`);
    const rej = (e: PromiseRejectionEvent) => note(`rej:${String((e.reason as Error)?.message ?? e.reason).slice(0, 80)}`);

    editor.on("transaction", onTx);
    document.addEventListener("keydown", key, true);
    document.addEventListener("beforeinput", before, true);
    document.addEventListener("input", input, true);
    document.addEventListener("compositionstart", comp, true);
    document.addEventListener("compositionend", comp, true);
    document.addEventListener("focusin", focusin, true);
    document.addEventListener("focusout", focusout, true);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("error", err);
    window.addEventListener("unhandledrejection", rej);
    return () => {
      editor.off("transaction", onTx);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("beforeinput", before, true);
      document.removeEventListener("input", input, true);
      document.removeEventListener("compositionstart", comp, true);
      document.removeEventListener("compositionend", comp, true);
      document.removeEventListener("focusin", focusin, true);
      document.removeEventListener("focusout", focusout, true);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("error", err);
      window.removeEventListener("unhandledrejection", rej);
    };
  }, [editor, note]);

  return { note, report, close: () => setReport(null) };
}

export function TypingTraceReport({ report, onClose }: { report: string; onClose: () => void }) {
  return (
    <div data-typing-trace className="mb-4 rounded-2xl bg-fill p-3.5">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-ink2">Typing stopped landing here. A screenshot of this helps fix it.</span>
        <button type="button" onClick={onClose} className="h-7 flex-none rounded-full px-2.5 text-[12.5px] text-ink2 transition-colors hover:bg-fill2">
          Close
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.45] text-ink2">{report}</pre>
    </div>
  );
}
