/**
 * Fulfilment pipeline state: what is with the supplier, what is stuck, and what
 * the queue is doing behind it.
 */
import { listFulfillments } from "@/database/queries";
import { listJobs } from "@/events/queue";
import { describeSupplier } from "@/integrations/supplier";
import { handle, ok, ready } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    ready();
    const fulfillments = listFulfillments(undefined, 100);
    const jobs = listJobs(undefined, 100);

    return ok({
      supplier: describeSupplier(),
      fulfillments,
      deadLetters: jobs.filter((job) => job.status === "DEAD"),
      counts: {
        pending: fulfillments.filter((f) => f.status === "PENDING_SUPPLIER").length,
        submitted: fulfillments.filter((f) => f.status === "SUBMITTED").length,
        shipped: fulfillments.filter((f) => f.status === "SHIPPED").length,
        exceptions: fulfillments.filter((f) => f.status === "EXCEPTION").length,
        queued: jobs.filter((job) => job.status === "READY" || job.status === "RUNNING").length,
        dead: jobs.filter((job) => job.status === "DEAD").length,
      },
    });
  } catch (error) {
    return handle(error, "fulfillment");
  }
}
