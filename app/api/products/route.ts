import { listInventory, listProducts } from "@/database/queries";
import { marginPct } from "@/lib/money";
import { handle, intParam, ok, ready } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    ready();
    const stock = new Map(listInventory().map((item) => [item.productId, item.onHand]));
    const products = listProducts(intParam(request, "limit", 50)).map((product) => ({
      ...product,
      onHand: stock.get(product.id) ?? 0,
      marginPercent: Number(marginPct(product.pricePaise, product.costPaise).toFixed(1)),
      competitorGapPercent: Number(
        (((product.pricePaise - product.competitorPricePaise) / product.competitorPricePaise) * 100).toFixed(1),
      ),
    }));
    return ok({ products });
  } catch (error) {
    return handle(error, "products");
  }
}
