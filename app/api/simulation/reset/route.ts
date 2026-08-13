import { seedDemo } from "@/simulation/seed";
import { getBusinessSummary } from "@/database/queries";
import { getBus } from "@/events/bus";
import { resetAI } from "@/ai/gateway";
import { handle, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Restores the exact deterministic starting state. */
export async function POST() {
  try {
    const report = seedDemo();
    resetAI();
    getBus().publish(
      "AGENT_STATUS_CHANGED",
      { agentId: "system", status: "IDLE", activity: "Demo reset" },
      { source: "system" },
    );
    return ok({ report, summary: getBusinessSummary() });
  } catch (error) {
    return handle(error, "simulation/reset");
  }
}
