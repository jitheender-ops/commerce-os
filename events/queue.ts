/**
 * Durable job queue.
 *
 * The event bus is fire-and-forget: a subscriber that throws loses the work. A
 * supplier call cannot be lost, so anything that reaches outside this process
 * goes through here instead — a row in `job_queue`, retried with exponential
 * backoff, dead-lettered after `MAX_ATTEMPTS` so one poisonous job never blocks
 * the ones behind it.
 *
 * The queue is a table rather than Redis on purpose. This is a single-process
 * application (see docs/architecture.md), so a broker would add an install, a
 * daemon and a second source of truth to gain nothing. Jobs survive a restart
 * because SQLite does.
 *
 * Failure classification lives with the handler, not here: throw
 * `PermanentJobError` for something a retry cannot fix (a rejected payload),
 * and anything else is treated as transient.
 */
import { getDb, toJson } from "@/database/db";
import { getBus } from "@/events/bus";
import { newId } from "@/lib/ids";
import type { JobStatus, QueuedJob } from "@/types";

/** Attempts before a job is dead-lettered. */
export const MAX_ATTEMPTS = 3;

/** First retry delay; each further attempt doubles it. */
const BASE_BACKOFF_MS = 2_000;

/** How often the background worker looks for due jobs. */
const POLL_MS = 500;

/** Thrown by a handler when retrying cannot help. Skips straight to the DLQ. */
export class PermanentJobError extends Error {}

export type JobHandler = (job: QueuedJob) => Promise<void> | void;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(kind: string, handler: JobHandler): void {
  handlers.set(kind, handler);
}

/**
 * Delay before attempt `n` (1-indexed): 2s, 4s, 8s …
 * Exported so the schedule is asserted in tests rather than described here.
 */
export const backoffMs = (attempts: number): number =>
  BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1);

export function enqueue(
  kind: string,
  payload: Record<string, unknown>,
  options: { correlationId?: string; delayMs?: number } = {},
): QueuedJob {
  const now = new Date().toISOString();
  const job: QueuedJob = {
    id: newId("job"),
    kind,
    payload,
    status: "READY",
    attempts: 0,
    lastError: null,
    runAfter: Date.now() + (options.delayMs ?? 0),
    correlationId: options.correlationId ?? newId("cor"),
    createdAt: now,
    updatedAt: now,
  };

  getDb().run(
    `INSERT INTO job_queue (id, kind, payload, status, attempts, last_error,
        run_after, correlation_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)`,
    job.id,
    job.kind,
    toJson(job.payload),
    job.status,
    job.runAfter,
    job.correlationId,
    job.createdAt,
    job.updatedAt,
  );
  return job;
}

/**
 * Runs every job that is due, once each. Returns how many were attempted.
 *
 * Callable directly, which is how the tests drive it — no timers, no sleeping,
 * no flakiness.
 */
export async function runDueJobs(limit = 10): Promise<number> {
  const due = claimDue(limit);
  for (const job of due) await runJob(job);
  return due.length;
}

async function runJob(job: QueuedJob): Promise<void> {
  const handler = handlers.get(job.kind);
  if (!handler) {
    // A job nobody handles is a wiring mistake, not a transient fault. Failing
    // it fast surfaces the mistake instead of retrying it three times.
    deadLetter(job, `No handler registered for job kind "${job.kind}"`);
    return;
  }

  try {
    await handler(job);
    finish(job.id, "DONE");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof PermanentJobError || job.attempts >= MAX_ATTEMPTS) {
      deadLetter(job, message);
      return;
    }

    const delay = backoffMs(job.attempts);
    getDb().run(
      `UPDATE job_queue SET status = 'READY', last_error = ?, run_after = ?, updated_at = ?
       WHERE id = ?`,
      message,
      Date.now() + delay,
      new Date().toISOString(),
      job.id,
    );
    getBus().publish(
      "FULFILLMENT_FAILED",
      {
        jobId: job.id,
        kind: job.kind,
        attempt: job.attempts,
        retryInMs: delay,
        error: message,
      },
      { source: "queue", correlationId: job.correlationId },
    );
  }
}

