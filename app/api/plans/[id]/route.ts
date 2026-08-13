import { getPlan, loadTasks } from "@/orchestration/orchestrator";
import { listAudit } from "@/database/queries";
import { fail, handle, ok, ready } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    ready();
    const { id } = await context.params;
    const plan = getPlan(id);
    if (!plan) return fail(`No such plan: ${id}`, 404);

    const tasks = loadTasks(id);
    return ok({
      plan,
      tasks,
      results: tasks.map((task) => task.result).filter(Boolean),
      // The decision trace: every governed action taken under this plan.
      trace: listAudit({ limit: 300 }).filter((entry) => entry.correlationId === plan.correlationId),
    });
  } catch (error) {
    return handle(error, "plans/[id]");
  }
}
