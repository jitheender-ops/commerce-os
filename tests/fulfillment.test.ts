/**
 * Fulfillment tests.
 *
 * A supplier call is the first thing in this system that could reach outside the
 * process, so the claims worth proving are: it is governed like every other
 * tool, it cannot send the same order twice, and a vendor that never answers
 * leaves an operator something to act on rather than a silent hole.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { callTool } from "@/tools/executor";
import { runDueJobs, listDeadLetters, MAX_ATTEMPTS } from "@/events/queue";
import { setSupplier, getSupplier, type SupplierGateway } from "@/integrations/supplier";
import "@/integrations/fulfillment-worker";
import { getDb } from "@/database/db";
import { seedDemo } from "@/simulation/seed";
import { getFulfillmentForOrder, listFulfillments, listOrders } from "@/database/queries";
import { newCorrelationId } from "@/lib/ids";
import type { AgentId, Order, ToolContext } from "@/types";

const ctx = (agentId: AgentId): ToolContext => ({
  agentId,
  taskId: null,
  correlationId: newCorrelationId(),
});

/** A paid order, which is the only kind that may be fulfilled. */
const paidOrder = (): Order =>
  listOrders(200).find((o) => o.paymentStatus === "SUCCESS")!;

beforeAll(() => {
  seedDemo();
});

beforeEach(() => {
  getDb().run(`DELETE FROM job_queue`);
  getDb().run(`DELETE FROM fulfillments`);
  setSupplier(null); // back to the simulated default
});

/** Makes every queued job due now, ignoring backoff. */
const makeAllDue = () => getDb().run(`UPDATE job_queue SET run_after = ?`, Date.now() - 1);

describe("governance", () => {
  it("denies an agent without WRITE_FULFILLMENT", async () => {
    const result = await callTool(
      "fulfill_order",
      { orderId: paidOrder().id, reason: "probe" },
      ctx("marketing"),
    );

    expect(result.status).toBe("DENIED");
    expect(result.governance.reasons[0].check).toBe("PERMISSION");
  });

  it("charges the supplier cost, not the customer price, to the money checks", async () => {
    const order = paidOrder();
    const result = await callTool(
      "fulfill_order",
      { orderId: order.id, reason: "cost basis check" },
      ctx("fulfillment"),
    );

    expect(result.governance.financialImpactPaise).toBe(order.costPaise);
  });

  it("refuses an unpaid order", async () => {
    const unpaid = listOrders(200).find((o) => o.paymentStatus !== "SUCCESS");
    expect(unpaid, "seed should contain an unpaid order").toBeTruthy();

    const result = await callTool(
      "fulfill_order",
      { orderId: unpaid!.id, reason: "probe" },
      ctx("fulfillment"),
    );

    expect(result.status).toBe("FAILED");
    expect(result.error).toContain("not paid");
  });
});

describe("submission", () => {
  it("commits intent without waiting for the supplier, then submits on the worker", async () => {
    const order = paidOrder();
    const started = await callTool(
      "fulfill_order",
      { orderId: order.id, reason: "handover" },
      ctx("fulfillment"),
    );

    // The tool returns before any supplier is contacted.
    expect(started.status).toBe("COMPLETED");
    expect(getFulfillmentForOrder(order.id)!.status).toBe("PENDING_SUPPLIER");

    await runDueJobs();

    const done = getFulfillmentForOrder(order.id)!;
    expect(done.status).toBe("SUBMITTED");
    expect(done.externalId).toMatch(/^SUP_DEMO_/);
    expect(done.simulated).toBe(true);
  });

  it("gives every order its own supplier reference", async () => {
    // Two orders handed over in the same millisecond were given the same
    // reference, because the id was built from its timestamp component alone.
    // On screen that reads as one order counted twice.
    const orders = listOrders(200).filter((o) => o.paymentStatus === "SUCCESS").slice(0, 5);
    for (const order of orders) {
      await callTool("fulfill_order", { orderId: order.id, reason: "batch" }, ctx("fulfillment"));
    }
    await runDueJobs(20);

    // Not every order gets a row — one above the auto-approval limit parks
    // instead, and a parked call never executes. What matters is that the ones
    // which did reach the supplier came back distinguishable from each other.
    const references = listFulfillments()
      .map((f) => f.externalId)
      .filter(Boolean);
    expect(references.length).toBeGreaterThan(1);
    expect(new Set(references).size).toBe(references.length);
  });

  it("sends one order once, however many times it is asked", async () => {
    const order = paidOrder();
    const first = await callTool(
      "fulfill_order",
      { orderId: order.id, reason: "first" },
      ctx("fulfillment"),
    );
    const second = await callTool(
      "fulfill_order",
      { orderId: order.id, reason: "duplicate" },
      ctx("fulfillment"),
    );

    expect((second.output as { deduplicated?: boolean }).deduplicated).toBe(true);
    expect((second.output as { fulfillmentId: string }).fulfillmentId).toBe(
      (first.output as { fulfillmentId: string }).fulfillmentId,
    );
    expect(listFulfillments().filter((f) => f.orderId === order.id)).toHaveLength(1);
  });

  it("does not resubmit a fulfilment the supplier already accepted", async () => {
    const order = paidOrder();
    await callTool("fulfill_order", { orderId: order.id, reason: "handover" }, ctx("fulfillment"));
    await runDueJobs();

    let calls = 0;
    setSupplier({
      label: "counting supplier",
      live: false,
      createOrder: async () => {
        calls++;
        return { externalId: "X", status: "SUBMITTED" as const, trackingUrl: null, simulated: true };
      },
    });

    // Replaying the job — as a restart or a manual retry would — must be a no-op.
    getDb().run(`UPDATE job_queue SET status = 'READY', run_after = ?`, Date.now() - 1);
    await runDueJobs();

    expect(calls).toBe(0);
  });
});

describe("a supplier that will not answer", () => {
  const brokenSupplier: SupplierGateway = {
    label: "broken supplier",
    live: true,
    createOrder: async () => {
      throw new Error("ETIMEDOUT contacting supplier");
    },
  };

  it("retries, then parks the fulfilment as an exception with the vendor's error", async () => {
    setSupplier(brokenSupplier);
    const order = paidOrder();
    await callTool("fulfill_order", { orderId: order.id, reason: "handover" }, ctx("fulfillment"));

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      makeAllDue();
      await runDueJobs();
    }

    const stuck = getFulfillmentForOrder(order.id)!;
    expect(stuck.status).toBe("EXCEPTION");
    expect(stuck.lastError).toContain("ETIMEDOUT");
    expect(stuck.attempts).toBe(MAX_ATTEMPTS);

    // And the job is dead-lettered rather than retrying against a dead vendor forever.
    expect(listDeadLetters().some((j) => j.payload.orderId === order.id)).toBe(true);
  });
});

describe("honesty", () => {
  it("labels a simulated submission as simulated", async () => {
    expect(getSupplier().live).toBe(false);

    const order = paidOrder();
    const result = await callTool(
      "fulfill_order",
      { orderId: order.id, reason: "handover" },
      ctx("fulfillment"),
    );

    expect((result.output as { note: string }).note).toContain("SIMULATED");
  });
});
