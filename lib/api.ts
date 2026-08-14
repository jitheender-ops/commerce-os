/**
 * Route-handler helpers.
 *
 * Every API route runs on Node (the database is a Node builtin) and is
 * dynamic — this is an operations console, nothing here is prerenderable.
 */
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { ensureSeeded } from "@/simulation/seed";
import { startWorker } from "@/events/queue";
// Registers the fulfillment job handler as a side effect of import. Without it
// a queued fulfilment would have nothing to run it and would dead-letter.
import "@/integrations/fulfillment-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** First request on a fresh clone seeds the demo, so `npm run dev` is enough. */
export function ready(): void {
  ensureSeeded();
  // Idempotent and pinned to globalThis, so this is a no-op after the first call.
  startWorker();
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Parses and validates a JSON body, returning a typed value or a 400 response. */
export async function body<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<{ data: T; error: null } | { data: null; error: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { data: null, error: fail("Request body must be valid JSON") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      data: null,
      error: fail("Invalid request", 400, { issues: issues(parsed.error) }),
    };
  }
  return { data: parsed.data, error: null };
}

export function issues(error: ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
}

/** Turns a thrown error into a response the UI can render usefully. */
export function handle(error: unknown, context: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[api] ${context}:`, error);
  return fail(message, 500, { context });
}

export const searchParam = (request: Request, key: string): string | undefined =>
  new URL(request.url).searchParams.get(key) ?? undefined;

export function intParam(request: Request, key: string, fallback: number): number {
  const raw = searchParam(request, key);
  const value = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(value) ? value : fallback;
}
