import { listPlans, loadTasks } from "@/orchestration/orchestrator";
import { handle, intParam, ok, ready } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    ready();
    const plans = listPlans(intParam(request, "limit", 20)).map((plan) => ({
      ...plan,
      tasks: loadTasks(plan.id),
    }));
    return ok({ plans });
  } catch (error) {
    return handle(error, "plans");
  }
}
