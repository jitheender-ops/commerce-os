/**
 * Pricing Agent — margin defence and competitive position.
 *
 * Candidates come from the gap between our price and the tracked competitor
 * price, filtered by what the margin floor and the 10% step limit actually
 * allow. Proposals are sized to stay inside policy rather than being clipped
 * afterwards — an agent that proposes illegal actions and gets rejected is
 * noise in the approval queue.
 */
import { z } from "zod";
import { evidence, reason, recommendation, runAgent, toolCaller, type Agent, type AgentRunContext } from "./runtime";
import { AGENTS } from "./definitions";
import { POLICY_LIMITS } from "@/policies/rules";
import { formatMoney, formatMoneyCompact, marginPct } from "@/lib/money";
import type { AgentResult, Recommendation } from "@/types";

interface CompetitorRow {
  productId: string;
  sku: string;
  name: string;
  ourPricePaise: number;
  competitorPricePaise: number;
  gapPercent: number;
  marginPercent: number;
}

interface Simulation {
  before: { units: number; revenuePaise: number; profitPaise: number; marginPercent: number };
  after: { units: number; revenuePaise: number; profitPaise: number; marginPercent: number };
  profitDeltaPaise: number;
  basis: string;
}

const Assessment = z.object({ summary: z.string(), narrative: z.string() });

const { minimumMarginPercent, maxPriceChangePercent } = POLICY_LIMITS.pricing;

