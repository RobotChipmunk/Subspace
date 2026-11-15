"use client";
import { Extension, Mark, Node as TiptapNode } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type Editor as TEditor, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { AnimatePresence, motion } from "motion/react";
import { ImagePlus, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "tiptap-markdown";
import { api, soft, useMe } from "@/lib/client";
import { isBlockType, validateBlock, type AnyBlock } from "@/lib/blocks";
import { BlockView } from "./blocks/BlockView";
import type { Agent } from "@/lib/core/util";
import { Floating } from "./Floating";
import { MentionMenu, useMentionMatches } from "./MentionInput";
import { TypingTraceReport, useTypingTrace } from "./TypingTrace";

/** Text written by an agent. Stored in the markdown as <ins data-agent="handle">…</ins> until reviewed. */
const AgentEdit = Mark.create({
  name: "agentEdit",
  inclusive: false,
  addAttributes() {
    return {
      agent: { default: "", parseHTML: (el) => el.getAttribute("data-agent"), renderHTML: (a) => ({ "data-agent": a.agent }) },
      ts: { default: "", parseHTML: (el) => el.getAttribute("data-ts"), renderHTML: (a) => ({ "data-ts": a.ts }) },
    };
  },
  parseHTML() {
    return [{ tag: "ins" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["ins", HTMLAttributes, 0];
  },
  addStorage() {
    return {
      markdown: {
        serialize: {
          open: (_s: unknown, mark: { attrs: { agent: string; ts: string } }) => `<ins data-agent="${mark.attrs.agent}" data-ts="${mark.attrs.ts}">`,
          close: "</ins>",
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: {},
      },
    };
  },
});

function PageBlockView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const kind = node.attrs.kind as string;
  const json = node.attrs.json as string;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const parsed = useMemo(() => {
    try {
      const data = JSON.parse(json);
      const problem = validateBlock(kind, data);
      return problem ? { problem } : { data };
    } catch {
      return { problem: "its data is not valid JSON" };
    }
  }, [kind, json]);

  function save() {
    try {
      const problem = validateBlock(kind, JSON.parse(draft));
      if (problem) return setError(problem);
    } catch (e) {
      return setError((e as Error).message);
    }
    updateAttributes({ json: draft.trim() });
    setEditing(false);
  }

  const tool = "h-7 rounded-full px-2.5 text-[12px] font-medium menu";
  return (
    <NodeViewWrapper className="page-block" data-kind={kind} contentEditable={false}>
      {!editing && (
        <div className="page-block-tools">
          <button type="button" className={tool} onClick={() => (setDraft(JSON.stringify(JSON.parse(parsed.data ? json : "{}"), null, 2)), setError(""), setEditing(true))}>
            Edit
          </button>
          <button type="button" className={`${tool} hover:text-danger`} onClick={() => deleteNode()}>
            Remove
          </button>
        </div>
      )}
      {editing ? (
        <div className="block-card rounded-[18px] p-3">
          <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.05em] text-ink3">{kind} data</div>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} rows={Math.min(18, draft.split("\n").length + 1)} aria-label={`${kind} data`} className="w-full resize-y rounded-[12px] bg-fill p-2.5 font-mono text-[12.5px] leading-relaxed" />
          {error && <p className="mt-1 text-[12.5px] text-danger">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="h-8 rounded-full px-3 text-[13px] text-ink2 hover:bg-fill">
              Cancel
            </button>
            <button type="button" onClick={save} className="h-8 rounded-full bg-ink px-3.5 text-[13px] font-medium text-bg">
              Save
            </button>
          </div>
        </div>
      ) : parsed.data ? (
        <BlockView block={{ type: kind, ...parsed.data } as AnyBlock} />
      ) : (
        <div className="rounded-[18px] bg-fill p-3.5 text-[13.5px] text-ink2">
          This {kind} section could not be shown: {parsed.problem}.
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[12px] text-ink3">{json.slice(0, 1200)}</pre>
        </div>
      )}
    </NodeViewWrapper>
  );
}

/**
 * A page block (cards, map, table…). In markdown it is a fenced code block whose language is the
 * block type and whose body is JSON; in the editor it is a single unit drawn as a component.
 */
const PageBlock = TiptapNode.create({
  name: "pageBlock",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return { kind: { default: "cards" }, json: { default: "{}" } };
  },
  parseHTML() {
    return [{ tag: "div[data-page-block]", getAttrs: (el) => ({ kind: (el as HTMLElement).getAttribute("data-page-block"), json: (el as HTMLElement).getAttribute("data-json") }) }];
  },
  renderHTML({ node }) {
    return ["div", { "data-page-block": node.attrs.kind, "data-json": node.attrs.json }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageBlockView);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (s: string) => void; text: (s: string, escape?: boolean) => void; ensureNewLine: () => void; closeBlock: (n: unknown) => void }, node: { attrs: { kind: string; json: string } }) {
          state.write("```" + node.attrs.kind + "\n");
          state.text(node.attrs.json, false);
          state.ensureNewLine();
          state.write("```");
          state.closeBlock(node);
        },
        parse: {
          // Turn fenced blocks of a known type into block elements before the editor reads the HTML.
          updateDOM(element: HTMLElement) {
            element.querySelectorAll("pre > code").forEach((code) => {
              const lang = code.className.match(/language-([\w-]+)/)?.[1];
              if (!lang || !isBlockType(lang)) return;
              const div = element.ownerDocument.createElement("div");
              div.setAttribute("data-page-block", lang);
              div.setAttribute("data-json", (code.textContent ?? "").trim());
              code.parentElement!.replaceWith(div);
            });
          },
        },
      },
    };
  },
});

