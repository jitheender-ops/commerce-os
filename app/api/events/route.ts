import { getBus } from "@/events/bus";
import { SCENARIOS } from "@/simulation/scenarios";
import { handle, intParam, ok, ready } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    ready();
    return ok({
      events: getBus().recent(intParam(request, "limit", 100)),
      scenarios: SCENARIOS.map(({ id, label, description, expect, event }) => ({
        id,
        label,
        description,
        expect,
        event,
      })),
    });
  } catch (error) {
    return handle(error, "events");
  }
}
