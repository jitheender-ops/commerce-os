/**
 * Printful supplier — the live implementation of `SupplierGateway`.
 *
 * **Draft orders only, and that is enforced here rather than trusted.** Printful
 * creates orders in draft by default, and its documentation is explicit that
 * "orders with the draft status won't be charged, and they won't be picked up by
 * our fulfillment facilities". Confirming a draft is a separate API call that
 * this file deliberately does not implement — there is no code path from an
 * agent to a garment being printed or a card being charged.
 *
 * There is no Printful sandbox. Draft orders in the live account are the honest
 * equivalent, which is why the guarantee above is a property of the code and not
 * of a test endpoint.
 *
 * Rate limits are Printful's documented 120 requests per 60s leaky bucket. A 429
 * carries `retry-after`, and that value is honoured rather than guessed at.
 *
 * https://developers.printful.com/docs/v2-beta/
 */
import { z } from "zod";
import { PermanentJobError } from "@/events/queue";
import type { SupplierGateway, SupplierOrderRequest, SupplierOrderResult } from "./supplier";

const BASE_URL = "https://api.printful.com";
const TIMEOUT_MS = 10_000;

export interface PrintfulConfig {
  token: string;
  /** Only needed for an account-level token; a store token is already bound. */
  storeId?: string;
  /** Catalog variant every demo SKU maps to — see the note in createOrder. */
  variantId: number;
  /** Fixed operator address. Never a customer's: see the PII note below. */
  recipient: {
    name: string;
    address1: string;
    city: string;
    countryCode: string;
    stateCode?: string;
    zip: string;
  };
  /** Artwork URL for print placements, when the variant requires one. */
  placementUrl?: string;
}

/** Thrown on 429 so the queue can wait exactly as long as Printful asked. */
export class RateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`Printful rate limit reached; retry in ${Math.ceil(retryAfterMs / 1000)}s`);
  }
}

/** Only the fields we actually use; Printful returns a great deal more. */
const OrderResponse = z.object({
  data: z.object({
    id: z.union([z.number(), z.string()]),
    status: z.string(),
  }),
});

export class PrintfulSupplier implements SupplierGateway {
  readonly live = true;
  readonly label = "Printful (draft orders)";

  constructor(private readonly config: PrintfulConfig) {}

  async createOrder(request: SupplierOrderRequest): Promise<SupplierOrderResult> {
    // Two deliberate simplifications, both visible in the UI rather than hidden:
    //
    // 1. Every seeded SKU maps to one configured catalog variant. This shop's
    //    catalogue is generated and has no Printful equivalent; inventing a
    //    mapping would be a fake dressed as an integration.
    // 2. The recipient is a fixed operator-supplied address, never the
    //    customer's. Sending a real name and address to a third party is
    //    exactly the PII flow SEC-001 exists to prevent, and a demo has no
    //    business doing it.
    const body = {
      recipient: {
        name: this.config.recipient.name,
        address1: this.config.recipient.address1,
        city: this.config.recipient.city,
        country_code: this.config.recipient.countryCode,
        ...(this.config.recipient.stateCode && { state_code: this.config.recipient.stateCode }),
        zip: this.config.recipient.zip,
      },
      items: request.items.map((item) => ({
        source: "catalog",
        catalog_variant_id: this.config.variantId,
        quantity: item.quantity,
        ...(this.config.placementUrl && {
          placements: [
            {
              placement: "front",
              technique: "dtg",
              layers: [{ type: "file", url: this.config.placementUrl }],
            },
          ],
        }),
      })),
      external_id: request.orderId,
    };

    const response = await this.post("/v2/orders", body);
    const parsed = OrderResponse.safeParse(response);
    if (!parsed.success) {
      // A response we cannot read is not something a retry fixes.
      throw new PermanentJobError(`Printful returned an unrecognised order payload`);
    }

    return {
      externalId: String(parsed.data.data.id),
      status: "SUBMITTED",
      trackingUrl: null,
      simulated: false,
    };
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.token}`,
          "content-type": "application/json",
          ...(this.config.storeId && { "x-pf-store-id": this.config.storeId }),
        },
        body: JSON.stringify(body),
        // Without this a hung vendor holds a queue slot indefinitely.
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // Network failure or timeout — transient by definition, so it retries.
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Printful unreachable: ${reason}`);
    }

    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after") ?? 0);
      throw new RateLimitError(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000);
    }

    if (!response.ok) {
      const detail = await safeText(response);
      // 4xx is our mistake — a bad variant, a rejected address, an expired
      // token. Retrying sends the same wrong request again, so it goes
      // straight to the dead letter queue where a human will see it.
      if (response.status < 500) {
        throw new PermanentJobError(`Printful rejected the order (${response.status}): ${detail}`);
      }
      throw new Error(`Printful error ${response.status}: ${detail}`);
    }

    return response.json();
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "(no response body)";
  }
}

/** Builds the supplier from the environment, or null when it is not configured. */
export function printfulFromEnv(): PrintfulSupplier | null {
  const token = process.env.PRINTFUL_TOKEN?.trim();
  const variantId = Number(process.env.PRINTFUL_VARIANT_ID?.trim());
  const name = process.env.PRINTFUL_RECIPIENT_NAME?.trim();
  const address1 = process.env.PRINTFUL_RECIPIENT_ADDRESS1?.trim();
  const city = process.env.PRINTFUL_RECIPIENT_CITY?.trim();
  const countryCode = process.env.PRINTFUL_RECIPIENT_COUNTRY?.trim();
  const zip = process.env.PRINTFUL_RECIPIENT_ZIP?.trim();

  // All or nothing. A half-configured supplier that fails on every order is
  // worse than an honestly simulated one.
  if (!token || !variantId || !name || !address1 || !city || !countryCode || !zip) return null;

  return new PrintfulSupplier({
    token,
    storeId: process.env.PRINTFUL_STORE_ID?.trim() || undefined,
    variantId,
    recipient: {
      name,
      address1,
      city,
      countryCode,
      stateCode: process.env.PRINTFUL_RECIPIENT_STATE?.trim() || undefined,
      zip,
    },
    placementUrl: process.env.PRINTFUL_PLACEMENT_URL?.trim() || undefined,
  });
}
