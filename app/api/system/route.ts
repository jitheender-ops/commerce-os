import { describeEngine } from "@/ai/gateway";
import { AGENT_IDS, AGENTS } from "@/agents/definitions";
import { POLICY_RULES } from "@/policies/rules";
import { listTools } from "@/tools/definitions";
import { getAgentMetrics, getState, listAudit } from "@/database/queries";
import { PLAN_TEMPLATES } from "@/orchestration/plans";
import { handle, ok, ready } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Powers the Settings page and the engine badge in the header. */
export async function GET() {
  try {
    ready();
    const audit = listAudit({ limit: 500 });
    const failures = audit.filter((e) => e.executionStatus === "FAILED").length;

    return ok({
      engine: describeEngine(),
      seededAt: getState("seeded_at"),
      autonomy: AGENT_IDS.map((id) => ({
        id,
        name: AGENTS[id].name,
        autonomy: AGENTS[id].autonomy,
        dailyBudgetPaise: AGENTS[id].dailyBudgetPaise,
      })),
      policies: POLICY_RULES,
      tools: listTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
        permission: tool.permission,
        mutates: tool.mutates,
        risk: typeof tool.risk === "string" ? tool.risk : "computed per call",
      })),
      plans: PLAN_TEMPLATES.map((template) => ({
        id: template.id,
        title: template.title,
        triggers: template.triggers,
        tasks: template.tasks.map((task) => ({ agentId: task.agentId, title: task.title, dependsOn: task.dependsOn })),
      })),
      observability: {
        toolCalls: audit.length,
        failures,
        errorRatePercent: audit.length ? Number(((failures / audit.length) * 100).toFixed(1)) : 0,
        perAgent: AGENT_IDS.map((id) => ({ id, name: AGENTS[id].name, ...getAgentMetrics(id) })),
      },
    });
  } catch (error) {
    return handle(error, "system");
  }
}
