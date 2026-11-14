/**
 * The MCP server a guest's agents see: the guest's shared task list and nothing else. It has no
 * tool that reads the feed, context, links, other todos or the rail, so there is nothing to
 * restrict tool by tool; the limit to the guest's own tasks is enforced again in core/guests.ts.
 */
import { guestAdd, guestDelete, guestTask, guestTasks, guestUpdate } from "../core/guests";
import { ownerAgent, type Agent } from "../core/util";
import type { Tool } from "./tools";

const str = (description: string) => ({ type: "string", description });

export async function GUEST_GUIDE(guest: Agent, readOnly: boolean): Promise<string> {
  const owner = (await ownerAgent()).name;
  return `You are connected on behalf of ${guest.name} to ${owner}'s Subspace, where ${owner} keeps their to-do list.

This connection does one thing: it lets ${guest.name} give ${owner} tasks and follow them. You can see and change only the tasks on ${guest.name}'s shared list ("From ${guest.name}"). Nothing else of ${owner}'s is reachable from here.${readOnly ? "\n\nThis connection is read-only: you can look at the tasks but not add, change or delete them." : ""}

HOW IT WORKS
- task_add puts a new task in front of ${owner}. It appears at once in their "From ${guest.name}" list and beside their feed, and stays there until they give it a day.
- ${owner} decides when to do it. You cannot set the day; if timing matters, say so in the title ("Book the dentist before Friday") or the notes.
- tasks() shows every task with its status: waiting (no day yet), scheduled (with the day, or the week), backlog (set aside, no day), done.
- task(id) returns one task with its notes. Notes are markdown; either of you may write there.
- task_update renames a task or edits its notes. task_delete withdraws it, wherever it is.

WRITING A GOOD TASK
- The title starts with a verb and fits on one line: "Pick up the dry cleaning", not "dry cleaning?".
- One task per thing to do. Details, links, addresses and deadlines go in the notes.
- Before adding, call tasks() and check it is not already there.
- When ${guest.name} asks "did ${owner} do X?" or "when is X happening?", call tasks() and answer from the status. Do not guess.`;
}

export const GUEST_TOOLS: Tool[] = [
  {
    name: "tasks",
    description: "The tasks on your shared list, newest first, each with its status: waiting (not on a day yet), scheduled (with the day or week), backlog, or done. Call this first.",
    inputSchema: { type: "object", properties: { show: str('"open" (default): tasks not finished. "recent": also those finished in the last 30 days. "all": everything.') } },
    readOnly: true,
    run: (g, args) => guestTasks(g, args),
  },
  {
    name: "task",
    description: "One task in full: its status, the day it is planned for, and its notes.",
    inputSchema: { type: "object", properties: { id: str("Task id from tasks().") }, required: ["id"] },
    readOnly: true,
    run: (g, { id }) => guestTask(g, id),
  },
  {
    name: "task_add",
    description: "Add a task for the owner. It shows up for them right away and waits until they give it a day. Title starts with a verb and fits on one line; put details in notes.",
    inputSchema: { type: "object", properties: { title: str("The task, one line."), notes: str("Optional details, as markdown.") }, required: ["title"] },
    run: (g, args) => guestAdd(g, args),
  },
  {
    name: "task_update",
    description: "Rename a task or edit its notes. notes replaces all the notes; notes_append adds to the end and is safer when the owner may have written there too (read the task first).",
    inputSchema: {
      type: "object",
      properties: { id: str("Task id."), title: str("New title."), notes: str("New notes, replacing the existing ones."), notes_append: str("Markdown to add at the end of the notes.") },
      required: ["id"],
    },
    run: (g, { id, ...patch }) => guestUpdate(g, id, patch),
  },
  {
    name: "task_delete",
    description: "Withdraw a task: it is removed from the owner's list, whatever its status. Only the owner can bring it back.",
    inputSchema: { type: "object", properties: { id: str("Task id.") }, required: ["id"] },
    run: (g, { id }) => guestDelete(g, id),
  },
];
