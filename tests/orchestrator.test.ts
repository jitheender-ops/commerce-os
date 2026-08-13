import { beforeAll, describe, expect, it } from "vitest";
import { planForQuestion, planForEvent, runPlan } from "@/orchestration/orchestrator";
import { seedDemo } from "@/simulation/seed";
import { listApprovals, listAudit } from "@/database/queries";

beforeAll(() => {
  seedDemo();
});

describe("orchestrator", () => {
  it("investigates a revenue drop end to end", async () => {
    const request = planForQuestion("why did sales drop yesterday?");
    expect(request.template.id).toBe("revenue_investigation");

    const run = await runPlan(request);

    expect(run.failed).toHaveLength(0);
    expect(run.plan.status).toBe("COMPLETED");
    // analytics, inventory, pricing, customer, ceo
    expect(run.results).toHaveLength(5);
    expect(run.tasks.every((t) => t.status === "COMPLETED")).toBe(true);
  }, 30_000);

  it("has the analytics agent name the conversion driver from real data", async () => {
    const run = await runPlan(planForQuestion("why did sales drop yesterday?"));
    const analytics = run.results.find((r) => r.agentId === "analytics");

    expect(analytics).toBeDefined();
    expect(analytics!.headline).toContain("Conversion rate");
    expect(analytics!.observed.length).toBeGreaterThan(3);
    // The root cause must reference the planted mobile checkout fault.
    expect(analytics!.inference.join(" ").toLowerCase()).toContain("mobile");
  }, 30_000);

  it("runs independent tasks and feeds results forward to the CEO", async () => {
    const run = await runPlan(planForQuestion("why did sales drop yesterday?"));
    const ceo = run.results.find((r) => r.agentId === "ceo");

    expect(ceo).toBeDefined();
    expect(ceo!.observed.find((e) => e.label === "Agents reporting")?.value).toBe("4");
    expect(ceo!.narrative.length).toBeGreaterThan(40);
  }, 30_000);

  it("routes a stockout event to inventory then procurement", async () => {
    const request = planForEvent("INVENTORY_LOW", { sku: "SKU-1001" });
    expect(request).not.toBeNull();
    expect(request!.template.id).toBe("stockout_response");

    const run = await runPlan(request!);
    const agentsRun = run.results.map((r) => r.agentId);
    expect(agentsRun).toContain("inventory");
    expect(agentsRun).toContain("procurement");
  }, 30_000);

  it("writes an audit row for every tool call", async () => {
    const before = listAudit({ limit: 500 }).length;
    await runPlan(planForEvent("CAMPAIGN_PERFORMANCE_CHANGED", {})!);
    const after = listAudit({ limit: 500 });

    expect(after.length).toBeGreaterThan(before);
    for (const entry of after.slice(0, 5)) {
      expect(entry.correlationId).toBeTruthy();
      expect(["ALLOW", "REQUIRE_APPROVAL", "DENY"]).toContain(entry.policyResult);
    }
  }, 30_000);

  it("labels which engine produced the reasoning", async () => {
    const run = await runPlan(planForEvent("CAMPAIGN_PERFORMANCE_CHANGED", {})!);
    for (const result of run.results) {
      expect(result.engine).toBe("Deterministic Business Engine");
    }
  }, 30_000);
});

describe("approvals", () => {
  it("parks high-value purchase orders instead of executing them", async () => {
    await runPlan(planForEvent("INVENTORY_LOW", {})!);
    const approvals = listApprovals("PENDING");
    // Procurement only proposes; nothing above the limit executes unattended.
    for (const approval of approvals) {
      expect(approval.status).toBe("PENDING");
      expect(approval.expectedOutcome.length).toBeGreaterThan(10);
    }
  }, 30_000);
});
