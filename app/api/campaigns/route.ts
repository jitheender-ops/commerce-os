import { getCampaignEfficiency } from "@/database/queries";
import { handle, ok, ready } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    ready();
    const campaigns = getCampaignEfficiency();
    const spend = campaigns.reduce((sum, c) => sum + c.spendPaise, 0);
    const revenue = campaigns.reduce((sum, c) => sum + c.revenuePaise, 0);
    return ok({
      campaigns,
      totals: {
        spendPaise: spend,
        revenuePaise: revenue,
        blendedRoas: spend > 0 ? Number((revenue / spend).toFixed(2)) : 0,
        wasting: campaigns.filter((c) => c.verdict === "WASTING").length,
      },
    });
  } catch (error) {
    return handle(error, "campaigns");
  }
}
