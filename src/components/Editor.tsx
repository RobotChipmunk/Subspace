"use client";
import { Extension, Mark } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, useEditor, type Editor as TEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { AnimatePresence, motion } from "motion/react";
import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "tiptap-markdown";
import { api, soft, useMe } from "@/lib/client";
import type { Agent } from "@/lib/core/util";
import { MentionMenu, useMentionMatches } from "./MentionInput";

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
  const [mention, setMention] = useState<{ query: string; x: number; y: number } | null>(null);
  const [active, setActive] = useState(0);
  const matches = useMentionMatches(mention?.query ?? null);
  const live = useRef({ matches, active, pick: (_: Agent) => {} });

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image,
      Placeholder.configure({ placeholder: placeholder ?? "Notes. Type # for a heading, - for a list, [ ] for a checklist, @ to ask an agent." }),
      Markdown.configure({ html: true, tightLists: true, bulletListMarker: "-", linkify: true, transformPastedText: true }),
      AgentEdit,
      MentionHighlight.configure({ handles: () => handlesRef.current }),
    ],
    content: splitMixedLists(value),
    editorProps: {
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
    },
    onCreate: ({ editor }) => setEdited(agentsInDoc(editor)),
    onUpdate: ({ editor }) => {
      const md = getMd(editor);
      lastEmitted.current = md;
      onChange(md);
      setEdited(agentsInDoc(editor));
    },
    onSelectionUpdate: ({ editor }) => {
      const { $from, empty } = editor.state.selection;
      const before = empty ? $from.parent.textBetween(0, $from.parentOffset, undefined, "￼") : "";
      const m = before.match(/(^|\s)@([a-zA-Z0-9_-]*)$/);
      if (!m) return setMention(null);
      const c = editor.view.coordsAtPos($from.pos - m[2].length - 1);
      setMention({ query: m[2], x: c.left, y: c.bottom });
      setActive(0);
    },
    onBlur: () => setTimeout(() => setMention(null), 120),
  });

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
    if (!editor || value === lastEmitted.current || editor.isFocused) return;
    lastEmitted.current = value;
    editor.commands.setContent(splitMixedLists(value), { emitUpdate: false });
    setEdited(agentsInDoc(editor));
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
      <EditorContent editor={editor} />
      <AnimatePresence>
        {mention && matches.length > 0 && (
          <div className="fixed z-50" style={{ left: Math.min(mention.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 260), top: mention.y + 8 }}>
            <MentionMenu matches={matches} active={active} onPick={(a) => live.current.pick(a)} onHover={setActive} />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
