import { getChannelBreakdown, listOrders } from "@/database/queries";
import { handle, intParam, ok, ready } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    ready();
    return ok({
      orders: listOrders(intParam(request, "limit", 50)),
      channels: getChannelBreakdown(7),
    });
  } catch (error) {
    return handle(error, "orders");
  }
}
