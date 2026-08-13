import { z } from "zod";
import { planForQuestion, runPlan } from "@/orchestration/orchestrator";
import { body, handle, ok, ready } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Payload = z.object({ question: z.string().min(3).max(400) });

/** Free-text entry point: "why did sales drop yesterday?" */
export async function POST(request: Request) {
  try {
    ready();
    const parsed = await body(request, Payload);
    if (parsed.error) return parsed.error;

    const request_ = planForQuestion(parsed.data.question);
    const run = await runPlan(request_);

    return ok({
      question: parsed.data.question,
      template: { id: request_.template.id, title: request_.template.title },
      plan: {
        id: run.plan.id,
        status: run.plan.status,
        correlationId: run.plan.correlationId,
        tasks: run.tasks,
      },
      results: run.results,
      failed: run.failed,
    });
  } catch (error) {
    return handle(error, "ask");
  }
}
