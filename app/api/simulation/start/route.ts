/**
 * The one-click hackathon demo.
 *
 * Runs the scripted story end to end: a healthy business is disrupted by three
 * real data changes, the agents investigate and collaborate, governance sorts
 * the safe actions from the ones needing a human, and the result is verified
 * against the metrics. Every step is the same code path the manual UI uses.
 */
import { z } from "zod";
import { runDemoStory, DEMO_STEPS } from "@/simulation/story";
import { body, handle, ok, ready } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Payload = z.object({ reset: z.boolean().default(true) });

export async function GET() {
  return ok({ steps: DEMO_STEPS });
}

export async function POST(request: Request) {
  try {
    ready();
    const parsed = await body(request, Payload);
    if (parsed.error) return parsed.error;
    return ok(await runDemoStory({ reset: parsed.data.reset }));
  } catch (error) {
    return handle(error, "simulation/start");
  }
}
