import { logged, refused, type CallCtx } from "../core/audit";
import { ApiError, type Agent } from "../core/util";
import { CORE, GUIDE_VERSION, TOPICS } from "./guide";
import { sharingInstructions } from "../core/guests";
import { GUEST_GUIDE, guestServerInfo, guestTools } from "./guest";
import { describeAccess, sightOf } from "../core/access";
import { houseRulesSection, SYSTEM } from "../core/rules";
import { children as contextChildren } from "../core/context";
import { guardCall, toolsFor, type Tool } from "./tools";

/**
 * A stateless MCP server over Streamable HTTP. Each POST carries one JSON-RPC message (or a
 * batch) and gets a JSON response, so it runs on serverless functions with no sessions to keep.
 */
const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, any> };

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const err = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** What a connection may do. A guest gets a different, much smaller server; a read-only connection loses the tools that change things. */
export type Access = { readOnly?: boolean; origin?: string; /** The app that is calling, for the record of what agents did. */ client?: string; grantId?: string };

async function handle(agent: Agent, m: Rpc, access: Access): Promise<unknown | null> {
  if (m.id === undefined) return null; // notifications need no reply
  const guest = agent.kind === "guest";
  // a guest has its own few tools; an agent has those its settings and this connection allow
  const tools: (Tool & { aliases?: string[] })[] = guest ? (await guestTools()).filter((t) => !access.readOnly || t.readOnly) : toolsFor(agent, access.readOnly);
  if (guest) {
    // A guest's server has tasks and nothing else: no guide topics, resources or prompts from the owner's side.
    if (m.method === "resources/list") return ok(m.id, { resources: [] });
    if (m.method === "prompts/list") return ok(m.id, { prompts: [] });
    if (m.method === "resources/read" || m.method === "prompts/get") return err(m.id, -32602, "Nothing by that name.");
  }
  switch (m.method) {
    case "initialize": {
      const asked = m.params?.protocolVersion;
      // a connection opening: which app, which version of it, which protocol
      await logged(agent, "connect", { client: m.params?.clientInfo ?? null, protocol: asked ?? null, read_only: !!access.readOnly }, { via: "mcp", client: access.client ?? "token", grantId: access.grantId, readOnly: true }, async () => ({ guide: GUIDE_VERSION }));
      return ok(m.id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { ...(guest ? await guestServerInfo() : { name: "subspace", title: "Subspace" }), version: GUIDE_VERSION },
        instructions: guest
          ? await GUEST_GUIDE(agent, !!access.readOnly)
          : `You are connected as @${agent.handle} (${agent.name}).${await accessLine(agent, access)}\n\n${CORE}${await rulesSection(agent)}${await sharingSection()}`,
      });
    }
    case "ping":
      return ok(m.id, {});
    case "tools/list":
      return ok(m.id, {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: !!t.readOnly, openWorldHint: false },
        })),
      });
    case "tools/call": {
      // earlier names still answer, for an agent that listed the tools before they were renamed
      const tool = tools.find((t) => t.name === m.params?.name) ?? tools.find((t) => t.aliases?.includes(m.params?.name));
      const ctx: CallCtx = { via: "mcp", client: access.client ?? "token", grantId: access.grantId, readOnly: !!tool?.readOnly };
      if (!tool) {
        // a tool that is not there (or not allowed on this connection) is worth knowing about afterwards
        await refused(agent, String(m.params?.name ?? ""), m.params?.arguments, ctx, access.readOnly ? "Unknown tool, or not available on a read-only connection." : "Unknown tool.");
        return err(m.id, -32602, `Unknown tool: ${m.params?.name}`);
      }
      try {
        const args = m.params?.arguments ?? {};
        const out = await logged(agent, tool.name, args, ctx, async () => {
          if (!guest) await guardCall(agent, tool.name, args);
          return tool.run(agent, args, { origin: access.origin });
        });
        return ok(m.id, { content: [{ type: "text", text: JSON.stringify(out) }] });
      } catch (e) {
        // Tool errors go back as content so the model can read them and correct itself.
        const msg = e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong";
        if (!(e instanceof ApiError)) console.error("mcp tool error", tool.name, e);
        return ok(m.id, { content: [{ type: "text", text: `Error: ${msg}` }], isError: true });
      }
    }
    case "resources/list":
      return ok(m.id, {
        resources: [
          { uri: "subspace://guide", name: "Subspace guide", description: "Core instructions for agents.", mimeType: "text/plain" },
          ...Object.keys(TOPICS).map((k) => ({ uri: `subspace://guide/${k}`, name: `Guide: ${k}`, mimeType: "text/plain" })),
        ],
      });
    case "resources/read": {
      const uri = String(m.params?.uri ?? "");
      const topic = uri.replace("subspace://guide", "").replace(/^\//, "");
      const text = topic ? TOPICS[topic] : CORE;
      // reading a guide page through resources counts as reading the guide
      await logged(agent, "guide", { topic: topic || "core", by: "resource" }, { via: "mcp", client: access.client ?? "token", grantId: access.grantId, readOnly: true }, async () => (text ? { chars: text.length } : Promise.reject(new Error(`Unknown resource: ${uri}`)))).catch(() => {});
      if (!text) return err(m.id, -32002, `Unknown resource: ${uri}`);
      return ok(m.id, { contents: [{ uri, mimeType: "text/plain", text }] });
    }
    case "resources/templates/list":
      return ok(m.id, { resourceTemplates: [] });
    case "prompts/list":
      return ok(m.id, {
        prompts: [
          { name: "check_in", description: "Catch up on Subspace and handle anything waiting for you." },
          { name: "draw_queue", description: "Draw the open illustration and icon jobs." },
        ],
      });
    case "prompts/get": {
      const text =
        m.params?.name === "draw_queue"
          ? 'Call jobs() on Subspace. For each job, read guide("illustration") or guide("icons") once, draw the SVG in the house style using the job\'s palette, and deliver it with submit_art. An illustration must show what its headline is about (the actual subject and what happened to it), so read the headline as well as the prompt. Keep going until no jobs remain.'
          : "Call briefing() on Subspace, then changes(). Answer every mention addressed to you in its thread, do any work you were asked for, draw any open jobs, and post an update only if there is real news. Then stop.";
      return ok(m.id, { messages: [{ role: "user", content: { type: "text", text } }] });
    }
    default:
      return err(m.id, -32601, `Method not found: ${m.method}`);
  }
}

