/**
 * Business event scenarios.
 *
 * Each scenario makes a real, deterministic change to the database and then
 * publishes the corresponding domain event. Nothing is staged for the UI: the
 * agents react because the data changed, and they would reach the same
 * conclusions if the same change arrived from a real storefront.
 */
import { getBus } from "@/events/bus";
import { getDb } from "@/database/db";
import {
  getCampaignEfficiency,
  getDailyMetrics,
  getStockoutRisks,
  listProducts,
  listPurchaseOrders,
  upsertDailyMetric,
} from "@/database/queries";
import { planForEvent, runPlan, type PlanRunResult } from "@/orchestration/orchestrator";
import { newCorrelationId } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import type { EventType } from "@/types";

export interface ScenarioDefinition {
  id: string;
  label: string;
  description: string;
  /** What the operator should watch for once it fires. */
  expect: string;
  event: EventType;
  apply: () => { summary: string; payload: Record<string, unknown> };
}

export const SCENARIOS: ScenarioDefinition[] = [
  {
    id: "stockout",
    label: "Simulate stockout",
    description: "Drops the fastest-moving SKU to a level below its supplier lead time.",
    expect: "Inventory sizes the reorder, Procurement compares suppliers, a purchase order lands in approvals.",
    event: "INVENTORY_LOW",
    apply: () => {
      // Pick by velocity, not at random — a stockout on a dead SKU proves nothing.
      const target = [...getStockoutRisks()].sort((a, b) => b.velocityPerDay - a.velocityPerDay)[0];
      const onHand = Math.max(1, Math.floor(target.velocityPerDay * 2));
      getDb().run(`UPDATE inventory SET on_hand = ? WHERE product_id = ?`, onHand, target.productId);
      return {
        summary: `${target.sku} cut to ${onHand} units against ${target.velocityPerDay}/day and a ${target.leadTimeDays}-day lead time`,
        payload: { productId: target.productId, sku: target.sku, onHand, leadTimeDays: target.leadTimeDays },
      };
    },
  },
  {
    id: "revenue_drop",
    label: "Simulate revenue drop",
    description: "Cuts today's conversion and spikes mobile payment failures.",
    expect: "Analytics decomposes revenue into traffic, conversion and AOV and isolates the checkout fault.",
    event: "REVENUE_ANOMALY",
    apply: () => {
      const metrics = getDailyMetrics(30);
      const latest = metrics.at(-1)!;
      const previous = metrics.at(-2)!;
      const damaged = {
        ...latest,
        orders: Math.round(latest.orders * 0.7),
        revenuePaise: Math.round(latest.revenuePaise * 0.68),
        cogsPaise: Math.round(latest.cogsPaise * 0.68),
        mobilePaymentFailures: Math.round(previous.mobilePaymentFailures * 4.5),
      };
      upsertDailyMetric(damaged);
      return {
        summary: `Revenue on ${latest.day} cut to ${formatMoney(damaged.revenuePaise)} with ${damaged.mobilePaymentFailures} mobile payment failures`,
        payload: { day: latest.day, revenuePaise: damaged.revenuePaise, failures: damaged.mobilePaymentFailures },
      };
    },
  },
  {
    id: "competitor_price",
    label: "Simulate competitor price drop",
    description: "A competitor undercuts our five highest-margin products by 12%.",
    expect: "Pricing proposes moves that stay inside the 25% margin floor and 10% step limit.",
    event: "COMPETITOR_PRICE_CHANGED",
    apply: () => {
      const targets = listProducts(50)
        .sort((a, b) => (b.pricePaise - b.costPaise) / b.pricePaise - (a.pricePaise - a.costPaise) / a.pricePaise)
        .slice(0, 5);
      for (const product of targets) {
        getDb().run(
          `UPDATE products SET competitor_price_paise = ? WHERE id = ?`,
          Math.round(product.pricePaise * 0.88),
          product.id,
        );
      }
      return {
        summary: `${targets.length} products undercut by 12%: ${targets.map((p) => p.sku).join(", ")}`,
        payload: { skus: targets.map((p) => p.sku) },
      };
    },
  },
  {
    id: "campaign_failure",
    label: "Simulate campaign failure",
    description: "The best-performing campaign's return collapses below break-even.",
    expect: "Marketing catches the reversal and moves budget away from it.",
    event: "CAMPAIGN_PERFORMANCE_CHANGED",
    apply: () => {
      const best = getCampaignEfficiency()[0];
      getDb().run(
        `UPDATE campaigns SET revenue_paise = ?, conversions = ? WHERE id = ?`,
        Math.round(best.spendPaise * 0.4),
        Math.max(1, Math.round(best.conversions * 0.2)),
        best.id,
      );
      return {
        summary: `"${best.name}" fell from ${best.roas}× to 0.4× return`,
        payload: { campaignId: best.id, name: best.name, previousRoas: best.roas },
      };
    },
  },
  {
    id: "supplier_delay",
    label: "Simulate supplier delay",
    description: "Adds 12 days to every lead time from one supplier.",
    expect: "Inventory recomputes cover; Procurement looks for an alternative source.",
    event: "SUPPLIER_DELAYED",
    apply: () => {
      const supplier = getDb().get<{ id: string; name: string }>(
        `SELECT id, name FROM suppliers ORDER BY reliability_score ASC LIMIT 1`,
      )!;
      getDb().run(
        `UPDATE suppliers SET lead_time_days = lead_time_days + 12 WHERE id = ?`,
        supplier.id,
      );
      getDb().run(
        `UPDATE inventory SET lead_time_days = lead_time_days + 12 WHERE supplier_id = ?`,
        supplier.id,
      );
      getDb().run(
        `UPDATE purchase_orders SET status = 'DELAYED' WHERE supplier_id = ? AND status = 'PLACED'`,
        supplier.id,
      );
      const affected = listPurchaseOrders(50).filter((po) => po.status === "DELAYED").length;
      return {
        summary: `${supplier.name} lead times extended by 12 days (${affected} open orders delayed)`,
        payload: { supplierId: supplier.id, supplierName: supplier.name, extraDays: 12 },
      };
    },
  },
  {
    id: "payment_failure",
    label: "Simulate payment failure",
    description: "Mobile checkout starts rejecting one payment in five.",
    expect: "Analytics attributes the conversion loss to the mobile channel specifically.",
    event: "PAYMENT_FAILED",
    apply: () => {
      const db = getDb();
      // Flip a fifth of the most recent mobile orders to failed.
      const recent = db.all<{ id: string }>(
        `SELECT id FROM orders WHERE channel = 'mobile' AND payment_status = 'SUCCESS'
          ORDER BY created_at DESC LIMIT 60`,
      );
      const failing = recent.filter((_, index) => index % 5 === 0);
      for (const order of failing) {
        db.run(
          `UPDATE orders SET payment_status = 'FAILED', status = 'CANCELLED' WHERE id = ?`,
          order.id,
        );
      }
      const metrics = getDailyMetrics(30);
      const latest = metrics.at(-1)!;
      upsertDailyMetric({
        ...latest,
        mobilePaymentFailures: latest.mobilePaymentFailures + failing.length,
      });
      return {
        summary: `${failing.length} recent mobile orders failed at payment`,
        payload: { channel: "mobile", failed: failing.length },
      };
    },
  },
  {
    id: "demand_spike",
    label: "Simulate demand spike",
    description: "Traffic and orders jump 60% on the current day.",
    expect: "Inventory re-checks cover against the higher run rate before anything is promoted.",
    event: "DEMAND_SPIKE",
    apply: () => {
      const metrics = getDailyMetrics(30);
      const latest = metrics.at(-1)!;
      const boosted = {
        ...latest,
        sessions: Math.round(latest.sessions * 1.6),
        orders: Math.round(latest.orders * 1.6),
        revenuePaise: Math.round(latest.revenuePaise * 1.6),
        cogsPaise: Math.round(latest.cogsPaise * 1.6),
      };
      upsertDailyMetric(boosted);
      return {
        summary: `Sessions up 60% to ${boosted.sessions}, orders to ${boosted.orders}`,
        payload: { day: latest.day, sessions: boosted.sessions, orders: boosted.orders },
      };
    },
  },
  {
    id: "return_surge",
    label: "Simulate return surge",
    description: "Returns triple and refunds follow on the current day.",
    expect: "Customer finds the pattern in the ticket queue; Analytics confirms it in the metrics.",
    event: "CUSTOMER_RETURN_CREATED",
    apply: () => {
      const metrics = getDailyMetrics(30);
      const latest = metrics.at(-1)!;
      const returns = latest.returns * 3;
      upsertDailyMetric({
        ...latest,
        returns,
        refundsPaise: Math.round(latest.revenuePaise * 0.09),
      });
      const db = getDb();
      const orders = db.all<{ id: string; customer_id: string }>(
        `SELECT id, customer_id FROM orders WHERE status = 'DELIVERED' ORDER BY created_at DESC LIMIT 6`,
      );
      orders.forEach((order, index) => {
        db.run(`UPDATE orders SET status = 'RETURNED' WHERE id = ?`, order.id);
        db.run(
          `INSERT INTO tickets (id, customer_id, order_id, subject, body, status, reply, created_at)
           VALUES (?, ?, ?, ?, ?, 'OPEN', NULL, ?)`,
          `tkt_surge_${index}_${Date.now()}`,
          order.customer_id,
          order.id,
          "Returning this item",
          "The item does not match the photos on the listing. I would like to send it back for a refund.",
          new Date().toISOString(),
        );
      });
      return {
        summary: `Returns tripled to ${returns} with ${orders.length} new return tickets`,
        payload: { returns, tickets: orders.length },
      };
    },
  },
];

