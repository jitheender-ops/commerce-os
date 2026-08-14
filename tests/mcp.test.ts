/**
 * MCP server tests.
 *
 * The claim is that an external client gets the same governance as an internal
 * agent, not a side door. These tests drive the JSON-RPC handler directly and
 * check that a denial still denies when it arrives over the protocol.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { handle, listMcpTools } from "@/tools/mcp-server";
import { AGENTS } from "@/agents/definitions";
import { getTool } from "@/tools/definitions";
import { seedDemo } from "@/simulation/seed";
import { listProducts } from "@/database/queries";

beforeAll(() => {
  seedDemo();
});

const call = async (method: string, params?: Record<string, unknown>) => {
  const reply = (await handle({ jsonrpc: "2.0", id: 1, method, params })) as {
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  };
  return reply;
};

/** Tool results carry their JSON body as a single text content block. */
const body = (result: Record<string, unknown> | undefined) =>
  JSON.parse((result!.content as { text: string }[])[0].text);

describe("handshake", () => {
  it("echoes the client's protocol revision and advertises tools", async () => {
    const { result } = await call("initialize", { protocolVersion: "2025-03-26" });
    expect(result!.protocolVersion).toBe("2025-03-26");
    expect(result!.capabilities).toEqual({ tools: {} });
  });

  it("does not reply to a notification", async () => {
    expect(await handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });

  it("rejects an unknown method", async () => {
    const { error } = await call("resources/list");
    expect(error!.code).toBe(-32601);
  });
});

describe("tools/list", () => {
  it("exposes exactly the bound agent's tool surface with JSON Schema inputs", async () => {
    const { result } = await call("tools/list");
    const tools = result!.tools as { name: string; inputSchema: { type: string } }[];

    expect(tools.map((t) => t.name)).toEqual(AGENTS.analytics.tools);
    expect(listMcpTools().length).toBe(tools.length);
    for (const tool of tools) expect(tool.inputSchema.type).toBe("object");
  });

  it("mirrors each tool's mutation flag, and the default binding mutates nothing", async () => {
    const { result } = await call("tools/list");
    const tools = result!.tools as { name: string; annotations: { readOnlyHint: boolean } }[];

    for (const tool of tools) {
      expect(tool.annotations.readOnlyHint).toBe(!getTool(tool.name)!.mutates);
      // The default identity is analytics precisely so that an unconfigured
      // server hands an external client no way to change the business.
      expect(tool.annotations.readOnlyHint).toBe(true);
    }
  });
});

describe("tools/call", () => {
  it("runs an allowed tool and returns the governance verdict with the output", async () => {
    const { result } = await call("tools/call", {
      name: "get_business_summary",
      arguments: {},
    });
    expect(result!.isError).toBe(false);

    const payload = body(result);
    expect(payload.status).toBe("COMPLETED");
    expect(payload.decision).toBe("ALLOW");
    expect(payload.output).toBeTruthy();
  });

  it("denies a tool outside the bound agent's permissions", async () => {
    // Analytics never holds WRITE_PRICES. Reaching the tool over MCP does not
    // change that — the same governance runs on the same call.
    const product = listProducts(1)[0];
    const { result } = await call("tools/call", {
      name: "update_price",
      arguments: { productId: product.id, newPricePaise: product.pricePaise, reason: "probe" },
    });

    expect(result!.isError).toBe(true);
    const payload = body(result);
    expect(payload.status).toBe("DENIED");
    expect(payload.reasons[0].check).toBe("PERMISSION");
  });

  it("rejects malformed arguments before governance sees them", async () => {
    const { result } = await call("tools/call", {
      name: "get_daily_metrics",
      arguments: { days: "thirty" },
    });
    expect(result!.isError).toBe(true);
    expect(body(result).reasons[0].check).toBe("SCHEMA");
  });

  it("rejects a tool that is not in the registry", async () => {
    const { error } = await call("tools/call", { name: "drop_all_tables", arguments: {} });
    expect(error!.code).toBe(-32602);
  });
});
