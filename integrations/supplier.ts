/**
 * Supplier gateway.
 *
 * The seam a live dropshipping vendor plugs into. It follows the same shape as
 * `ai/gateway.ts`: one interface, a deterministic implementation that always
 * works offline, and an optional live one that is used only when its credentials
 * are present. The UI reads `describeSupplier()` and states which is active, so
 * nothing on screen ever implies a real order was placed when it wasn't.
 *
 * `SimulatedSupplier` ships today. `PrintfulSupplier` (Phase 2) implements the
 * same three methods and changes nothing above this file.
 */
import { newId } from "@/lib/ids";

/**
 * No recipient here yet, deliberately. A live vendor needs a name and address,
 * which is customer PII — a permission this system grants to no agent (SEC-001).
 * Phase 2 has to answer that question explicitly rather than inherit a field
 * that quietly started carrying personal data.
 */
export interface SupplierOrderRequest {
  orderId: string;
  items: { sku: string; quantity: number }[];
}

export interface SupplierOrderResult {
  externalId: string;
  status: "SUBMITTED" | "SHIPPED";
  trackingUrl: string | null;
  /** False only when a real vendor accepted the order. */
  simulated: boolean;
}

export interface SupplierGateway {
  readonly label: string;
  readonly live: boolean;
  createOrder(request: SupplierOrderRequest): Promise<SupplierOrderResult>;
}

/**
 * Deterministic supplier. Accepts every well-formed order and mints a
 * `SUP_DEMO_*` identifier — the same convention `recordRefund` uses for
 * payments, so a demo identifier is recognisable as one at a glance.
 */
class SimulatedSupplier implements SupplierGateway {
  readonly label = "Simulated supplier";
  readonly live = false;

  async createOrder(request: SupplierOrderRequest): Promise<SupplierOrderResult> {
    if (request.items.length === 0) {
      throw new Error("A fulfilment must contain at least one item");
    }
    return {
      externalId: `SUP_DEMO_${newId("f").split("_")[1]}`,
      status: "SUBMITTED",
      trackingUrl: null,
      simulated: true,
    };
  }
}

const globalRef = globalThis as unknown as { __commerceSupplier?: SupplierGateway };

export function getSupplier(): SupplierGateway {
  globalRef.__commerceSupplier ??= new SimulatedSupplier();
  return globalRef.__commerceSupplier;
}

/** Test seam, and how Phase 2 will install the Printful client. */
export function setSupplier(gateway: SupplierGateway | null): void {
  globalRef.__commerceSupplier = gateway ?? undefined;
}

export function describeSupplier(): { label: string; live: boolean; detail: string } {
  const supplier = getSupplier();
  return {
    label: supplier.label,
    live: supplier.live,
    detail: supplier.live
      ? "Orders are submitted to a real supplier API. Identifiers come from the vendor."
      : "No supplier credentials configured. Orders are recorded locally and identified as SUP_DEMO_*; nothing is sent anywhere.",
  };
}
