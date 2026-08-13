import { AGENTS, isAgentId } from "@/agents/definitions";
import { getAgentBudget, getAgentMetrics, getAgentRow, listApprovals, listAudit, listMemory } from "@/database/queries";
import { getTool } from "@/tools/definitions";
import { fail, handle, ok, ready } from "@/lib/api";
import { str } from "@/database/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    ready();
    const { id } = await context.params;
    if (!isAgentId(id)) return fail(`No such agent: ${id}`, 404);

    const definition = AGENTS[id];
    const row = getAgentRow(id);
    const budget = getAgentBudget(id);

    return ok({
      agent: {
        ...definition,
        status: row ? str(row.status) : "IDLE",
        activity: row ? str(row.activity) : "Idle",
        lastActiveAt: row?.last_active_at ? str(row.last_active_at) : null,
      },
      budget: {
        limitPaise: budget.limitPaise,
        usedPaise: budget.usedPaise,
        remainingPaise: Math.max(0, budget.limitPaise - budget.usedPaise),
      },
      metrics: getAgentMetrics(id),
      tools: definition.tools.map((name) => {
        const tool = getTool(name);
        return {
          name,
          description: tool?.description ?? "Not registered",
          permission: tool?.permission ?? null,
          mutates: tool?.mutates ?? false,
          risk: typeof tool?.risk === "string" ? tool.risk : "computed per call",
        };
      }),
      memory: listMemory(id, 20),
      recentAudit: listAudit({ agentId: id, limit: 20 }),
      approvals: listApprovals().filter((approval) => approval.agentId === id).slice(0, 10),
    });
  } catch (error) {
    return handle(error, "agents/[id]");
  }
}
