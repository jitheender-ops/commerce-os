/**
 * Procurement Agent — supplier selection and purchase orders.
 *
 * The selection rule is explicit: when the stockout lands before any supplier
 * can deliver, lead time wins and the agent says so; otherwise landed cost
 * wins, with reliability breaking near-ties. Orders above ₹50,000 are routed to
 * a human by the governance pipeline, not by this agent.
 */
import { z } from "zod";
import { evidence, reason, recommendation, runAgent, toolCaller, type Agent, type AgentRunContext } from "./runtime";
import { AGENTS } from "./definitions";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import type { StockoutRisk } from "@/database/queries";
import type { AgentResult, Recommendation, SupplierQuote } from "@/types";

const Assessment = z.object({ summary: z.string(), narrative: z.string() });

interface Need {
  productId: string;
  sku: string;
  quantity: number;
  urgencyDays: number;
}

export const procurementAgent: Agent = {
  id: "procurement",
  run: (ctx: AgentRunContext): Promise<AgentResult> =>
    runAgent("procurement", ctx, "Comparing suppliers for outstanding needs", async () => {
      const call = toolCaller("procurement", ctx);
      const needs = await resolveNeeds(ctx, call);

      const recommendations: Recommendation[] = [];
      const decisions: {
        need: Need;
        chosen: SupplierQuote;
        alternatives: SupplierQuote[];
        reasoning: string;
      }[] = [];

      for (const need of needs.slice(0, 4)) {
        const quotes = await call<SupplierQuote[]>("get_supplier_quotes", {
          productId: need.productId,
        });
        if (quotes.length === 0) continue;

        const viable = quotes.filter((q) => need.quantity >= q.minimumOrderQuantity);
        const pool = viable.length > 0 ? viable : quotes;
        const urgent = need.urgencyDays < 0;

        const chosen = urgent ? fastest(pool) : cheapest(pool);
        const reasoning = urgent
          ? `Stockout lands in ${Math.abs(need.urgencyDays).toFixed(1)} days before resupply, so lead time outranks unit cost.`
          : `No imminent stockout, so the lowest landed cost wins.`;

        // Respect the supplier's minimum order quantity.
        const quantity = Math.max(need.quantity, chosen.minimumOrderQuantity);
        const totalPaise = quantity * chosen.unitCostPaise;

        decisions.push({
          need,
          chosen,
          alternatives: pool.filter((q) => q.supplierId !== chosen.supplierId),
          reasoning,
        });

        recommendations.push(
          recommendation("procurement", {
            title: `Order ${quantity} × ${need.sku} from ${chosen.supplierName}`,
            rationale:
              `${reasoning} ${chosen.supplierName} quotes ${formatMoney(chosen.unitCostPaise)}/unit on a ` +
              `${chosen.leadTimeDays}-day lead time with reliability ${chosen.reliabilityScore}. ` +
              `Total ${formatMoney(totalPaise)}.` +
              (quantity > need.quantity
                ? ` Quantity raised from ${need.quantity} to meet the ${chosen.minimumOrderQuantity}-unit minimum.`
                : ""),
            tool: "create_purchase_order",
            input: {
              productId: need.productId,
              supplierId: chosen.supplierId,
              quantity,
              reason: `Stockout cover — ${reasoning}`,
            },
            estimatedImpactPaise: totalPaise,
            confidence: 0.8,
            risk: totalPaise > 50_000_00 ? "HIGH" : "MEDIUM",
          }),
        );
      }

      const observed = [
        evidence("Outstanding needs", String(needs.length)),
        ...decisions.map(({ need, chosen, alternatives }) =>
          evidence(
            need.sku,
            `${chosen.supplierName} @ ${formatMoney(chosen.unitCostPaise)}`,
            `${chosen.leadTimeDays}d lead · ${alternatives.length} alternatives quoted`,
          ),
        ),
      ];

      const deterministic = {
        summary:
          decisions.length === 0
            ? `No purchase is needed right now.`
            : `${decisions.length} purchase orders recommended, ${formatMoneyCompact(
                recommendations.reduce((s, r) => s + r.estimatedImpactPaise, 0),
              )} in total.`,
        narrative:
          decisions.length === 0
            ? `Every SKU has enough cover for its supplier lead time, so there is nothing to buy.`
            : decisions
                .map(({ need, chosen, alternatives, reasoning }) => {
                  const cheaper = alternatives.filter((a) => a.unitCostPaise < chosen.unitCostPaise);
                  const tradeOff =
                    cheaper.length > 0
                      ? ` ${cheaper[0].supplierName} is ${formatMoney(chosen.unitCostPaise - cheaper[0].unitCostPaise)}/unit cheaper but takes ${cheaper[0].leadTimeDays} days.`
                      : "";
                  return `${need.sku}: ${chosen.supplierName} at ${formatMoney(chosen.unitCostPaise)}/unit, ${chosen.leadTimeDays}-day lead. ${reasoning}${tradeOff}`;
                })
                .join(" "),
      };

      const { value, engine } = await reason({
        kind: "procurement.assessment",
        schema: Assessment,
        system: AGENTS.procurement.instructions,
        user: [
          `Needs and quotes:`,
          ...decisions.map(
            ({ need, chosen, alternatives }) =>
              [
                `- ${need.sku} needs ${need.quantity} units (slack ${need.urgencyDays} days).`,
                `  chosen: ${chosen.supplierName} ${chosen.unitCostPaise} paise/unit, ${chosen.leadTimeDays}d, reliability ${chosen.reliabilityScore}`,
                ...alternatives.map(
                  (a) =>
                    `  alt: ${a.supplierName} ${a.unitCostPaise} paise/unit, ${a.leadTimeDays}d, reliability ${a.reliabilityScore}`,
                ),
              ].join("\n"),
          ),
          ``,
          `Explain each supplier choice, naming the trade-off you accepted.`,
        ].join("\n"),
        fallback: () => deterministic,
      });

      return {
        headline: value.summary,
        observed,
        inference: decisions.map(
          ({ need, chosen, reasoning }) => `${need.sku} → ${chosen.supplierName}. ${reasoning}`,
        ),
        recommendations,
        narrative: value.narrative,
        engine,
      };
    }),
};