export const getScenario = (id: string): ScenarioDefinition | undefined =>
  SCENARIOS.find((scenario) => scenario.id === id);

export interface ScenarioRun {
  scenario: { id: string; label: string; expect: string };
  summary: string;
  correlationId: string;
  plan: PlanRunResult | null;
}

/**
 * Applies a scenario, publishes its event, and runs whichever plan that event
 * selects. `autoRun: false` fires the event without orchestrating, which is how
 * the event stream page demonstrates the bus on its own.
 */
export async function triggerScenario(
  id: string,
  options: { autoRun?: boolean } = {},
): Promise<ScenarioRun> {
  const scenario = getScenario(id);
  if (!scenario) throw new Error(`Unknown scenario: ${id}`);

  const correlationId = newCorrelationId();
  const { summary, payload } = scenario.apply();

  getBus().publish(
    scenario.event,
    { ...payload, scenario: scenario.id, summary },
    { source: "simulator", correlationId },
  );

  let plan: PlanRunResult | null = null;
  if (options.autoRun !== false) {
    const request = planForEvent(scenario.event, payload);
    if (request) plan = await runPlan({ ...request, correlationId });
  }

  return {
    scenario: { id: scenario.id, label: scenario.label, expect: scenario.expect },
    summary,
    correlationId,
    plan,
  };
}
