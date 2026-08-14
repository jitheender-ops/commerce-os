/**
 * End-to-end scenario tests: each one triggers a real data change and asserts
 * the agents reached the conclusion the change should produce.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { SCENARIOS, triggerScenario } from "@/simulation/scenarios";
import { DEMO_STEPS, runDemoStory } from "@/simulation/story";
import { seedDemo } from "@/simulation/seed";
import {
  getCampaignEfficiency,
  getStockoutRisks,
  listApprovals,
  listFulfillments,
} from "@/database/queries";

beforeEach(() => {
  seedDemo();
});

describe("scenarios", () => {
  it("registers all eight scenarios from the brief", () => {
    expect(SCENARIOS.map((s) => s.id).sort()).toEqual(
      [
        "campaign_failure",
        "competitor_price",
        "demand_spike",
        "payment_failure",
        "return_surge",
        "revenue_drop",
        "stockout",
        "supplier_delay",
      ].sort(),
    );
  });

  it("stockout: cuts real stock and routes to procurement", async () => {
    const run = await triggerScenario("stockout");
    const agents = run.plan!.results.map((r) => r.agentId);

    expect(agents).toContain("inventory");
    expect(agents).toContain("procurement");
    expect(getStockoutRisks().some((r) => r.risk === "CRITICAL" || r.risk === "HIGH")).toBe(true);
  }, 30_000);

  it("revenue drop: analytics attributes it to conversion", async () => {
    const run = await triggerScenario("revenue_drop");
    const analytics = run.plan!.results.find((r) => r.agentId === "analytics");

    expect(analytics!.headline).toContain("Conversion rate");
  }, 30_000);

  it("campaign failure: marketing catches the reversal", async () => {
    const before = getCampaignEfficiency()[0];
    const run = await triggerScenario("campaign_failure");
    const marketing = run.plan!.results.find((r) => r.agentId === "marketing");

    expect(marketing).toBeDefined();
    const after = getCampaignEfficiency().find((c) => c.id === before.id)!;
    expect(after.roas).toBeLessThan(before.roas);
  }, 30_000);

  it("competitor price drop: pricing stays inside the margin floor", async () => {
    const run = await triggerScenario("competitor_price");
    const pricing = run.plan!.results.find((r) => r.agentId === "pricing");

    expect(pricing).toBeDefined();
    // Every proposal must be executable as written — no policy-violating asks.
    for (const rec of pricing!.recommendations) {
      expect(rec.tool).toBe("update_price");
      expect(rec.estimatedImpactPaise).toBeGreaterThan(0);
    }
  }, 30_000);

  it("supplier delay: recomputes cover and re-sources", async () => {
    const run = await triggerScenario("supplier_delay");
    const agents = run.plan!.results.map((r) => r.agentId);
    expect(agents).toContain("inventory");
    expect(agents).toContain("procurement");
  }, 30_000);

  it("return surge: customer finds the pattern", async () => {
    const run = await triggerScenario("return_surge");
    const customer = run.plan!.results.find((r) => r.agentId === "customer");
    expect(customer).toBeDefined();
    expect(customer!.observed.some((e) => e.label.startsWith("Theme"))).toBe(true);
  }, 30_000);

  it("payment failure and demand spike both complete their plans", async () => {
    for (const id of ["payment_failure", "demand_spike"] as const) {
      const run = await triggerScenario(id);
      expect(run.plan!.plan.status, id).toBe("COMPLETED");
      expect(run.plan!.failed, id).toHaveLength(0);
    }
  }, 60_000);

  it("fires the event without orchestrating when autoRun is false", async () => {
    const run = await triggerScenario("stockout", { autoRun: false });
    expect(run.plan).toBeNull();
    expect(run.summary).toBeTruthy();
  });
});

describe("hackathon demo story", () => {
  it("runs every step and leaves work in the approval queue", async () => {
    const story = await runDemoStory({ reset: true });

    expect(story.steps).toHaveLength(DEMO_STEPS.length);
    // Steps are filled from DEMO_STEPS by index, so one inserted in the middle
    // silently mislabels every step after it unless the indices move too.
    // Comparing the keys in order is what catches that.
    expect(story.steps.map((s) => s.key)).toEqual(DEMO_STEPS.map((s) => s.key));
    expect(story.steps.every((step) => step.summary.length > 0)).toBe(true);
    expect(story.planIds.length).toBeGreaterThanOrEqual(3);

    // The governance step is the point of the demo: some actions must be parked.
    expect(listApprovals("PENDING").length).toBeGreaterThan(0);
    expect(story.disclaimer).toContain("SIMULATED");
  }, 90_000);

  it("hands orders to the supplier and reports what came back", async () => {
    const story = await runDemoStory({ reset: true });

    const handed = listFulfillments();
    expect(handed.length).toBeGreaterThan(0);

    // The story drains the queue before it returns, so the supplier has already
    // answered. A step that only reported "queued" would prove nothing about
    // the pipeline working end to end.
    const accepted = handed.filter((f) => f.status === "SUBMITTED");
    expect(accepted.length).toBeGreaterThan(0);
    for (const fulfilment of accepted) {
      expect(fulfilment.externalId).toMatch(/^SUP_DEMO_/);
      expect(fulfilment.simulated).toBe(true);
    }

    const step = story.steps.find((s) => s.key === "fulfil")!;
    expect(step.facts.some((f) => f.startsWith("ACCEPTED —"))).toBe(true);
    expect(step.facts.some((f) => f.includes("Supplier:"))).toBe(true);
  }, 90_000);

  it("is reproducible — two runs reach the same measured baseline", async () => {
    const first = await runDemoStory({ reset: true });
    const second = await runDemoStory({ reset: true });

    expect(second.before.revenuePaise).toBe(first.before.revenuePaise);
    expect(second.before.conversionRate).toBe(first.before.conversionRate);
    expect(second.before.orders).toBe(first.before.orders);
  }, 120_000);
});
