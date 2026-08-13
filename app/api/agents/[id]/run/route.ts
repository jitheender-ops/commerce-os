import { getAgentImpl } from "@/agents";
import { isAgentId } from "@/agents/definitions";
import { newCorrelationId } from "@/lib/ids";
import { fail, handle, ok, ready } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Runs a single agent on demand, outside any plan. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    ready();
    const { id } = await context.params;
    if (!isAgentId(id)) return fail(`No such agent: ${id}`, 404);

    const result = await getAgentImpl(id).run({
      correlationId: newCorrelationId(),
      taskId: null,
      priorResults: [],
    });
    return ok({ result });
  } catch (error) {
    return handle(error, "agents/[id]/run");
  }
}
