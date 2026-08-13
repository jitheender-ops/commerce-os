/**
 * Analytics Agent — what happened, why, and what to look at next.
 *
 * Revenue is decomposed as sessions × conversion × AOV. The driver with the
 * largest absolute movement is the primary suspect; supporting series
 * (payment failures, returns) are then checked to see which one explains it.
 * All of that is arithmetic. The model's contribution is ranking the competing
 * explanations and writing them down.
 */
import { z } from "zod";
import { evidence, reason, recommendation, runAgent, toolCaller, type Agent, type AgentRunContext } from "./runtime";
import { AGENTS } from "./definitions";
import { formatDelta, formatMoney, formatMoneyCompact } from "@/lib/money";
import type { BusinessSummary, RevenueDecomposition } from "@/database/queries";
import type { AgentResult } from "@/types";

interface ChannelRow {
  channel: string;
  orders: number;
  revenuePaise: number;
  paymentFailures: number;
  failureRate: number;
}

interface Anomaly {
  metric: string;
  current: number;
  expected: number;
  zScore: number;
  direction: "up" | "down";
  severity: string;
}

const Analysis = z.object({
  rootCause: z.string(),
  confidence: z.number().min(0).max(1),
  ruledOut: z.array(z.string()),
  nextInvestigation: z.string(),
  narrative: z.string(),
});

export const analyticsAgent: Agent = {
  id: "analytics",
  run: (ctx: AgentRunContext): Promise<AgentResult> =>
    runAgent("analytics", ctx, "Decomposing revenue movement", async () => {
      const call = toolCaller("analytics", ctx);

      const summary = await call<BusinessSummary>("get_business_summary");
      const decomposition = await call<RevenueDecomposition>("get_revenue_decomposition");
      const channels = await call<ChannelRow[]>("get_channel_breakdown", { days: 7 });
      const anomalies = await call<Anomaly[]>("detect_anomalies", { sigma: 2 });

      const worstChannel = [...channels].sort((a, b) => b.failureRate - a.failureRate)[0];
      const otherChannels = channels.filter((c) => c.channel !== worstChannel?.channel);
      const baselineFailureRate =
        otherChannels.length > 0
          ? otherChannels.reduce((s, c) => s + c.failureRate, 0) / otherChannels.length
          : 0;
      const channelIsOutlier =
        Boolean(worstChannel) && worstChannel.failureRate > baselineFailureRate * 2.5;

      const observed = [
        evidence(
          "Revenue (latest day)",
          formatMoneyCompact(summary.revenuePaise),
          `${formatDelta(summary.deltas.revenue)} vs 7-day average`,
        ),
        ...decomposition.drivers.map((driver) =>
          evidence(
            driver.name,
            formatDelta(driver.changePct),
            `${driver.contributionPct}% of total movement`,
          ),
        ),
        ...decomposition.supporting
          .filter((s) => s.label !== "Ad spend")
          .map((s) => evidence(s.label, s.value, s.detail)),
      ];

      if (worstChannel) {
        observed.push(
          evidence(
            `Payment failure rate — ${worstChannel.channel}`,
            `${worstChannel.failureRate}%`,
            `other channels average ${baselineFailureRate.toFixed(2)}%`,
          ),
        );
      }

      // Deterministic conclusion. This is what ships when no model is configured.
      const deterministic = deriveConclusion(
        summary,
        decomposition,
        anomalies,
        worstChannel,
        baselineFailureRate,
        channelIsOutlier,
      );

      const { value, engine } = await reason({
        kind: "analytics.root_cause",
        schema: Analysis,
        system: AGENTS.analytics.instructions,
        user: [
          `Revenue changed ${formatDelta(decomposition.revenueChangePct)} on ${decomposition.latestDay}.`,
          ``,
          `Driver decomposition (revenue = sessions × conversion × AOV):`,
          ...decomposition.drivers.map(
            (d) => `- ${d.name}: ${formatDelta(d.changePct)} (${d.contributionPct}% of movement)`,
          ),
          ``,
          `Supporting series:`,
          ...decomposition.supporting.map((s) => `- ${s.label}: ${s.value} (${s.detail ?? "no baseline"})`),
          ``,
          `Payment failure rate by channel:`,
          ...channels.map((c) => `- ${c.channel}: ${c.failureRate}% over ${c.orders} orders`),
          ``,
          anomalies.length
            ? `Statistical anomalies (>2σ): ${anomalies.map((a) => `${a.metric} ${a.zScore}σ`).join(", ")}`
            : `No metric breached 2σ.`,
          ``,
          `Name the single most likely root cause, list what the evidence rules out,`,
          `and state the next thing to check. Cite only the figures above.`,
        ].join("\n"),
        fallback: () => deterministic,
      });

      const recommendations = channelIsOutlier && worstChannel
        ? [
            recommendation("analytics", {
              title: `Investigate ${worstChannel.channel} checkout`,
              rationale:
                `${worstChannel.channel} is failing payments at ${worstChannel.failureRate}% against ` +
                `${baselineFailureRate.toFixed(2)}% elsewhere. At the current order rate this is the ` +
                `largest single recoverable loss.`,
              tool: null,
              input: null,
              estimatedImpactPaise: estimateRecoverablePaise(summary, worstChannel, baselineFailureRate),
              confidence: value.confidence,
              risk: "LOW",
            }),
          ]
        : [];

      return {
        headline: `${decomposition.primaryDriver} drove a ${formatDelta(decomposition.revenueChangePct)} revenue change`,
        observed,
        inference: [value.rootCause, ...value.ruledOut.map((r) => `Ruled out: ${r}`), `Next: ${value.nextInvestigation}`],
        recommendations,
        narrative: value.narrative,
        engine,
      };
    }),
};

