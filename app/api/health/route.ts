/**
 * Liveness probe, and the answer to "is my change actually deployed?".
 *
 * Deliberately outside the password gate: a platform health check that receives
 * a 401 reads the instance as dead and rolls the deployment back. It carries no
 * business detail for the same reason — a probe endpoint is the wrong place to
 * leak state.
 *
 * The commit is here because everything that would reveal which build is live
 * sits behind the gate, which makes a stale deployment impossible to diagnose
 * from outside. Render, Vercel and Fly all inject the commit under their own
 * name; whichever is present wins, and locally there is none.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const commit =
  process.env.RENDER_GIT_COMMIT ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.FLY_MACHINE_VERSION ??
  process.env.GIT_COMMIT ??
  null;

/** Fixed at module load, so it reports when this instance booted. */
const startedAt = new Date().toISOString();

export function GET() {
  return Response.json({
    status: "ok",
    commit: commit ? commit.slice(0, 7) : "local",
    startedAt,
  });
}
