/**
 * CEO Agent — synthesis and conflict resolution.
 *
 * It holds no write permission over business data; it reads what the specialists
 * found and decides what the business should do about it. When recommendations
 * conflict, the precedence order is fixed and applied in code:
 *
 *   safety > policy > financial constraints > business objective > agent preference
 *
 * A model is never asked to arbitrate — it explains the arbitration.
 */
import { z } from "zod";
import {
  evidence,
  mutatingCaller,
  reason,
  runAgent,
  toolCaller,
  type Agent,
  type AgentRunContext,
} from "./runtime";
import { AGENTS } from "./definitions";
import { formatDelta, formatMoneyCompact } from "@/lib/money";
import type { BusinessSummary } from "@/database/queries";
import type { AgentResult, Recommendation } from "@/types";

const Synthesis = z.object({
  headline: z.string(),
  priority: z.string(),
  narrative: z.string(),
});

export interface Conflict {
  topic: string;
  positions: { agentId: string; stance: string }[];
  resolution: string;
  basis: "safety" | "policy" | "financial" | "objective" | "preference";
}

export const ceoAgent: Agent = {
  id: "ceo",
  run: (ctx: AgentRunContext): Promise<AgentResult> =>
    runAgent("ceo", ctx, "Synthesising findings across agents", async () => {
      const call = toolCaller("ceo", ctx);
      const mutate = mutatingCaller("ceo", ctx);

      const summary = await call<BusinessSummary>("get_business_summary");
      const findings = ctx.priorResults.filter((r) => r.agentId !== "ceo");
      const allRecommendations = findings.flatMap((r) => r.recommendations);
      const conflicts = detectConflicts(findings);
      const ranked = rankRecommendations(allRecommendations);

      const deterministic = {
        headline:
          findings.length === 0
            ? `No specialist findings to synthesise yet.`
            : `${findings.length} agents reported; ${ranked.length} actions ranked, ${conflicts.length} conflicts resolved.`,
        priority:
          ranked[0]?.title ?? `Hold position — no action clears the bar for acting today.`,
        narrative: [
          `Profit on the latest day is ${formatMoneyCompact(summary.profitPaise)} (${formatDelta(summary.deltas.profit)}), ` +
            `on revenue of ${formatMoneyCompact(summary.revenuePaise)} (${formatDelta(summary.deltas.revenue)}).`,
          ...findings.map((f) => `${AGENTS[f.agentId].name}: ${f.headline}`),
          conflicts.length > 0
            ? conflicts.map((c) => `Conflict on ${c.topic} resolved on ${c.basis} grounds: ${c.resolution}`).join(" ")
            : `No agent recommendations conflict.`,
        ].join(" "),
      };

      const { value, engine } = await reason({
        kind: "ceo.synthesis",
        schema: Synthesis,
        system: AGENTS.ceo.instructions,
        user: [
          `Business position: revenue ${summary.revenuePaise} paise (${formatDelta(summary.deltas.revenue)}), ` +
            `profit ${summary.profitPaise} paise (${formatDelta(summary.deltas.profit)}), ` +
            `conversion ${summary.conversionRate}% (${formatDelta(summary.deltas.conversion)}), ` +
            `${summary.inventoryRisks} SKUs at stockout risk, ${summary.openTickets} open tickets.`,
          ``,
          `Specialist findings:`,
          ...findings.map((f) =>
            [
              `${AGENTS[f.agentId].name}: ${f.headline}`,
              ...f.inference.map((i) => `  - ${i}`),
            ].join("\n"),
          ),
          ``,
          `Proposed actions, already ranked by expected impact:`,
          ...ranked
            .slice(0, 6)
            .map(
              (r, index) =>
                `${index + 1}. [${AGENTS[r.agentId].name}] ${r.title} — impact ${r.estimatedImpactPaise} paise, ` +
                `confidence ${r.confidence}, risk ${r.risk}`,
            ),
          ``,
          conflicts.length > 0
            ? `Conflicts already resolved by the precedence rule:\n` +
              conflicts.map((c) => `- ${c.topic}: ${c.resolution} (${c.basis})`).join("\n")
            : `No conflicts between agents.`,
          ``,
          `State the single highest priority and why it beats the alternatives.`,
        ].join("\n"),
        fallback: () => deterministic,
      });

      // The conclusion is written to shared memory so later runs inherit it.
      await mutate("record_plan_note", {
        content: `${value.priority} (context: ${value.headline})`,
        importance: 0.8,
      });

      return {
        headline: value.headline,
        observed: [
          evidence("Revenue", formatMoneyCompact(summary.revenuePaise), formatDelta(summary.deltas.revenue)),
          evidence("Profit", formatMoneyCompact(summary.profitPaise), formatDelta(summary.deltas.profit)),
          evidence("Agents reporting", String(findings.length)),
          evidence("Actions proposed", String(allRecommendations.length)),
          evidence("Conflicts resolved", String(conflicts.length)),
        ],
        inference: [
          `Top priority: ${value.priority}`,
          ...conflicts.map((c) => `${c.topic} → ${c.resolution} (resolved on ${c.basis})`),
        ],
        recommendations: ranked,
        narrative: value.narrative,
        engine,
      };
    }),
};

