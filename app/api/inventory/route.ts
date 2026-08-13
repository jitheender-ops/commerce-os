import { getStockoutRisks, listInventory, listPurchaseOrders } from "@/database/queries";
import { handle, ok, ready } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    ready();
    const risks = getStockoutRisks();
    return ok({
      risks,
      items: listInventory(),
      purchaseOrders: listPurchaseOrders(20),
      counts: risks.reduce<Record<string, number>>((acc, risk) => {
        acc[risk.risk] = (acc[risk.risk] ?? 0) + 1;
        return acc;
      }, {}),
    });
  } catch (error) {
    return handle(error, "inventory");
  }
}