/**
 * Needs come from the Inventory Agent when it ran earlier in the plan;
 * otherwise this agent derives them itself so it is useful when run alone.
 */
async function resolveNeeds(
  ctx: AgentRunContext,
  call: <T>(name: string, input?: Record<string, unknown>) => Promise<T>,
): Promise<Need[]> {
  const delegated = ctx.priorResults
    .filter((result) => result.agentId === "inventory")
    .flatMap((result) => result.recommendations)
    .filter((rec) => rec.input?.productId && rec.input?.quantity)
    .map((rec) => ({
      productId: String(rec.input!.productId),
      sku: rec.title.split(" ").at(-1) ?? String(rec.input!.productId),
      quantity: Number(rec.input!.quantity),
      urgencyDays: Number(rec.input!.urgencyDays ?? 0),
    }));

  if (delegated.length > 0) return delegated;

  const risks = await call<StockoutRisk[]>("get_inventory", { onlyAtRisk: true });
  return risks.slice(0, 4).map((risk) => ({
    productId: risk.productId,
    sku: risk.sku,
    quantity: Math.max(
      1,
      Math.ceil(risk.velocityPerDay * (risk.leadTimeDays + 7)) - risk.onHand,
    ),
    urgencyDays: risk.slackDays,
  }));
}

const fastest = (quotes: SupplierQuote[]): SupplierQuote =>
  [...quotes].sort(
    (a, b) => a.leadTimeDays - b.leadTimeDays || b.reliabilityScore - a.reliabilityScore,
  )[0];

const cheapest = (quotes: SupplierQuote[]): SupplierQuote =>
  [...quotes].sort(
    (a, b) => a.unitCostPaise - b.unitCostPaise || b.reliabilityScore - a.reliabilityScore,
  )[0];
