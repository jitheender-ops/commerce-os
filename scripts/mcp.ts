/**
 * MCP stdio entry point.
 *
 *   npm run mcp
 *
 * stdout carries JSON-RPC and nothing else, so every human-readable line goes
 * to stderr. Wire it into a client with:
 *
 *   claude mcp add commerce-os -- npm --prefix /path/to/commerce-os run mcp
 */
import { existsSync } from "node:fs";

// Next loads these itself; this process does not run under Next. Must happen
// before the server module is imported — it reads MCP_AGENT_ID at load.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const { agentId, listMcpTools, serve } = await import("@/tools/mcp-server");

console.error(`commerce-os MCP server — bound to "${agentId}", ${listMcpTools().length} tools`);
serve();
