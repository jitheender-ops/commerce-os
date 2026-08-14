/**
 * The `fulfillment.submit` job handler.
 *
 * This is the only place a supplier call actually happens. The tool that starts
 * it commits intent and returns immediately, so an agent run never blocks on a
 * vendor's latency and a failed call retries instead of vanishing.
 *
 * What counts as permanent versus transient is decided here, not in the queue: a
 * missing order or an empty basket cannot be fixed by trying again, so it is
 * dead-lettered on the first attempt. A timeout or a 5xx is transient and comes
 * back with backoff.
 */
import { getSupplier } from "./supplier";
import { MAX_ATTEMPTS, PermanentJobError, registerJobHandler } from "@/events/queue";
import { getBus } from "@/events/bus";
import { getFulfillment, getOrder, getOrderLines, updateFulfillment } from "@/database/queries";
import type { QueuedJob } from "@/types";

export const FULFILLMENT_JOB = "fulfillment.submit";

export async function handleFulfillmentJob(job: QueuedJob): Promise<void> {
  const fulfillmentId = String(job.payload.fulfillmentId ?? "");
  const fulfillment = getFulfillment(fulfillmentId);
  if (!fulfillment) throw new PermanentJobError(`No such fulfilment: ${fulfillmentId}`);

  // Already accepted by the supplier — a retry of a job whose call actually
  // succeeded must not place the order twice.
  if (fulfillment.status !== "PENDING_SUPPLIER") return;

  const order = getOrder(fulfillment.orderId);
  if (!order) throw new PermanentJobError(`No such order: ${fulfillment.orderId}`);

  const items = getOrderLines(order.id);
  if (items.length === 0) {
    throw new PermanentJobError(`Order ${order.id} has no line items to fulfil`);
  }

  try {
    const result = await getSupplier().createOrder({ orderId: order.id, items });

    updateFulfillment(fulfillment.id, {
      status: result.status,
      externalId: result.externalId,
      trackingUrl: result.trackingUrl,
      simulated: result.simulated,
      lastError: null,
      bumpAttempts: true,
    });

    getBus().publish(
      "FULFILLMENT_SUBMITTED",
      {
        fulfillmentId: fulfillment.id,
        orderId: order.id,
        externalId: result.externalId,
        supplier: fulfillment.supplier,
        simulated: result.simulated,
      },
      { source: "fulfillment", correlationId: job.correlationId },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The last attempt is about to be dead-lettered by the queue, so the
    // fulfilment is parked in EXCEPTION where an operator will see it. Earlier
    // attempts stay PENDING_SUPPLIER because they are still coming back.
    updateFulfillment(fulfillment.id, {
      lastError: message,
      bumpAttempts: true,
      ...(job.attempts >= MAX_ATTEMPTS && { status: "EXCEPTION" as const }),
    });
    throw error;
  }
}

registerJobHandler(FULFILLMENT_JOB, handleFulfillmentJob);
