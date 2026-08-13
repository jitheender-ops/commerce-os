import { getBusinessSummary, getDailyMetrics, getRevenueDecomposition } from "@/database/queries";
import { describeEngine } from "@/ai/gateway";
import { handle, ok, ready } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    ready();
    return ok({
      summary: getBusinessSummary(),
      decomposition: getRevenueDecomposition(),
      metrics: getDailyMetrics(30),
      engine: describeEngine(),
    });
  } catch (error) {
    return handle(error, "business/summary");
  }
}
