import { listTickets } from "@/database/queries";
import { handle, ok, ready, searchParam } from "@/lib/api";
import type { Ticket } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    ready();
    const status = searchParam(request, "status") as Ticket["status"] | undefined;
    return ok({ tickets: listTickets(status) });
  } catch (error) {
    return handle(error, "tickets");
  }
}
