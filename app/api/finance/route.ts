/**
 * Finance figures are plain arithmetic over the daily metrics — no model is
 * involved in producing any number on this route.
 */
import { getDailyMetrics } from "@/database/queries";
import { handle, ok, ready } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    ready();
    const metrics = getDailyMetrics(30);
    const sum = (pick: (m: (typeof metrics)[number]) => number) =>
      metrics.reduce((total, day) => total + pick(day), 0);

    const revenue = sum((m) => m.revenuePaise);
    const cogs = sum((m) => m.cogsPaise);
    const adSpend = sum((m) => m.adSpendPaise);
    const refunds = sum((m) => m.refundsPaise);
    const grossProfit = revenue - cogs;
    const netProfit = grossProfit - adSpend - refunds;

    return ok({
      period: { days: metrics.length, from: metrics[0]?.day, to: metrics.at(-1)?.day },
      totals: {
        revenuePaise: revenue,
        cogsPaise: cogs,
        grossProfitPaise: grossProfit,
        adSpendPaise: adSpend,
        refundsPaise: refunds,
        netProfitPaise: netProfit,
        grossMarginPercent: revenue ? Number(((grossProfit / revenue) * 100).toFixed(1)) : 0,
        netMarginPercent: revenue ? Number(((netProfit / revenue) * 100).toFixed(1)) : 0,
      },
      daily: metrics.map((day) => ({
        day: day.day,
        revenuePaise: day.revenuePaise,
        grossProfitPaise: day.revenuePaise - day.cogsPaise,
        netProfitPaise: day.revenuePaise - day.cogsPaise - day.adSpendPaise - day.refundsPaise,
      })),
      basis: "Computed from daily metrics. No AI involvement in any figure on this page.",
    });
  } catch (error) {
    return handle(error, "finance");
  }
}
