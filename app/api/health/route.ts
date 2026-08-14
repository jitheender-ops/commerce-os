/**
 * Liveness probe for the host's health check.
 *
 * Deliberately outside the password gate and deliberately empty of business
 * detail: a platform that gets a 401 here treats the deployment as failed and
 * rolls it back, and a probe endpoint is the wrong place to leak state.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" });
}
