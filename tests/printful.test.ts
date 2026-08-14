/**
 * Printful client tests.
 *
 * `fetch` is stubbed throughout: the test suite must never touch a vendor, and
 * the failure modes worth proving — a timeout, a rate limit, a rejected payload —
 * are ones you cannot reliably provoke against a live API anyway.
 *
 * The load-bearing claim is the first test: this client cannot charge anyone.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrintfulSupplier, RateLimitError, printfulFromEnv } from "@/integrations/printful";
import { PermanentJobError } from "@/events/queue";

const config = {
  token: "test-token",
  variantId: 4011,
  recipient: {
    name: "Operations",
    address1: "19749 Dearborn St",
    city: "Chatsworth",
    countryCode: "US",
    stateCode: "CA",
    zip: "91311",
  },
};

const supplier = () => new PrintfulSupplier(config);
const request = { orderId: "ord_02101", items: [{ sku: "SKU-1040", quantity: 2 }] };

/** Replaces global fetch and hands back the recorded calls. */
function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return impl(url, init);
  });
  return calls;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("nothing is ever charged", () => {
  it("creates a draft and never asks Printful to confirm it", async () => {
    const calls = stubFetch(() => json({ data: { id: 987654, status: "draft" } }));

    const result = await supplier().createOrder(request);

    expect(result.externalId).toBe("987654");
    expect(result.simulated).toBe(false);

    // One call, to the create endpoint, and nothing resembling confirmation.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.printful.com/v2/orders");
    expect(calls[0].url).not.toMatch(/confirm/i);

    const body = JSON.parse(String(calls[0].init.body));
    expect(body.confirm).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/confirm/i);
  });

  it("sends the configured operator address, never a customer's details", async () => {
    const calls = stubFetch(() => json({ data: { id: 1, status: "draft" } }));

    await supplier().createOrder(request);
    const body = JSON.parse(String(calls[0].init.body));

    expect(body.recipient.name).toBe("Operations");
    expect(body.recipient.country_code).toBe("US");
    // The request type carries no customer at all, so none can leak.
    expect(JSON.stringify(body)).not.toContain("customer");
  });
});

describe("the request", () => {
  it("authenticates with a bearer token and omits the store header when unset", async () => {
    const calls = stubFetch(() => json({ data: { id: 1, status: "draft" } }));

    await supplier().createOrder(request);
    const headers = calls[0].init.headers as Record<string, string>;

    expect(headers.authorization).toBe("Bearer test-token");
    expect(headers["x-pf-store-id"]).toBeUndefined();
  });

  it("sends the store header for an account-level token", async () => {
    const calls = stubFetch(() => json({ data: { id: 1, status: "draft" } }));

    await new PrintfulSupplier({ ...config, storeId: "42" }).createOrder(request);

    expect((calls[0].init.headers as Record<string, string>)["x-pf-store-id"]).toBe("42");
  });

  it("maps each line to the configured catalog variant", async () => {
    const calls = stubFetch(() => json({ data: { id: 1, status: "draft" } }));

    await supplier().createOrder({
      orderId: "ord_1",
      items: [
        { sku: "A", quantity: 2 },
        { sku: "B", quantity: 1 },
      ],
    });
    const body = JSON.parse(String(calls[0].init.body));

    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({ source: "catalog", catalog_variant_id: 4011, quantity: 2 });
    expect(body.external_id).toBe("ord_1");
  });

  it("gives up on a hung vendor instead of holding the queue slot", async () => {
    stubFetch(() => Promise.reject(new DOMException("The operation timed out", "TimeoutError")));

    await expect(supplier().createOrder(request)).rejects.toThrow(/unreachable/);
  });
});

describe("failure classification", () => {
  it("honours Printful's retry-after on a rate limit", async () => {
    stubFetch(() => new Response("", { status: 429, headers: { "retry-after": "30" } }));

    const error = await supplier()
      .createOrder(request)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitError);
    // The queue reads this and waits exactly as long as it was asked to.
    expect((error as RateLimitError).retryAfterMs).toBe(30_000);
  });

  it("falls back to a minute when the rate limit carries no retry-after", async () => {
    stubFetch(() => new Response("", { status: 429 }));

    const error = (await supplier()
      .createOrder(request)
      .catch((e: unknown) => e)) as RateLimitError;

    expect(error.retryAfterMs).toBe(60_000);
  });

  it("dead-letters a rejected order rather than sending it again", async () => {
    stubFetch(() => new Response("bad variant id", { status: 400 }));

    // 4xx means the request itself is wrong; retrying sends the same wrong one.
    await expect(supplier().createOrder(request)).rejects.toBeInstanceOf(PermanentJobError);
  });

  it("retries a vendor outage", async () => {
    stubFetch(() => new Response("upstream unavailable", { status: 503 }));

    const error = await supplier()
      .createOrder(request)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentJobError);
  });

  it("treats an unreadable success as permanent", async () => {
    stubFetch(() => json({ unexpected: true }));

    await expect(supplier().createOrder(request)).rejects.toBeInstanceOf(PermanentJobError);
  });
});

describe("configuration", () => {
  it("stays simulated unless every required value is present", () => {
    vi.stubEnv("PRINTFUL_TOKEN", "token");
    vi.stubEnv("PRINTFUL_VARIANT_ID", "4011");
    // Recipient deliberately incomplete.
    expect(printfulFromEnv()).toBeNull();
  });

  it("builds the supplier when the configuration is complete", () => {
    vi.stubEnv("PRINTFUL_TOKEN", "token");
    vi.stubEnv("PRINTFUL_VARIANT_ID", "4011");
    vi.stubEnv("PRINTFUL_RECIPIENT_NAME", "Operations");
    vi.stubEnv("PRINTFUL_RECIPIENT_ADDRESS1", "19749 Dearborn St");
    vi.stubEnv("PRINTFUL_RECIPIENT_CITY", "Chatsworth");
    vi.stubEnv("PRINTFUL_RECIPIENT_COUNTRY", "US");
    vi.stubEnv("PRINTFUL_RECIPIENT_ZIP", "91311");

    const built = printfulFromEnv();
    expect(built).toBeInstanceOf(PrintfulSupplier);
    expect(built!.live).toBe(true);
    expect(built!.label).toContain("draft");
  });
});
