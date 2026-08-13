import { getDb, num, str } from "@/database/db";
import { getBusinessSummary, listCustomers, listTickets } from "@/database/queries";
import { handle, intParam, ok, ready } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    ready();
    const summary = getBusinessSummary();
    const segments = getDb()
      .all(
        `SELECT segment, COUNT(*) AS n, COALESCE(SUM(ltv_paise), 0) AS ltv
           FROM customers GROUP BY segment`,
      )
      .map((row) => ({
        segment: str(row.segment),
        customers: num(row.n),
        totalLtvPaise: num(row.ltv),
        avgLtvPaise: num(row.n) > 0 ? Math.round(num(row.ltv) / num(row.n)) : 0,
      }));

    return ok({
      customers: listCustomers(intParam(request, "limit", 50)),
      segments,
      tickets: listTickets(),
      refundRatePercent:
        summary.revenuePaise === 0
          ? 0
          : Number(((summary.refundsPaise / summary.revenuePaise) * 100).toFixed(2)),
    });
  } catch (error) {
    return handle(error, "customers");
  }
}