/** What the agent is told about its own access when it connects, so it does not go looking for what it cannot have. */
async function accessLine(agent: Agent, access: Access): Promise<string> {
  const mine = describeAccess(agent, await contextChildren(null));
  if (mine) return ` ${mine} Where the guide below describes posting, adding or changing something you have no tool for, or a part of the system you cannot see, it does not apply to you.`;
  return access.readOnly ? " This connection is read-only: you can look, but not post or change anything." : "";
}

/** The house rules, for an agent that may see them. */
async function rulesSection(agent: Agent): Promise<string> {
  if (!sightOf(agent).node({ path: SYSTEM, kind: "note" })) return "";
  const s = await houseRulesSection();
  return s ? `\n\n${s}` : "";
}

const sharingSection = async () => {
  const s = await sharingInstructions();
  return s ? `\n\n${s}` : "";
};

export async function handleMcp(agent: Agent, body: unknown, access: Access = {}): Promise<{ status: number; json?: unknown }> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(agent, m as Rpc, access)))).filter(Boolean);
    return out.length ? { status: 200, json: out } : { status: 202 };
  }
  const m = body as Rpc;
  if (!m || m.jsonrpc !== "2.0" || typeof m.method !== "string") return { status: 400, json: err(null, -32600, "Invalid request") };
  const out = await handle(agent, m, access);
  return out ? { status: 200, json: out } : { status: 202 };
}
