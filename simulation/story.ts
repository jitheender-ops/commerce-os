/**
 * The scripted hackathon demo.
 *
 * What is scripted is only the *disruption* — which faults are injected and in
 * what order. Everything after that is the ordinary system: the same event bus,
 * the same plan templates, the same agents, the same governance. Nothing here
 * fabricates a finding or pre-writes a conclusion.
 */
import { getBusinessSummary, listApprovals } from "@/database/queries";
import { planForEvent, runPlan } from "@/orchestration/orchestrator";
import { seedDemo } from "@/simulation/seed";
import { triggerScenario } from "@/simulation/scenarios";
import { newCorrelationId } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import type { AgentResult, Approval } from "@/types";
import type { BusinessSummary } from "@/database/queries";

export interface DemoStep {
  key: string;
  title: string;
  detail: string;
}

export const DEMO_STEPS: DemoStep[] = [
  { key: "baseline", title: "Baseline", detail: "Reset to the seeded business and record where it stands." },
  { key: "disrupt", title: "Disruption", detail: "Three real faults are written into the data: a checkout regression, a stockout, and a campaign collapse." },
  { key: "investigate", title: "Investigation", detail: "Analytics decomposes the revenue movement; Inventory, Pricing and Customer rule their own domains in or out." },
  { key: "supply", title: "Supply response", detail: "Inventory sizes the reorder and Procurement compares suppliers." },
  { key: "govern", title: "Governance", detail: "Low-risk actions execute; anything above the limits is parked for a human." },
  { key: "verify", title: "Verification", detail: "The business position is measured again and compared with the baseline." },
];

export interface DemoStepResult extends DemoStep {
  summary: string;
  facts: string[];
  results: AgentResult[];
  correlationId: string | null;
}

export interface DemoStoryResult {
  steps: DemoStepResult[];
  before: BusinessSummary;
  after: BusinessSummary;
  pendingApprovals: Approval[];
  executedActions: number;
  proposedActions: number;
  planIds: string[];
  /** Everything here is a simulation of a business, not a claim about a real one. */
  disclaimer: string;
}

export async function runDemoStory(options: { reset?: boolean } = {}): Promise<DemoStoryResult> {
  const steps: DemoStepResult[] = [];
  const planIds: string[] = [];

  if (options.reset !== false) seedDemo();

  const before = getBusinessSummary();
  steps.push({
    ...DEMO_STEPS[0],
    summary: `Business reset to the seeded baseline.`,
    facts: [
      `Revenue ${before.revenuePaise} paise on ${before.orders} orders`,
      `Conversion ${before.conversionRate}%`,
      `${before.inventoryRisks} SKUs at stockout risk`,
      `${before.openTickets} open tickets`,
    ],
    results: [],
    correlationId: null,
  });

  // ── Disruption: three faults, written to the database, no plans yet. ───────
  const disruptions = [];
  for (const id of ["revenue_drop", "stockout", "campaign_failure"] as const) {
    const run = await triggerScenario(id, { autoRun: false });
    disruptions.push(run);
  }
  steps.push({
    ...DEMO_STEPS[1],
    summary: `Three faults injected into the live data.`,
    facts: disruptions.map((d) => `${d.scenario.label}: ${d.summary}`),
    results: [],
    correlationId: null,
  });

  // ── Investigation ─────────────────────────────────────────────────────────
  const investigationId = newCorrelationId();
  const investigation = await runPlan({
    ...planForEvent("REVENUE_ANOMALY", {})!,
    correlationId: investigationId,
  });
  planIds.push(investigation.plan.id);
  const analytics = investigation.results.find((r) => r.agentId === "analytics");
  const ceo = investigation.results.find((r) => r.agentId === "ceo");

  steps.push({
    ...DEMO_STEPS[2],
    summary: analytics?.headline ?? "Investigation completed.",
    facts: [
      ...(analytics?.observed.slice(0, 4).map((e) => `${e.label}: ${e.value}${e.detail ? ` (${e.detail})` : ""}`) ?? []),
      ...(analytics?.inference.slice(0, 2) ?? []),
    ],
    results: investigation.results,
    correlationId: investigationId,
  });

  // ── Supply response ───────────────────────────────────────────────────────
  const supplyId = newCorrelationId();
  const supply = await runPlan({
    ...planForEvent("INVENTORY_LOW", {})!,
    correlationId: supplyId,
  });
  planIds.push(supply.plan.id);
  const procurement = supply.results.find((r) => r.agentId === "procurement");

  steps.push({
    ...DEMO_STEPS[3],
    summary: procurement?.headline ?? "Supply review completed.",
    facts: [
      ...(supply.results.find((r) => r.agentId === "inventory")?.inference.slice(0, 2) ?? []),
      ...(procurement?.inference.slice(0, 2) ?? []),
    ],
    results: supply.results,
    correlationId: supplyId,
  });

  // ── Governance ────────────────────────────────────────────────────────────
  const pending = listApprovals("PENDING");
  const allResults = [...investigation.results, ...supply.results];
  const executions = [...investigation.executions, ...supply.executions];
  const skipped = [...investigation.skipped, ...supply.skipped];
  const executed = executions.filter((e) => e.status === "COMPLETED");
  const parked = executions.filter((e) => e.status === "PENDING_APPROVAL");
  const denied = executions.filter((e) => e.status === "DENIED" || e.status === "FAILED");

  steps.push({
    ...DEMO_STEPS[4],
    summary:
      `${executions.length} actions attempted: ${executed.length} executed, ` +
      `${parked.length} sent to a human, ${denied.length} blocked.`,
    facts: [
      ...executed.map((e) => `EXECUTED — ${e.title}`),
      ...parked.map(
        (e) => `NEEDS APPROVAL — ${e.title} (${formatMoney(e.financialImpactPaise)}): ${e.reason}`,
      ),
      ...denied.map((e) => `BLOCKED — ${e.title}: ${e.reason}`),
      skipped.length > 0 ? `${skipped.length} further proposals were not attempted this run.` : "",
    ].filter(Boolean),
    results: [],
    correlationId: null,
  });

  // ── Verification ──────────────────────────────────────────────────────────
  const after = getBusinessSummary();
  steps.push({
    ...DEMO_STEPS[5],
    summary: ceo?.headline ?? "Position re-measured.",
    facts: [
      `Revenue ${before.revenuePaise} → ${after.revenuePaise} paise`,
      `Conversion ${before.conversionRate}% → ${after.conversionRate}%`,
      `At-risk SKUs ${before.inventoryRisks} → ${after.inventoryRisks}`,
      `Open tickets ${before.openTickets} → ${after.openTickets}`,
      // Stating this plainly matters more than a flattering number: the system
      // diagnosed a checkout regression, and a checkout regression is fixed by
      // an engineer, not by an agent with a pricing tool.
      `The checkout regression is diagnosed, not repaired — no agent holds a tool that can fix it. ` +
        `Revenue stays down until it is fixed. What the agents did change is supply cover, ` +
        `pricing position and the ticket queue.`,
    ],
    results: ceo ? [ceo] : [],
    correlationId: investigationId,
  });

  return {
    steps,
    before,
    after,
    pendingApprovals: pending,
    executedActions: executed.length,
    proposedActions: allResults.reduce((sum, r) => sum + r.recommendations.length, 0),
    planIds,
    disclaimer:
      "SIMULATED — this is a generated business. Figures describe the simulation, not a real store. " +
      "Projected impacts are labelled ESTIMATED and come from stated models, not from measured outcomes.",
  };
}