function deriveConclusion(
  summary: BusinessSummary,
  decomposition: RevenueDecomposition,
  anomalies: Anomaly[],
  worstChannel: ChannelRow | undefined,
  baselineFailureRate: number,
  channelIsOutlier: boolean,
): z.infer<typeof Analysis> {
  const ranked = [...decomposition.drivers].sort(
    (a, b) => Math.abs(b.changePct) - Math.abs(a.changePct),
  );
  const primary = ranked[0];
  const ruledOut = ranked
    .slice(1)
    .filter((d) => Math.abs(d.changePct) < Math.abs(primary?.changePct ?? 0) / 2)
    .map((d) => `${d.name} moved only ${formatDelta(d.changePct)} and cannot account for the change`);

  const failureAnomaly = anomalies.find((a) => a.metric === "Mobile payment failures");

  let rootCause: string;
  let confidence: number;
  let nextInvestigation: string;

  if (primary?.name === "Conversion rate" && channelIsOutlier && worstChannel) {
    rootCause =
      `Checkout conversion fell because ${worstChannel.channel} payments are failing at ` +
      `${worstChannel.failureRate}%, against ${baselineFailureRate.toFixed(2)}% on other channels.`;
    confidence = failureAnomaly ? 0.88 : 0.72;
    nextInvestigation = `Pull the payment gateway error codes for ${worstChannel.channel} over the last 24 hours.`;
  } else if (primary?.name === "Traffic (sessions)") {
    rootCause = `Revenue moved with traffic; conversion and order value held steady.`;
    confidence = 0.75;
    nextInvestigation = `Check campaign delivery and organic session counts by source.`;
  } else if (primary?.name === "Average order value") {
    rootCause = `Order value shifted while traffic and conversion held, pointing at basket mix rather than demand.`;
    confidence = 0.7;
    nextInvestigation = `Compare category mix and discount usage against the prior week.`;
  } else {
    rootCause = `${primary?.name ?? "No single driver"} accounts for most of the movement.`;
    confidence = 0.55;
    nextInvestigation = `Extend the comparison window to 28 days to separate noise from trend.`;
  }

  const narrative = [
    `Revenue on ${decomposition.latestDay} moved ${formatDelta(decomposition.revenueChangePct)} against the seven-day average.`,
    `Decomposing it: ${ranked.map((d) => `${d.name.toLowerCase()} ${formatDelta(d.changePct)}`).join(", ")}.`,
    rootCause,
    `Conversion is currently ${summary.conversionRate}% and average order value ${formatMoney(summary.aovPaise)}.`,
  ].join(" ");

  return { rootCause, confidence, ruledOut, nextInvestigation, narrative };
}

/** Orders lost to the excess failure rate, valued at the current AOV. */
function estimateRecoverablePaise(
  summary: BusinessSummary,
  channel: ChannelRow,
  baselineFailureRate: number,
): number {
  const excessRate = Math.max(0, channel.failureRate - baselineFailureRate) / 100;
  const lostOrders = channel.orders * excessRate;
  return Math.round(lostOrders * summary.aovPaise);
}