/**
 * Marks jobs RUNNING and returns them. The status flip is what stops the next
 * poll picking up a job still in flight — with one process and synchronous
 * SQLite that is sufficient; a second worker would need a claim token.
 */
function claimDue(limit: number): QueuedJob[] {
  const db = getDb();
  return db.transaction(() => {
    const rows = db.all<JobRow>(
      `SELECT * FROM job_queue
       WHERE status = 'READY' AND run_after <= ?
       ORDER BY run_after, rowid
       LIMIT ?`,
      Date.now(),
      limit,
    );
    for (const row of rows) {
      db.run(
        `UPDATE job_queue SET status = 'RUNNING', attempts = attempts + 1, updated_at = ?
         WHERE id = ?`,
        new Date().toISOString(),
        row.id,
      );
    }
    // attempts was just incremented; report the value the handler is running as.
    return rows.map((row) => mapJob({ ...row, attempts: row.attempts + 1 }));
  });
}

function finish(id: string, status: JobStatus): void {
  getDb().run(
    `UPDATE job_queue SET status = ?, updated_at = ? WHERE id = ?`,
    status,
    new Date().toISOString(),
    id,
  );
}

function deadLetter(job: QueuedJob, message: string): void {
  getDb().run(
    `UPDATE job_queue SET status = 'DEAD', last_error = ?, updated_at = ? WHERE id = ?`,
    message,
    new Date().toISOString(),
    job.id,
  );
  getBus().publish(
    "FULFILLMENT_DEAD_LETTERED",
    { jobId: job.id, kind: job.kind, attempts: job.attempts, error: message },
    { source: "queue", correlationId: job.correlationId },
  );
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export function listJobs(status?: JobStatus, limit = 50): QueuedJob[] {
  const rows = status
    ? getDb().all<JobRow>(
        `SELECT * FROM job_queue WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
        status,
        limit,
      )
    : getDb().all<JobRow>(`SELECT * FROM job_queue ORDER BY created_at DESC LIMIT ?`, limit);
  return rows.map(mapJob);
}

export const listDeadLetters = (limit = 50): QueuedJob[] => listJobs("DEAD", limit);

/** Puts a dead-lettered job back at the front of the queue with a clean slate. */
export function retryJob(id: string): boolean {
  const changed = getDb().run(
    `UPDATE job_queue SET status = 'READY', attempts = 0, last_error = NULL,
        run_after = ?, updated_at = ?
     WHERE id = ? AND status = 'DEAD'`,
    Date.now(),
    new Date().toISOString(),
    id,
  );
  return changed.changes > 0;
}

// ─── Background worker ───────────────────────────────────────────────────────

const globalRef = globalThis as unknown as { __commerceWorker?: NodeJS.Timeout };

/**
 * Starts the poller. Idempotent, and pinned to `globalThis` because Next
 * recompiles modules on every edit in development — without the pin each edit
 * would leave another worker behind, and the jobs would run twice.
 */
export function startWorker(): void {
  if (globalRef.__commerceWorker) return;
  // ponytail: a poll loop, not a notify/wake. At 500ms the demo looks live and
  // the query is one indexed lookup; swap for a signal if the table ever grows.
  const timer = setInterval(() => {
    void runDueJobs().catch((error) => console.error("[queue] worker failed:", error));
  }, POLL_MS);
  timer.unref?.();
  globalRef.__commerceWorker = timer;
}

export function stopWorker(): void {
  if (!globalRef.__commerceWorker) return;
  clearInterval(globalRef.__commerceWorker);
  globalRef.__commerceWorker = undefined;
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

type JobRow = {
  id: string;
  kind: string;
  payload: string;
  status: string;
  attempts: number;
  last_error: string | null;
  run_after: number;
  correlation_id: string;
  created_at: string;
  updated_at: string;
};

const mapJob = (row: JobRow): QueuedJob => ({
  id: row.id,
  kind: row.kind,
  payload: JSON.parse(row.payload) as Record<string, unknown>,
  status: row.status as JobStatus,
  attempts: Number(row.attempts),
  lastError: row.last_error,
  runAfter: Number(row.run_after),
  correlationId: row.correlation_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
