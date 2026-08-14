/**
 * The scripted hackathon demo.
 *
 * What is scripted is only the *disruption* — which faults are injected and in
 * what order. Everything after that is the ordinary system: the same event bus,
 * the same plan templates, the same agents, the same governance. Nothing here
 * fabricates a finding or pre-writes a conclusion.
 */
import { getBusinessSummary, listApprovals, listFulfillments } from "@/database/queries";
import { listDeadLetters, MAX_ATTEMPTS, runDueJobs } from "@/events/queue";
import { describeSupplier } from "@/integrations/supplier";
// Registers the fulfilment job handler. Without it the queue would dead-letter
// every handover for want of a handler, which is a wiring failure that only
// shows up when the story runs outside the Next app — as the tests do.
import "@/integrations/fulfillment-worker";
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
  { key: "fulfil", title: "Fulfilment", detail: "Paid orders are handed to the supplier through the queue, and the supplier answers." },
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
    ...(await planForEvent("REVENUE_ANOMALY", {}))!,
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
    ...(await planForEvent("INVENTORY_LOW", {}))!,
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

  // ── Fulfilment ────────────────────────────────────────────────────────────
  // The one step whose work leaves the process. The agent proposes handovers,
  // governance decides them, and the queue worker makes the supplier call —
  // drained here rather than waited for, so the step reports what the supplier
  // actually answered instead of what was merely queued.
  const fulfilId = newCorrelationId();
  const fulfil = await runPlan({
    ...(await planForEvent("PAYMENT_SUCCESS", {}))!,
    correlationId: fulfilId,
  });
  planIds.push(fulfil.plan.id);
  await runDueJobs(50);

  const fulfilments = listFulfillments(undefined, 50);
  const submitted = fulfilments.filter((f) => f.status === "SUBMITTED" || f.status === "SHIPPED");
  const stuck = fulfilments.filter((f) => f.status === "EXCEPTION");
  const dead = listDeadLetters(10);
  const supplier = describeSupplier();

  steps.push({
    ...DEMO_STEPS[4],
    summary:
      fulfilments.length === 0
        ? `No orders were ready to hand over.`
        : `${submitted.length} of ${fulfilments.length} orders accepted by ${supplier.label}` +
          (stuck.length > 0 ? `, ${stuck.length} stuck` : ``) + `.`,
    facts: [
      `Supplier: ${supplier.label} — ${supplier.live ? "live" : "simulated, nothing is sent"}`,
      ...submitted
        .slice(0, 3)
        .map((f) => `ACCEPTED — ${f.orderId} → ${f.externalId} (${f.attempts} attempt${f.attempts === 1 ? "" : "s"})`),
      // A fulfilment parked for approval has no row here at all — the tool never
      // executed, so it appears in the Governance step instead. A row still
      // pending after the drain is one whose call failed and is waiting on its
      // backoff.
      ...fulfilments
        .filter((f) => f.status === "PENDING_SUPPLIER")
        .slice(0, 2)
        .map((f) => `RETRYING — ${f.orderId}: ${f.lastError ?? "queued, not yet attempted"}`),
      ...stuck.slice(0, 2).map((f) => `EXCEPTION — ${f.orderId}: ${f.lastError ?? "unknown error"}`),
      dead.length > 0
        ? `${dead.length} job(s) dead-lettered after ${MAX_ATTEMPTS} attempts — retrying further would hide the fault, not fix it.`
        : `No dead letters: nothing failed ${MAX_ATTEMPTS} times.`,
    ].filter(Boolean),
    results: fulfil.results,
    correlationId: fulfilId,
  });

  // ── Governance ────────────────────────────────────────────────────────────
  const pending = listApprovals("PENDING");
  const allResults = [...investigation.results, ...supply.results, ...fulfil.results];
  const executions = [...investigation.executions, ...supply.executions, ...fulfil.executions];
  const skipped = [...investigation.skipped, ...supply.skipped, ...fulfil.skipped];
  const executed = executions.filter((e) => e.status === "COMPLETED");
  const parked = executions.filter((e) => e.status === "PENDING_APPROVAL");
  const denied = executions.filter((e) => e.status === "DENIED" || e.status === "FAILED");

  steps.push({
    ...DEMO_STEPS[5],
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
    ...DEMO_STEPS[6],
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
