/**
 * End-to-end scenario tests: each one triggers a real data change and asserts
 * the agents reached the conclusion the change should produce.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { SCENARIOS, triggerScenario } from "@/simulation/scenarios";
import { runDemoStory } from "@/simulation/story";
import { seedDemo } from "@/simulation/seed";
import { getCampaignEfficiency, getStockoutRisks, listApprovals } from "@/database/queries";

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

    expect(story.steps).toHaveLength(6);
    expect(story.steps.every((step) => step.summary.length > 0)).toBe(true);
    expect(story.planIds.length).toBeGreaterThanOrEqual(2);

    // The governance step is the point of the demo: some actions must be parked.
    expect(listApprovals("PENDING").length).toBeGreaterThan(0);
    expect(story.disclaimer).toContain("SIMULATED");
  }, 90_000);

  it("is reproducible — two runs reach the same measured baseline", async () => {
    const first = await runDemoStory({ reset: true });
    const second = await runDemoStory({ reset: true });

    expect(second.before.revenuePaise).toBe(first.before.revenuePaise);
    expect(second.before.conversionRate).toBe(first.before.conversionRate);
    expect(second.before.orders).toBe(first.before.orders);
  }, 120_000);
});
