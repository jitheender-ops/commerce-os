import { getStockoutRisks, getSupplierQuotes, listPurchaseOrders, listSuppliers } from "@/database/queries";
import { handle, ok, ready, searchParam } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    ready();
    const productId = searchParam(request, "productId");
    const risks = getStockoutRisks().filter((r) => r.risk === "HIGH" || r.risk === "CRITICAL");
    return ok({
      suppliers: listSuppliers(),
      purchaseOrders: listPurchaseOrders(30),
      risks,
      quotes: productId
        ? getSupplierQuotes(productId)
        : risks.slice(0, 3).flatMap((risk) =>
            getSupplierQuotes(risk.productId).map((quote) => ({ ...quote, sku: risk.sku })),
          ),
    });
  } catch (error) {
    return handle(error, "procurement");
  }
}
