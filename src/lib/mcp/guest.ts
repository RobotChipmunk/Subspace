/**
 * The MCP server a guest's agents see: the guest's shared task list and nothing else. It has no
 * tool that reads the feed, context, links, other todos or the rail, so there is nothing to
 * restrict tool by tool; the limit to the guest's own tasks is enforced again in core/guests.ts.
 *
 * Everything here is written from the guest's side and names the owner ("Chris"), not the
 * product. The guest's agent should reach for it whenever they ask to send Chris a task or a
 * reminder, without having to know that it is called Subspace.
 */
import { guestAdd, guestDelete, guestTask, guestTasks, guestUpdate } from "../core/guests";
import { ownerAgent, type Agent } from "../core/util";
import type { Tool } from "./tools";

const str = (description: string) => ({ type: "string", description });

/** The owner's first name, and the same as a word usable in a tool name ("Chris" → "chris"). */
export async function ownerNames() {
  const name = (await ownerAgent()).name.trim();
  const first = name.split(/\s+/)[0] || "the owner";
  const slug = first.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "") || "owner";
  return { name: first, slug };
}

/** How the server presents itself in the guest's app: "Tasks for Chris". */
export async function guestServerInfo() {
  const o = await ownerNames();
  return { name: `tasks-for-${o.slug}`, title: `Tasks for ${o.name}` };
}

export async function GUEST_GUIDE(guest: Agent, readOnly: boolean): Promise<string> {
  const { name: o, slug } = await ownerNames();
  const g = guest.name;
  return `TASKS FOR ${o.toUpperCase()}

This connection is how ${g} sends ${o} tasks and reminders, and keeps track of them. It puts things straight onto ${o}'s own to-do list.

WHEN TO USE IT
Use it whenever ${g} wants ${o} to do something, or to remember something, even if they do not name this connection. For example:
- "Send ${o} a task to pick up the dry cleaning"
- "Remind ${o} to call the plumber"
- "Ask ${o} to book the dentist before Friday"
- "Tell ${o} we need milk"
- "Add renewing the car registration to ${o}'s list"
- "Can you get ${o} to look at the leaky tap?"
Also use it when ${g} asks about something they sent: "Did ${o} do the dry cleaning?", "When is ${o} calling the plumber?", "What's still on ${o}'s list from me?"

WHAT IT CAN AND CANNOT DO
- send_task_to_${slug} puts a task on ${o}'s list at once. It stays in front of ${o} until ${o} gives it a day.
- ${o} decides when to do it. You cannot set the day or a time, and ${o} gets no alarm at a set time: a "reminder" is a task ${o} sees on their list. When timing matters, put it in the title ("Book the dentist before Friday") and the details in notes.
- list_tasks_for_${slug} shows what ${g} has sent and what became of each: waiting (no day yet), scheduled (with the day or week), backlog (set aside), or done.
- get_task_for_${slug}, update_task_for_${slug} and delete_task_for_${slug} read, change or withdraw one of them.
- You see only the tasks ${g} sent (and any ${o} added to this shared list), nothing else of ${o}'s.${readOnly ? `\n- This connection is read-only: you can look at the tasks but not send, change or withdraw them.` : ""}

DOING IT WELL
- One task per thing to do. The title starts with a verb and fits on one line: "Pick up the dry cleaning", not "dry cleaning?".
- Addresses, phone numbers, links, ticket numbers and deadlines go in notes.
- Before sending, list the tasks and check it is not already there; if it is, update that one instead.
- When asked about progress, answer from the status. Do not guess.
- After sending, tell ${g} in a few words what you sent. Do not say "Subspace"; say it is on ${o}'s list.`;
}

/** The tools, named for the owner so the guest's agent picks them for "send Chris…". */
export async function guestTools(): Promise<(Tool & { aliases?: string[] })[]> {
  const { name: o, slug } = await ownerNames();
  return [
    {
      name: `send_task_to_${slug}`,
      aliases: ["task_add"],
      description: `Send ${o} a task or reminder: it goes straight onto ${o}'s to-do list. Use this whenever the user asks to send, remind, ask or tell ${o} to do something, or to add something to ${o}'s list, even if they do not name this tool. Title starts with a verb and fits on one line; details and deadlines go in notes. ${o} picks the day.`,
      inputSchema: { type: "object", properties: { title: str(`What ${o} should do, one line, starting with a verb. Include a deadline if there is one, e.g. "Book the dentist before Friday".`), notes: str("Optional details as markdown: addresses, numbers, links, why it matters.") }, required: ["title"] },
      run: (g, args) => guestAdd(g, args),
    },
    {
      name: `list_tasks_for_${slug}`,
      aliases: ["tasks"],
      description: `The tasks and reminders the user has sent ${o}, newest first, with what became of each: waiting (${o} has not given it a day yet), scheduled (with the day or week), backlog, or done. Use it to answer "did ${o} do…?" or "what's still on ${o}'s list?", and to check before sending a duplicate.`,
      inputSchema: { type: "object", properties: { show: str('"open" (default): not finished. "recent": also those finished in the last 30 days. "all": everything.') } },
      readOnly: true,
      run: (g, args) => guestTasks(g, args),
    },
    {
      name: `get_task_for_${slug}`,
      aliases: ["task"],
      description: `One task sent to ${o}, in full: its status, the day ${o} planned it for, and its notes.`,
      inputSchema: { type: "object", properties: { id: str(`Task id from list_tasks_for_${slug}.`) }, required: ["id"] },
      readOnly: true,
      run: (g, { id }) => guestTask(g, id),
    },
    {
      name: `update_task_for_${slug}`,
      aliases: ["task_update"],
      description: `Change a task already sent to ${o}: rename it or edit its notes. notes replaces all the notes; notes_append adds to the end and is safer, since ${o} may have written there too.`,
      inputSchema: {
        type: "object",
        properties: { id: str("Task id."), title: str("New title."), notes: str("New notes, replacing the existing ones."), notes_append: str("Markdown to add at the end of the notes.") },
        required: ["id"],
      },
      run: (g, { id, ...patch }) => guestUpdate(g, id, patch),
    },
    {
      name: `delete_task_for_${slug}`,
      aliases: ["task_delete"],
      description: `Withdraw a task sent to ${o}: it comes off ${o}'s list, whatever its status. Only ${o} can bring it back.`,
      inputSchema: { type: "object", properties: { id: str("Task id.") }, required: ["id"] },
      run: (g, { id }) => guestDelete(g, id),
    },
  ];
}