/**
 * Impact × confidence, with a penalty for risk so a marginal high-risk action
 * does not outrank a solid low-risk one.
 */
function rankRecommendations(recommendations: Recommendation[]): Recommendation[] {
  const riskPenalty = { LOW: 1, MEDIUM: 0.85, HIGH: 0.6, CRITICAL: 0.3 };
  return [...recommendations].sort(
    (a, b) =>
      b.estimatedImpactPaise * b.confidence * riskPenalty[b.risk] -
      a.estimatedImpactPaise * a.confidence * riskPenalty[a.risk],
  );
}

/**
 * Finds cases where two agents want to move the same lever in opposite
 * directions, and resolves them by the fixed precedence order.
 */
export function detectConflicts(findings: AgentResult[]): Conflict[] {
  const conflicts: Conflict[] = [];

  const priceCuts = findings
    .flatMap((f) => f.recommendations)
    .filter((r) => r.tool === "update_price" && r.title.startsWith("Reduce"));
  const spendIncreases = findings
    .flatMap((f) => f.recommendations)
    .filter((r) => r.tool === "propose_budget_change" && Number(r.input?.deltaPaise ?? 0) > 0);

  // Cutting price and raising spend at the same time compounds margin pressure.
  if (priceCuts.length > 0 && spendIncreases.length > 0) {
    conflicts.push({
      topic: "margin pressure",
      positions: [
        { agentId: "pricing", stance: `cut price on ${priceCuts.length} SKUs to close a competitive gap` },
        { agentId: "marketing", stance: `increase daily campaign spend` },
      ],
      resolution:
        `Price changes proceed; the budget increase waits until the next efficiency read. ` +
        `Doing both at once would compress margin from two directions with no way to attribute the result.`,
      basis: "financial",
    });
  }

  // Promoting something that is about to stock out wastes the spend.
  const restockNeeds = findings
    .filter((f) => f.agentId === "inventory")
    .flatMap((f) => f.recommendations)
    .map((r) => String(r.input?.productId ?? ""));
  const promotions = findings
    .filter((f) => f.agentId === "marketing")
    .flatMap((f) => f.recommendations)
    .filter((r) => r.tool === "propose_budget_change");

  if (restockNeeds.length > 0 && promotions.length > 0) {
    conflicts.push({
      topic: "promoting constrained stock",
      positions: [
        { agentId: "inventory", stance: `${restockNeeds.length} SKUs stock out before resupply` },
        { agentId: "marketing", stance: `move budget toward the best-performing campaign` },
      ],
      resolution:
        `Purchase orders go first. Campaign budget moves after stock is confirmed inbound, so demand is not ` +
        `generated against inventory that cannot ship.`,
      basis: "objective",
    });
  }

  return conflicts;
}
