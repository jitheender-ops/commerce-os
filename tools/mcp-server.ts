/**
 * MCP server over the governed tool registry.
 *
 * An external agent gets exactly the same door as an internal one: every call
 * goes through `callTool`, so schema validation, permissions, policy, risk and
 * budget all apply, and every call lands in the audit log. This file translates
 * JSON-RPC to a tool call and does nothing else — there is no bypass to write.
 *
 * The server binds to one agent identity (`MCP_AGENT_ID`, default `analytics`).
 * That identity's permissions are the client's permissions, so an MCP client
 * cannot hold authority no internal agent holds. Calls are correlated under an
 * `mcp_…` id, which is how the audit log tells an external caller from an
 * internal one.
 *
 * Transport: newline-delimited JSON-RPC 2.0 over stdio. The MCP SDK is not a
 * dependency — `initialize`, `tools/list`, `tools/call` and a line reader is
 * less code than adding one, and this repo ships zero-install by design.
 */
import type { Readable, Writable } from "node:stream";
import { z } from "zod";
import { AGENTS, AGENT_IDS, isAgentId } from "@/agents/definitions";
import { getTool } from "@/tools/definitions";
import { callTool } from "@/tools/executor";
import { newId } from "@/lib/ids";
import type { AgentId } from "@/types";

/** Fallback protocol revision; a client's own requested revision is echoed. */
const PROTOCOL_VERSION = "2025-06-18";

const requested = process.env.MCP_AGENT_ID ?? "analytics";
if (!isAgentId(requested)) {
  throw new Error(`MCP_AGENT_ID must be one of: ${AGENT_IDS.join(", ")} — got "${requested}"`);
}
export const agentId: AgentId = requested;
const agent = AGENTS[agentId];

interface JsonRpcMessage {
  jsonrpc?: string;
  /** Absent on notifications, which take no reply. */
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const ok = (id: JsonRpcMessage["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: JsonRpcMessage["id"], code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

/** The bound agent's tool surface, as MCP tool descriptors. */
export function listMcpTools() {
  return agent.tools.flatMap((name) => {
    const tool = getTool(name);
    if (!tool) return [];
    return [{
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.input),
      annotations: { readOnlyHint: !tool.mutates },
    }];
  });
}

/** Handles one message. Returns the reply, or null for a notification. */
export async function handle(message: JsonRpcMessage): Promise<object | null> {
  const { id, method, params = {} } = message;
  if (id === undefined || id === null) return null; // notification
  if (!method) return fail(id, -32600, "Missing method");

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion:
          typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "commerce-os", version: "0.1.0", title: `Commerce OS — ${agent.name}` },
        instructions:
          `You are calling the ${agent.name} of a live retail business: ${agent.role}. ` +
          `Every call is governed — a tool outside this agent's permissions is denied, and an ` +
          `action above its spend authority is parked for a human. A result with status ` +
          `PENDING_APPROVAL means nothing executed. Figures are real reads of the business ` +
          `database; anything estimated says so in its own output.`,
      });

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, { tools: listMcpTools() });

    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      if (!getTool(name)) return fail(id, -32602, `Unknown tool: ${name || "(none given)"}`);
      return ok(id, await callAsBoundAgent(name, params.arguments));
    }

    default:
      return fail(id, -32601, `Unknown method: ${method}`);
  }
}

async function callAsBoundAgent(name: string, args: unknown) {
  const result = await callTool(name, args ?? {}, {
    agentId,
    taskId: null,
    correlationId: newId("mcp"),
  });

  // The governance verdict travels with every result, including the successes.
  // A client that only ever sees outputs cannot tell an allowed action from an
  // unchecked one, which is the whole claim this system makes.
  const body = {
    status: result.status,
    decision: result.governance.decision,
    risk: result.governance.risk,
    ...(result.status === "COMPLETED" && { output: result.output }),
    ...(result.approvalId && {
      approvalId: result.approvalId,
      note: "Parked for human approval. Nothing has executed.",
    }),
    ...(result.error && { error: result.error }),
    ...(result.governance.decision !== "ALLOW" && { reasons: result.governance.reasons }),
  };

  return {
    content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
    isError: result.status === "DENIED" || result.status === "FAILED",
  };
}

/** Reads newline-delimited JSON-RPC from `input` and replies on `output`. */
export function serve(input: Readable = process.stdin, output: Writable = process.stdout): void {
  let buffer = "";
  // ponytail: one call at a time. A stdio server has a single client, and
  // serialising keeps DB writes and the audit order deterministic. Drop the
  // chain if a transport with concurrent clients is ever added.
  let queue: Promise<void> = Promise.resolve();

  input.setEncoding("utf8");
  input.on("data", (chunk: string) => {
    buffer += chunk;
    let cut: number;
    while ((cut = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line) continue;
      queue = queue.then(async () => {
        const reply = await dispatch(line);
        if (reply) output.write(`${JSON.stringify(reply)}\n`);
      });
    }
  });
}

async function dispatch(line: string): Promise<object | null> {
  let message: JsonRpcMessage;
  try {
    message = JSON.parse(line);
  } catch {
    return fail(null, -32700, "Parse error");
  }
  try {
    return await handle(message);
  } catch (error) {
    return fail(message.id, -32603, error instanceof Error ? error.message : String(error));
  }
}
