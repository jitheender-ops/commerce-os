/**
 * Password gate tests.
 *
 * This is the only thing standing between a public URL and a stranger approving
 * a purchase order, so its failure modes are asserted rather than assumed —
 * especially the two that fail open: an unset password and a matcher that
 * accidentally exempts a route.
 */
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";

const PASSWORD = "hackathon2026";

const request = (path = "/", init?: RequestInit) =>
  new NextRequest(new Request(`http://localhost:3000${path}`, init));

const basic = (user: string, pass: string) => ({
  authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
});

/**
 * The matcher as a regex, anchored the way Next applies it. Unanchored,
 * `RegExp.test` scans every position and finds one where the negative lookahead
 * happens to pass, which reports every exempt path as guarded.
 */
const matches = (path: string) => new RegExp(`^${config.matcher[0]}$`).test(path);

describe("with no password configured", () => {
  it("lets everything through, so a laptop is unaffected", () => {
    vi.stubEnv("DEMO_PASSWORD", "");
    expect(proxy(request("/approvals")).status).toBe(200);
  });
});

describe("with a password configured", () => {
  it("refuses an anonymous request and asks the browser to prompt", () => {
    vi.stubEnv("DEMO_PASSWORD", PASSWORD);
    const response = proxy(request("/"));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Basic");
  });

  it("refuses a wrong password", () => {
    vi.stubEnv("DEMO_PASSWORD", PASSWORD);
    const response = proxy(request("/", { headers: basic("demo", "wrong") }));
    expect(response.status).toBe(401);
  });

  it("refuses a password that is merely a prefix of the real one", () => {
    vi.stubEnv("DEMO_PASSWORD", PASSWORD);
    const response = proxy(request("/", { headers: basic("demo", "hackathon") }));
    expect(response.status).toBe(401);
  });

  it("accepts the right password and issues a cookie the event stream can use", () => {
    vi.stubEnv("DEMO_PASSWORD", PASSWORD);
    const response = proxy(request("/", { headers: basic("demo", PASSWORD) }));

    expect(response.status).toBe(200);
    // EventSource sends no Authorization header, so without this the live feed
    // would 401 on a deployed instance while every other page worked.
    const cookie = response.cookies.get("commerce_os_access");
    expect(cookie?.value).toBe(PASSWORD);
    expect(cookie?.httpOnly).toBe(true);
  });

  it("accepts the cookie on later requests", () => {
    vi.stubEnv("DEMO_PASSWORD", PASSWORD);
    const response = proxy(
      request("/api/events/stream", { headers: { cookie: `commerce_os_access=${PASSWORD}` } }),
    );
    expect(response.status).toBe(200);
  });

  it("rejects a forged cookie", () => {
    vi.stubEnv("DEMO_PASSWORD", PASSWORD);
    const response = proxy(
      request("/", { headers: { cookie: "commerce_os_access=letmein" } }),
    );
    expect(response.status).toBe(401);
  });

  it("survives a malformed authorization header instead of throwing", () => {
    vi.stubEnv("DEMO_PASSWORD", PASSWORD);
    expect(proxy(request("/", { headers: { authorization: "Basic !!!not-base64" } })).status).toBe(401);
    expect(proxy(request("/", { headers: { authorization: "Bearer token" } })).status).toBe(401);
    expect(proxy(request("/", { headers: { authorization: "Basic" } })).status).toBe(401);
  });
});

describe("what the matcher covers", () => {
  it("guards every route that shows or changes business state", () => {
    for (const path of [
      "/",
      "/approvals",
      "/fulfillment",
      "/api/approvals",
      "/api/simulation/reset",
      "/api/events/stream",
    ]) {
      expect(matches(path), `${path} must be behind the gate`).toBe(true);
    }
  });

  it("leaves the health probe open so a deploy is not rolled back", () => {
    // A platform health check that receives a 401 reads the instance as dead.
    expect(matches("/api/health")).toBe(false);
    expect(matches("/_next/static/chunk.js")).toBe(false);
  });
});
