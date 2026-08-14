/**
 * Fulfillment Agent — paid orders to the supplier, and exceptions back out.
 *
 * The agent proposes; it does not send. `fulfill_order` runs through the same
 * governance pipeline as every other mutating tool, so a large fulfilment is
 * parked for a human before a vendor ever hears about it, and the actual
 * supplier call happens on the queue worker rather than inside this run.
 */
import { z } from "zod";
import { evidence, reason, recommendation, runAgent, toolCaller, type Agent, type AgentRunContext } from "./runtime";
import { AGENTS } from "./definitions";
import { describeSupplier } from "@/integrations/supplier";
import { formatMoney } from "@/lib/money";
import type { AgentResult, Fulfillment, Order, Recommendation } from "@/types";

const Assessment = z.object({ summary: z.string(), narrative: z.string() });

/** Orders considered for fulfilment in one run. */
const BATCH = 6;

export const fulfillmentAgent: Agent = {
  id: "fulfillment",
  run: (ctx: AgentRunContext): Promise<AgentResult> =>
    runAgent("fulfillment", ctx, "Checking the fulfilment pipeline", async () => {
      const call = toolCaller("fulfillment", ctx);
      const supplier = describeSupplier();

      const [orders, pipeline] = await Promise.all([
        call<Order[]>("get_orders", { limit: 60 }),
        call<Fulfillment[]>("get_fulfillment_queue", {}),
      ]);

      const known = new Set(pipeline.map((f) => f.orderId));
      const stuck = pipeline.filter((f) => f.status === "EXCEPTION");
      const inFlight = pipeline.filter(
        (f) => f.status === "PENDING_SUPPLIER" || f.status === "SUBMITTED",
      );

      // Paid, not cancelled, and not already handed over. The dedup guard in the
      // tool is the real safety net; this just avoids proposing pointless work.
      const awaiting = orders
        .filter((order) => order.paymentStatus === "SUCCESS")
        .filter((order) => order.status === "PAID" || order.status === "PLACED")
        .filter((order) => !known.has(order.id))
        .slice(0, BATCH);

      const recommendations: Recommendation[] = awaiting.map((order) =>
        recommendation("fulfillment", {
          title: `Fulfil ${order.id} — ${formatMoney(order.totalPaise)}`,
          rationale:
            `Paid on ${order.channel}, ${formatMoney(order.totalPaise)} to the customer and ` +
            `${formatMoney(order.costPaise)} owed to the supplier. Not yet handed over.`,
          tool: "fulfill_order",
          input: { orderId: order.id, reason: "Paid order awaiting supplier handover" },
          estimatedImpactPaise: order.costPaise,
          confidence: 0.9,
          risk: "MEDIUM",
        }),
      );

      const observed = [
        evidence("Supplier", supplier.label, supplier.live ? "live" : "simulated — nothing is sent"),
        evidence("Awaiting handover", String(awaiting.length)),
        evidence("In flight", String(inFlight.length)),
        evidence("Exceptions", String(stuck.length), stuck.length > 0 ? "retries exhausted" : undefined),
        ...stuck.slice(0, 3).map((f) =>
          evidence(f.orderId, "EXCEPTION", f.lastError ?? "no error recorded"),
        ),
      ];

      const deterministic = {
        summary:
          awaiting.length === 0 && stuck.length === 0
            ? `Fulfilment pipeline is clear: ${inFlight.length} in flight, nothing stuck.`
            : `${awaiting.length} orders to hand over, ${stuck.length} stuck at the supplier.`,
        narrative: [
          awaiting.length > 0
            ? `${awaiting.length} paid orders have not reached the supplier. Each is proposed for handover; anything above the auto-approval limit will wait for a human.`
            : `Every paid order has reached the supplier.`,
          stuck.length > 0
            ? `${stuck.length} exhausted their retries and sit in EXCEPTION: ${stuck
                .slice(0, 3)
                .map((f) => `${f.orderId} (${f.lastError ?? "unknown error"})`)
                .join("; ")}. These need a decision, not another retry.`
            : ``,
          supplier.live ? `` : `No supplier credentials are configured, so submissions are recorded locally and identified as SUP_DEMO_*.`,
        ]
          .filter(Boolean)
          .join(" "),
      };

      const { value, engine } = await reason({
        kind: "fulfillment.assessment",
        schema: Assessment,
        system: AGENTS.fulfillment.instructions,
        user: [
          `Supplier: ${supplier.label} (${supplier.live ? "live" : "simulated"}).`,
          `Awaiting handover: ${awaiting.map((o) => `${o.id} ${o.costPaise} paise`).join(", ") || "none"}`,
          `In flight: ${inFlight.length}`,
          `Exceptions: ${stuck.map((f) => `${f.orderId}: ${f.lastError ?? "unknown"}`).join("; ") || "none"}`,
          ``,
          `Report the state of the pipeline. Do not claim anything shipped without a supplier identifier.`,
        ].join("\n"),
        fallback: () => deterministic,
      });

      return {
        headline: value.summary,
        observed,
        inference: [
          `${awaiting.length} paid orders await handover; ${inFlight.length} are with the supplier.`,
          ...stuck.map((f) => `${f.orderId} failed ${f.attempts} attempts: ${f.lastError ?? "unknown error"}`),
        ],
        recommendations,
        narrative: value.narrative,
        engine,
      };
    }),
};
