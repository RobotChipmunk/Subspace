import { ApiError, type Agent } from "../core/util";
import { CORE, GUIDE_VERSION, TOPICS } from "./guide";
import { TOOLS } from "./tools";

/**
 * A stateless MCP server over Streamable HTTP. Each POST carries one JSON-RPC message (or a
 * batch) and gets a JSON response, so it runs on serverless functions with no sessions to keep.
 */
const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, any> };

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const err = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(agent: Agent, m: Rpc): Promise<unknown | null> {
  if (m.id === undefined) return null; // notifications need no reply
  switch (m.method) {
    case "initialize": {
      const asked = m.params?.protocolVersion;
      return ok(m.id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { name: "subspace", title: "Subspace", version: GUIDE_VERSION },
        instructions: `You are connected as @${agent.handle} (${agent.name}).\n\n${CORE}`,
      });
    }
    case "ping":
      return ok(m.id, {});
    case "tools/list":
      return ok(m.id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: !!t.readOnly, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === m.params?.name);
      if (!tool) return err(m.id, -32602, `Unknown tool: ${m.params?.name}`);
      try {
        const out = await tool.run(agent, m.params?.arguments ?? {});
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
          ? 'Call jobs() on Subspace. For each job, read guide("illustration") or guide("icons") once, draw the SVG in the house style using the job\'s palette, and deliver it with submit_art. Keep going until no jobs remain.'
          : "Call briefing() on Subspace, then changes(). Answer every mention addressed to you in its thread, do any work you were asked for, draw any open jobs, and post an update only if there is real news. Then stop.";
      return ok(m.id, { messages: [{ role: "user", content: { type: "text", text } }] });
    }
    default:
      return err(m.id, -32601, `Method not found: ${m.method}`);
  }
}

export async function handleMcp(agent: Agent, body: unknown): Promise<{ status: number; json?: unknown }> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(agent, m as Rpc)))).filter(Boolean);
    return out.length ? { status: 200, json: out } : { status: 202 };
  }
  const m = body as Rpc;
  if (!m || m.jsonrpc !== "2.0" || typeof m.method !== "string") return { status: 400, json: err(null, -32600, "Invalid request") };
  const out = await handle(agent, m);
  return out ? { status: 200, json: out } : { status: 202 };
}
