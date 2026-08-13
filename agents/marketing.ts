/**
 * Marketing Agent — budget efficiency.
 *
 * Campaigns are ranked by ROAS. Spend is moved from the worst performer to the
 * best, sized to the policy cap and to what the loser is actually spending.
 * No ad platform is contacted; every change is simulated and labelled.
 */
import { z } from "zod";
import { evidence, reason, recommendation, runAgent, toolCaller, type Agent, type AgentRunContext } from "./runtime";
import { AGENTS } from "./definitions";
import { POLICY_LIMITS } from "@/policies/rules";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import type { CampaignEfficiency } from "@/database/queries";
import type { AgentResult, Recommendation } from "@/types";

const Assessment = z.object({ summary: z.string(), narrative: z.string() });

const CAP = POLICY_LIMITS.marketing.maxDailyBudgetChangePaise;

export const marketingAgent: Agent = {
  id: "marketing",
  run: (ctx: AgentRunContext): Promise<AgentResult> =>
    runAgent("marketing", ctx, "Ranking campaigns by return on spend", async () => {
      const call = toolCaller("marketing", ctx);
      const campaigns = await call<CampaignEfficiency[]>("get_campaign_efficiency");

      const wasting = campaigns.filter((c) => c.verdict === "WASTING" && c.status === "ACTIVE");
      const best = campaigns.find((c) => c.verdict === "HIGH_PERFORMER" && c.status === "ACTIVE");
      const totalSpend = campaigns.reduce((s, c) => s + c.spendPaise, 0);
      const totalRevenue = campaigns.reduce((s, c) => s + c.revenuePaise, 0);
      const blendedRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;

      const recommendations: Recommendation[] = [];

      for (const campaign of wasting.slice(0, 2)) {
        recommendations.push(
          recommendation("marketing", {
            title: `Pause "${campaign.name}"`,
            rationale:
              `ROAS is ${campaign.roas} — it returns ${formatMoney(campaign.revenuePaise)} on ` +
              `${formatMoney(campaign.spendPaise)} of spend, losing money on every conversion. ` +
              `Pausing frees ${formatMoney(campaign.dailyBudgetPaise)} per day.`,
            tool: "pause_campaign",
            input: { campaignId: campaign.id, reason: `ROAS ${campaign.roas} is below break-even` },
            estimatedImpactPaise: campaign.dailyBudgetPaise,
            confidence: 0.85,
            risk: "LOW",
          }),
        );
      }

      // Move freed budget to the best performer, within the daily cap.
      if (best && wasting.length > 0) {
        const freed = wasting.reduce((s, c) => s + c.dailyBudgetPaise, 0);
        const delta = Math.min(freed, CAP);
        if (delta > 0) {
          recommendations.push(
            recommendation("marketing", {
              title: `Move ${formatMoney(delta)}/day to "${best.name}"`,
              rationale:
                `"${best.name}" returns ${best.roas}× on spend at a ${formatMoney(best.cacPaise)} acquisition cost. ` +
                `Reallocating the freed budget there is projected to return ${formatMoneyCompact(delta * best.roas)} ` +
                `per day at the campaign's current efficiency (ESTIMATED — assumes efficiency holds at higher spend).`,
              tool: "propose_budget_change",
              input: {
                campaignId: best.id,
                deltaPaise: delta,
                reason: `Reallocated from paused campaigns at ROAS ${best.roas}`,
              },
              estimatedImpactPaise: delta,
              confidence: 0.55,
              risk: "MEDIUM",
            }),
          );
        }
      }

      const observed = [
        evidence("Active campaigns", String(campaigns.filter((c) => c.status === "ACTIVE").length)),
        evidence("Blended ROAS", `${blendedRoas.toFixed(2)}×`, `${formatMoneyCompact(totalSpend)} spend`),
        evidence("Below break-even", String(wasting.length), wasting.map((c) => c.name).join(", ") || undefined),
        ...campaigns
          .slice(0, 3)
          .map((c) =>
            evidence(c.name, `${c.roas}× ROAS`, `CAC ${formatMoney(c.cacPaise)} · CTR ${c.ctr}%`),
          ),
        ...campaigns
          .slice(-2)
          .map((c) => evidence(c.name, `${c.roas}× ROAS`, `${formatMoneyCompact(c.spendPaise)} spent`)),
      ];

      const deterministic = {
        summary:
          wasting.length === 0
            ? `All active campaigns are returning above break-even.`
            : `${wasting.length} campaigns are spending below break-even; ${formatMoney(
                wasting.reduce((s, c) => s + c.dailyBudgetPaise, 0),
              )}/day can be reallocated.`,
        narrative: [
          `Blended return across ${campaigns.length} campaigns is ${blendedRoas.toFixed(2)}× on ${formatMoneyCompact(totalSpend)} of spend.`,
          wasting.length > 0
            ? `${wasting.map((c) => `"${c.name}" at ${c.roas}×`).join(" and ")} lose money on every conversion.`
            : `No campaign is below break-even.`,
          best ? `"${best.name}" is the strongest performer at ${best.roas}× and can absorb more budget.` : "",
        ]
          .filter(Boolean)
          .join(" "),
      };

      const { value, engine } = await reason({
        kind: "marketing.assessment",
        schema: Assessment,
        system: AGENTS.marketing.instructions,
        user: [
          `Campaign performance, best first:`,
          ...campaigns.map(
            (c) =>
              `- ${c.name} (${c.channel}, ${c.status}): ROAS ${c.roas}, spend ${c.spendPaise} paise, ` +
              `revenue ${c.revenuePaise} paise, CAC ${c.cacPaise} paise, CTR ${c.ctr}%, verdict ${c.verdict}`,
          ),
          ``,
          `Daily budget movement is capped at ${formatMoney(CAP)}.`,
          ``,
          `Summarise where money is being wasted and where it should go.`,
        ].join("\n"),
        fallback: () => deterministic,
      });

      return {
        headline: value.summary,
        observed,
        inference: campaigns
          .filter((c) => c.verdict === "WASTING" || c.verdict === "HIGH_PERFORMER")
          .map((c) => `${c.name}: ${c.roas}× ROAS → ${c.verdict.replace("_", " ").toLowerCase()}`),
        recommendations,
        narrative: value.narrative,
        engine,
      };
    }),
};
