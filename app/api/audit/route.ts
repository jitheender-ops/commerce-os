import { listAudit } from "@/database/queries";
import { handle, intParam, ok, ready, searchParam } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    ready();
    const entries = listAudit({
      agentId: searchParam(request, "agent"),
      risk: searchParam(request, "risk"),
      status: searchParam(request, "status"),
      limit: intParam(request, "limit", 150),
    });
    return ok({
      entries,
      counts: entries.reduce<Record<string, number>>((acc, entry) => {
        acc[entry.executionStatus] = (acc[entry.executionStatus] ?? 0) + 1;
        return acc;
      }, {}),
    });
  } catch (error) {
    return handle(error, "audit");
  }
}
