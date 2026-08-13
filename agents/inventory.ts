/**
 * Inventory Agent — stock cover against incoming demand.
 *
 * Risk is `days of cover − supplier lead time`. Negative slack means the
 * stockout lands before a replacement order could arrive, which is the only
 * definition of "urgent" that survives contact with a real supply chain.
 * Reorder quantities come from the weighted moving-average forecast, never from
 * a model.
 */
import { z } from "zod";
import { evidence, reason, recommendation, runAgent, toolCaller, type Agent, type AgentRunContext } from "./runtime";
import { AGENTS } from "./definitions";
import type { StockoutRisk } from "@/database/queries";
import type { AgentResult, Recommendation } from "@/types";

interface Forecast {
  method: string;
  dailyForecast: number;
  horizonUnits: number;
  confidence: number;
}

/** Days of demand held on top of lead-time cover. */
const SAFETY_DAYS = 7;

const Assessment = z.object({
  summary: z.string(),
  narrative: z.string(),
});

export const inventoryAgent: Agent = {
  id: "inventory",
  run: (ctx: AgentRunContext): Promise<AgentResult> =>
    runAgent("inventory", ctx, "Checking stock cover against demand", async () => {
      const call = toolCaller("inventory", ctx);

      const allRisks = await call<StockoutRisk[]>("get_inventory", { onlyAtRisk: false });
      const atRisk = allRisks.filter((r) => r.risk === "HIGH" || r.risk === "CRITICAL");
      const overstock = allRisks.filter((r) => r.daysOfCover > 90 && r.onHand > 60);

      const recommendations: Recommendation[] = [];
      const forecasts: { risk: StockoutRisk; forecast: Forecast; quantity: number }[] = [];

      // Only the worst few are worth a forecast call each.
      for (const risk of atRisk.slice(0, 5)) {
        const horizon = risk.leadTimeDays + SAFETY_DAYS;
        const forecast = await call<Forecast>("forecast_demand", {
          productId: risk.productId,
          horizonDays: horizon,
        });
        const quantity = Math.max(0, forecast.horizonUnits - risk.onHand);
        if (quantity <= 0) continue;
        forecasts.push({ risk, forecast, quantity });

        recommendations.push(
          recommendation("inventory", {
            title: `Reorder ${quantity} units of ${risk.sku}`,
            rationale:
              `${risk.onHand} on hand against ${risk.velocityPerDay}/day gives ${risk.daysOfCover} days of cover, ` +
              `but the supplier needs ${risk.leadTimeDays} days. Forecast demand over ${horizon} days is ` +
              `${forecast.horizonUnits} units (${forecast.method}, confidence ${(forecast.confidence * 100).toFixed(0)}%).`,
            // Inventory holds no purchasing permission — this is handed to
            // Procurement, which selects the supplier and raises the order.
            tool: null,
            input: { productId: risk.productId, quantity, urgencyDays: risk.slackDays },
            estimatedImpactPaise: 0,
            confidence: forecast.confidence,
            risk: risk.risk === "CRITICAL" ? "HIGH" : "MEDIUM",
          }),
        );
      }

      const observed = [
        evidence("SKUs tracked", String(allRisks.length)),
        evidence(
          "At stockout risk",
          String(atRisk.length),
          atRisk.length > 0 ? `worst: ${atRisk[0].sku} at ${atRisk[0].slackDays} days of slack` : undefined,
        ),
        evidence("Overstocked (>90 days cover)", String(overstock.length)),
        ...atRisk.slice(0, 3).map((r) =>
          evidence(
            r.sku,
            `${r.onHand} on hand`,
            `${r.velocityPerDay}/day · ${r.daysOfCover}d cover · ${r.leadTimeDays}d lead time`,
          ),
        ),
      ];

      const deterministic = {
        summary:
          atRisk.length === 0
            ? `No SKU will stock out before its supplier can resupply.`
            : `${atRisk.length} SKUs will stock out before resupply arrives; ${forecasts.length} need an order now.`,
        narrative:
          atRisk.length === 0
            ? `Every SKU has more days of cover than its supplier lead time. ${overstock.length} SKUs hold more than 90 days of cover and are tying up working capital.`
            : forecasts
                .map(
                  ({ risk, quantity }) =>
                    `${risk.sku} has ${risk.onHand} units against ${risk.velocityPerDay}/day, ` +
                    `stocking out in ${risk.daysOfCover} days with a ${risk.leadTimeDays}-day lead time — order ${quantity} units.`,
                )
                .join(" "),
      };

      const { value, engine } = await reason({
        kind: "inventory.assessment",
        schema: Assessment,
        system: AGENTS.inventory.instructions,
        user: [
          `At-risk SKUs (days of cover minus lead time, most urgent first):`,
          ...atRisk
            .slice(0, 5)
            .map(
              (r) =>
                `- ${r.sku} ${r.name}: ${r.onHand} on hand, ${r.velocityPerDay}/day, ` +
                `${r.daysOfCover}d cover, ${r.leadTimeDays}d lead time, slack ${r.slackDays}d (${r.risk})`,
            ),
          ``,
          `Recommended orders from the forecast:`,
          ...forecasts.map(
            ({ risk, forecast, quantity }) =>
              `- ${risk.sku}: order ${quantity} (forecast ${forecast.horizonUnits} units, confidence ${forecast.confidence})`,
          ),
          ``,
          `${overstock.length} SKUs hold over 90 days of cover.`,
          ``,
          `Summarise the stock position. Separate observed levels from forecast.`,
        ].join("\n"),
        fallback: () => deterministic,
      });

      return {
        headline: value.summary,
        observed,
        inference: forecasts.map(
          ({ risk, forecast, quantity }) =>
            `${risk.sku}: forecast ${forecast.horizonUnits} units over ${risk.leadTimeDays + SAFETY_DAYS} days ` +
            `(confidence ${(forecast.confidence * 100).toFixed(0)}%) → order ${quantity}`,
        ),
        recommendations,
        narrative: value.narrative,
        engine,
      };
    }),
};