const MentionHighlight = Extension.create<{ handles: () => string[] }>({
  name: "mentionHighlight",
  addOptions() {
    return { handles: () => [] };
  },
  addProseMirrorPlugins() {
    const handles = this.options.handles;
    return [
      new Plugin({
        props: {
          decorations(state) {
            const known = handles();
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              for (const m of node.text.matchAll(/@([a-zA-Z0-9_-]{2,32})/g)) {
                if (known.includes(m[1].toLowerCase())) decos.push(Decoration.inline(pos + m.index!, pos + m.index! + m[0].length, { class: "mention" }));
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

async function upload(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  return (await api<{ url: string }>("media", { form })).url;
}

/**
 * Markdown treats a checklist item directly after a bullet as one list, which no editor can show
 * faithfully. An empty HTML comment between the two runs keeps them as separate lists.
 */
function splitMixedLists(md: string): string {
  let prev: "task" | "bullet" | null = null;
  let fence = false;
  const out: string[] = [];
  for (const line of md.split("\n")) {
    if (/^(```|~~~)/.test(line)) fence = !fence;
    const item = !fence && line.match(/^[-*+] (\[[ xX]\] )?/);
    if (item) {
      const kind = item[1] ? "task" : "bullet";
      if (prev && prev !== kind) out.push("", "<!-- -->", "");
      prev = kind;
    } else if (line.trim() && !/^\s/.test(line)) prev = null;
    out.push(line);
  }
  return out.join("\n");
}

const getMd = (e: TEditor): string => (e.storage as any).markdown.getMarkdown();

function agentsInDoc(e: TEditor): string[] {
  const found = new Set<string>();
  e.state.doc.descendants((n) => {
    for (const m of n.marks) if (m.type.name === "agentEdit") found.add(m.attrs.agent);
  });
  return [...found];
}

export function Editor({ value, onChange, onReviewed, placeholder }: { value: string; onChange: (md: string) => void; onReviewed?: () => void; placeholder?: string }) {
  const { agents } = useMe();
  const handlesRef = useRef<string[]>([]);
  handlesRef.current = agents.map((a) => a.handle);
  const lastEmitted = useRef(value);
  const [edited, setEdited] = useState<string[]>([]);
  const [mention, setMention] = useState<{ query: string; at: number } | null>(null);
  const [active, setActive] = useState(0);
  const matches = useMentionMatches(mention?.query ?? null);
  const live = useRef({ matches, active, pick: (_: Agent) => {} });

  // The editor library re-applies its options to the live view whenever these change identity.
  // Recreating them on each render did that on every keystroke, which interrupts the on-screen
  // keyboard on iOS mid-word. They are built once.
  const extensions = useMemo(
    () => [
      StarterKit.configure({ link: { openOnClick: true, autolink: true } }),
      PageBlock,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image,
      Placeholder.configure({ placeholder: placeholder ?? "Notes. Type # for a heading, - for a list, [ ] for a checklist, @ to ask an agent." }),
      Markdown.configure({ html: true, tightLists: true, bulletListMarker: "-", linkify: true, transformPastedText: true }),
      AgentEdit,
      MentionHighlight.configure({ handles: () => handlesRef.current }),
    ],
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const initialContent = useRef(splitMixedLists(value)).current;
  const editorProps = useMemo<NonNullable<Parameters<typeof useEditor>[0]>["editorProps"]>(
    () => ({
      handlePaste(view, event) {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();
        files.forEach(async (f) => {
          const src = await upload(f);
          view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.image.create({ src })));
        });
        return true;
      },
      handleDrop(view, event) {
        const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
        files.forEach(async (f) => {
          const src = await upload(f);
          view.dispatch(view.state.tr.insert(pos, view.state.schema.nodes.image.create({ src })));
        });
        return true;
      },
      handleKeyDown(_view, e) {
        const { matches, active, pick } = live.current;
        if (!matches.length) return false;
        if (e.key === "ArrowDown") return setActive((active + 1) % matches.length), true;
        if (e.key === "ArrowUp") return setActive((active - 1 + matches.length) % matches.length), true;
        if (e.key === "Enter" || e.key === "Tab") return pick(matches[active]), true;
        if (e.key === "Escape") return setMention(null), true;
        return false;
      },
    }),
    [],
  );
  const noteEdited = (e: TEditor) => {
    const next = agentsInDoc(e);
    setEdited((prev) => (prev.join() === next.join() ? prev : next));
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: initialContent,
    editorProps,
    onCreate: ({ editor }) => noteEdited(editor),
    onUpdate: ({ editor }) => {
      const md = getMd(editor);
      lastEmitted.current = md;
      onChange(md);
      noteEdited(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      const { $from, empty } = editor.state.selection;
      const before = empty ? $from.parent.textBetween(0, $from.parentOffset, undefined, "￼") : "";
      const m = before.match(/(^|\s)@([a-zA-Z0-9_-]*)$/);
      if (!m) return setMention((cur) => (cur ? null : cur));
      setMention({ query: m[2], at: $from.pos - m[2].length - 1 });
      setActive(0);
    },
  });

  // Temporary: a record of keyboard, focus and editor activity for the iPad typing fault.
  const trace = useTypingTrace(editor);
  trace.note("render");
  useEffect(() => trace.note("agents"), [agents]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => trace.note(value === lastEmitted.current ? "value=" : "value!"), [value]); // eslint-disable-line react-hooks/exhaustive-deps

  live.current = {
    matches,
    active,
    pick: (a: Agent) => {
      if (!editor || !mention) return;
      const to = editor.state.selection.from;
      editor.chain().focus().insertContentAt({ from: to - mention.query.length - 1, to }, `@${a.handle} `).run();
      setMention(null);
    },
  };

  // Pick up edits made elsewhere (an agent writing into the notes) without fighting the person typing.
  useEffect(() => {
    if (!editor || value === lastEmitted.current || editor.isFocused || editor.view.composing) return;
    lastEmitted.current = value;
    editor.commands.setContent(splitMixedLists(value), { emitUpdate: false });
    noteEdited(editor);
  }, [value, editor]);

  function review() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    editor.chain().selectAll().unsetMark("agentEdit").setTextSelection({ from, to }).run();
    onReviewed?.();
  }

  const names = edited.map((h) => agents.find((a) => a.handle === h)?.name ?? "@" + h);

  return (
    <div className="relative">
      <AnimatePresence initial={false}>
        {edited.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={soft} className="overflow-hidden">
            <div className="mb-4 flex items-center gap-2.5 rounded-2xl bg-accent-soft py-2 pl-3.5 pr-2 text-[13.5px]">
              <Sparkles size={15} className="flex-none text-accent" />
              <span className="min-w-0 flex-1 truncate">
                <b className="font-semibold">{names.join(", ")}</b> added the highlighted text
              </span>
              <button onClick={review} className="rounded-full bg-solid px-3 py-1 text-[13px] font-medium shadow-sm transition-transform active:scale-95">
                Mark reviewed
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {trace.report && <TypingTraceReport report={trace.report} onClose={trace.close} />}
      <EditorContent editor={editor} />
      <label className="absolute -top-9 right-0 z-[1] grid h-8 w-8 cursor-pointer place-items-center rounded-full text-ink3 transition-colors hover:bg-fill hover:text-ink2" title="Add an image">
        <ImagePlus size={16} />
        <input
          type="file"
          accept="image/*"
          aria-label="Add an image"
          className="sr-only"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file || !editor) return;
            const src = await upload(file);
            editor.chain().focus().setImage({ src }).run();
          }}
        />
      </label>
      <AnimatePresence>
        {mention && matches.length > 0 && (
          <Floating
            anchor={() => {
              if (!editor || editor.isDestroyed) return null;
              const c = editor.view.coordsAtPos(Math.min(mention.at, editor.state.doc.content.size));
              return { left: c.left, top: c.top, bottom: c.bottom };
            }}
            inside={() => editor?.view.dom ?? null}
            onDismiss={() => setMention(null)}
          >
            <MentionMenu matches={matches} active={active} onPick={(a) => live.current.pick(a)} onHover={setActive} />
          </Floating>
        )}
      </AnimatePresence>
    </div>
  );
}
