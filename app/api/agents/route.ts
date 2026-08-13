import { AGENTS, AGENT_IDS } from "@/agents/definitions";
import { getAgentBudget, getAgentMetrics, getAgentRow, listApprovals } from "@/database/queries";
import { handle, ok, ready } from "@/lib/api";
import { str } from "@/database/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    ready();
    const pending = listApprovals("PENDING");
    const agents = AGENT_IDS.map((id) => {
      const row = getAgentRow(id);
      const budget = getAgentBudget(id);
      return {
        ...AGENTS[id],
        status: row ? str(row.status) : "IDLE",
        activity: row ? str(row.activity) : "Idle",
        lastActiveAt: row?.last_active_at ? str(row.last_active_at) : null,
        budget: {
          limitPaise: budget.limitPaise,
          usedPaise: budget.usedPaise,
          remainingPaise: Math.max(0, budget.limitPaise - budget.usedPaise),
        },
        metrics: getAgentMetrics(id),
        toolCount: AGENTS[id].tools.length,
        permissionCount: AGENTS[id].permissions.length,
        pendingApprovals: pending.filter((approval) => approval.agentId === id).length,
      };
    });
    return ok({ agents });
  } catch (error) {
    return handle(error, "agents");
  }
}
