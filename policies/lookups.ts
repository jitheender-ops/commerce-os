/**
 * The narrow data surface the governance layer is allowed to read.
 *
 * Governance sits above tools, so it must not import the tool registry (that
 * would be a cycle). It reads the few facts it needs directly, through this
 * file, which keeps the dependency explicit and easy to stub in tests.
 */
export { getProduct, getAgentBudget, getSupplierQuotes } from "@/database/queries";
import { getProduct } from "@/database/queries";
import { marginPct } from "@/lib/money";

/** Gross margin percentage a product would have at a hypothetical price. */
export function marginOf(productId: string, pricePaise?: number): number {
  const product = getProduct(productId);
  if (!product) return 0;
  return marginPct(pricePaise ?? product.pricePaise, product.costPaise);
}