export const pricingAgent: Agent = {
  id: "pricing",
  run: (ctx: AgentRunContext): Promise<AgentResult> =>
    runAgent("pricing", ctx, "Comparing prices and margin against the market", async () => {
      const call = toolCaller("pricing", ctx);
      const rows = await call<CompetitorRow[]>("get_competitor_prices", { limit: 50 });

      // Priced well above the market with margin to give back.
      const overpriced = rows
        .filter((r) => r.gapPercent > 6 && r.marginPercent > minimumMarginPercent + 8)
        .slice(0, 3);
      // Priced below the market with margin left on the table.
      const underpriced = rows
        .filter((r) => r.gapPercent < -8 && r.marginPercent < 45)
        .slice(0, 2);

      const recommendations: Recommendation[] = [];
      const simulations: { row: CompetitorRow; target: number; simulation: Simulation }[] = [];
      const rejected: string[] = [];

      for (const row of [...overpriced, ...underpriced]) {
        const target = proposePrice(row);
        if (target === null) continue;

        const simulation = await call<Simulation>("simulate_price_change", {
          productId: row.productId,
          newPricePaise: target,
        });
        simulations.push({ row, target, simulation });

        // Closing a competitive gap is not worth doing if the elasticity model
        // says it destroys gross profit. Proposing it anyway would put a
        // known-negative action in front of a human, which is how approval
        // queues stop being read.
        if (simulation.profitDeltaPaise <= 0) {
          rejected.push(
            `${row.sku}: a move to ${formatMoney(target)} closes a ${Math.abs(row.gapPercent).toFixed(1)}% gap but ` +
              `is projected to change profit by ${formatMoneyCompact(simulation.profitDeltaPaise)} — not proposed.`,
          );
          continue;
        }

        const direction = target < row.ourPricePaise ? "Reduce" : "Raise";
        recommendations.push(
          recommendation("pricing", {
            title: `${direction} ${row.sku} to ${formatMoney(target)}`,
            rationale:
              `We are ${Math.abs(row.gapPercent).toFixed(1)}% ${row.gapPercent > 0 ? "above" : "below"} the ` +
              `competitor at ${formatMoney(row.competitorPricePaise)}. The change moves margin from ` +
              `${simulation.before.marginPercent}% to ${simulation.after.marginPercent}%, staying above the ` +
              `${minimumMarginPercent}% floor, and is within the ${maxPriceChangePercent}% step limit. ` +
              `Projected monthly profit change ${formatMoneyCompact(simulation.profitDeltaPaise)} (${simulation.basis}).`,
            tool: "update_price",
            input: {
              productId: row.productId,
              newPricePaise: target,
              reason: `Competitive gap ${row.gapPercent.toFixed(1)}%, margin held at ${simulation.after.marginPercent}%`,
            },
            estimatedImpactPaise: simulation.profitDeltaPaise,
            confidence: 0.6,
            risk: "MEDIUM",
          }),
        );
      }

      const observed = [
        evidence("Products priced", String(rows.length)),
        evidence("Above market by >6%", String(rows.filter((r) => r.gapPercent > 6).length)),
        evidence("Below market by >8%", String(rows.filter((r) => r.gapPercent < -8).length)),
        evidence(
          "Below the margin floor",
          String(rows.filter((r) => r.marginPercent < minimumMarginPercent).length),
          `floor is ${minimumMarginPercent}%`,
        ),
        ...simulations
          .slice(0, 3)
          .map(({ row, target, simulation }) =>
            evidence(
              row.sku,
              `${formatMoney(row.ourPricePaise)} → ${formatMoney(target)}`,
              `margin ${simulation.before.marginPercent}% → ${simulation.after.marginPercent}%`,
            ),
          ),
      ];

      const deterministic = {
        summary:
          recommendations.length === 0
            ? rejected.length > 0
              ? `${rejected.length} repricing options examined; none improve profit, so none are proposed.`
              : `No price change clears both the margin floor and the step limit today.`
            : `${recommendations.length} price changes are available within policy.`,
        narrative:
          recommendations.length === 0
            ? rejected.length > 0
              ? rejected.join(" ")
              : `Every product is either priced in line with the market or lacks the margin headroom to move without breaching the ${minimumMarginPercent}% floor.`
            : simulations
                .filter(({ simulation }) => simulation.profitDeltaPaise > 0)
                .map(
                  ({ row, target, simulation }) =>
                    `${row.sku} sits ${Math.abs(row.gapPercent).toFixed(1)}% ${row.gapPercent > 0 ? "above" : "below"} the market; ` +
                    `moving to ${formatMoney(target)} holds margin at ${simulation.after.marginPercent}% and is projected to ` +
                    `change monthly profit by ${formatMoneyCompact(simulation.profitDeltaPaise)}.`,
                )
                .join(" "),
      };

      const { value, engine } = await reason({
        kind: "pricing.assessment",
        schema: Assessment,
        system: AGENTS.pricing.instructions,
        user: [
          `Competitive position (positive gap = we are more expensive):`,
          ...rows
            .slice(0, 12)
            .map(
              (r) =>
                `- ${r.sku}: ours ${formatMoney(r.ourPricePaise)}, market ${formatMoney(r.competitorPricePaise)}, ` +
                `gap ${r.gapPercent}%, margin ${r.marginPercent}%`,
            ),
          ``,
          `Proposals (all within the ${minimumMarginPercent}% margin floor and ${maxPriceChangePercent}% step limit):`,
          ...simulations.map(
            ({ row, target, simulation }) =>
              `- ${row.sku} → ${formatMoney(target)}, margin ${simulation.after.marginPercent}%, ` +
              `projected profit change ${simulation.profitDeltaPaise} paise (estimate)`,
          ),
          ``,
          `Summarise the pricing position. Projections are estimates — label them as such.`,
        ].join("\n"),
        fallback: () => deterministic,
      });

      return {
        headline: value.summary,
        observed,
        inference: [
          ...simulations.map(
            ({ row, simulation }) =>
              `${row.sku}: projected units ${simulation.before.units} → ${simulation.after.units}, ` +
              `profit change ${formatMoneyCompact(simulation.profitDeltaPaise)} (ESTIMATED)`,
          ),
          ...rejected.map((line) => `Considered and rejected — ${line}`),
        ],
        recommendations,
        narrative: value.narrative,
        engine,
      };
    }),
};

/**
 * Picks the largest move that stays inside both policy limits, so the proposal
 * is executable as written.
 */
function proposePrice(row: CompetitorRow): number | null {
  const costPaise = Math.round(row.ourPricePaise * (1 - row.marginPercent / 100));
  const stepFloor = Math.round(row.ourPricePaise * (1 - maxPriceChangePercent / 100));
  const stepCeiling = Math.round(row.ourPricePaise * (1 + maxPriceChangePercent / 100));
  // Lowest price that still clears the margin floor.
  const marginFloorPrice = Math.ceil(costPaise / (1 - minimumMarginPercent / 100));

  if (row.gapPercent > 0) {
    // Undercut the competitor slightly, bounded by the step limit and margin floor.
    const target = Math.max(
      Math.round(row.competitorPricePaise * 0.99),
      stepFloor,
      marginFloorPrice,
    );
    if (target >= row.ourPricePaise) return null;
    return marginPct(target, costPaise) >= minimumMarginPercent ? target : null;
  }

  // Below market: move up toward it, bounded by the step limit.
  const target = Math.min(Math.round(row.competitorPricePaise * 0.98), stepCeiling);
  return target > row.ourPricePaise ? target : null;
}
