/**
 * Queue tests.
 *
 * The promise this queue makes is that work reaching outside the process is not
 * lost and not retried forever, and that one poisonous job cannot block the ones
 * behind it. Each of those is asserted here rather than described in a comment.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  backoffMs,
  enqueue,
  listDeadLetters,
  listJobs,
  MAX_ATTEMPTS,
  PermanentJobError,
  registerJobHandler,
  retryJob,
  runDueJobs,
} from "@/events/queue";
import { getDb } from "@/database/db";
import { seedDemo } from "@/simulation/seed";

beforeAll(() => {
  seedDemo();
});

beforeEach(() => {
  getDb().run(`DELETE FROM job_queue`);
});

/** Makes a job due now regardless of the backoff it was given. */
const makeDue = (id: string) =>
  getDb().run(`UPDATE job_queue SET run_after = ? WHERE id = ?`, Date.now() - 1, id);

describe("backoff", () => {
  it("doubles the delay per attempt", () => {
    expect(backoffMs(1)).toBe(2_000);
    expect(backoffMs(2)).toBe(4_000);
    expect(backoffMs(3)).toBe(8_000);
  });
});

describe("processing", () => {
  it("runs a job once and marks it done", async () => {
    let runs = 0;
    registerJobHandler("test.ok", () => {
      runs++;
    });

    const job = enqueue("test.ok", { hello: "world" });
    await runDueJobs();
    await runDueJobs(); // A completed job must not run again.

    expect(runs).toBe(1);
    expect(listJobs().find((j) => j.id === job.id)?.status).toBe("DONE");
  });

  it("does not run a job before its delay elapses", async () => {
    let runs = 0;
    registerJobHandler("test.delayed", () => {
      runs++;
    });

    enqueue("test.delayed", {}, { delayMs: 60_000 });
    await runDueJobs();

    expect(runs).toBe(0);
  });

  it("hands the handler its payload", async () => {
    const seen: unknown[] = [];
    registerJobHandler("test.payload", (job) => {
      seen.push(job.payload);
    });

    enqueue("test.payload", { orderId: "ord_1", nested: { n: 2 } });
    await runDueJobs();

    expect(seen).toEqual([{ orderId: "ord_1", nested: { n: 2 } }]);
  });
});

describe("retry and the dead letter queue", () => {
  it("retries a transient failure and dead-letters after the limit", async () => {
    let attempts = 0;
    registerJobHandler("test.always-fails", () => {
      attempts++;
      throw new Error("supplier timed out");
    });

    const job = enqueue("test.always-fails", {});
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      makeDue(job.id);
      await runDueJobs();
    }

    expect(attempts).toBe(MAX_ATTEMPTS);

    const dead = listDeadLetters();
    expect(dead.map((j) => j.id)).toContain(job.id);
    expect(dead[0].lastError).toBe("supplier timed out");

    // Dead is terminal: further polls must not pick it up again.
    makeDue(job.id);
    await runDueJobs();
    expect(attempts).toBe(MAX_ATTEMPTS);
  });

  it("dead-letters a permanent failure on the first attempt", async () => {
    let attempts = 0;
    registerJobHandler("test.permanent", () => {
      attempts++;
      throw new PermanentJobError("order has no line items");
    });

    const job = enqueue("test.permanent", {});
    await runDueJobs();

    expect(attempts).toBe(1);
    expect(listJobs().find((j) => j.id === job.id)?.status).toBe("DEAD");
  });

  it("dead-letters a job nobody handles instead of retrying a wiring mistake", async () => {
    const job = enqueue("test.no-such-handler", {});
    await runDueJobs();

    const stored = listJobs().find((j) => j.id === job.id)!;
    expect(stored.status).toBe("DEAD");
    expect(stored.lastError).toContain("No handler registered");
  });

  it("lets healthy jobs through while a poisonous one is failing", async () => {
    let healthy = 0;
    registerJobHandler("test.poison", () => {
      throw new Error("still broken");
    });
    registerJobHandler("test.healthy", () => {
      healthy++;
    });

    enqueue("test.poison", {});
    enqueue("test.healthy", {});
    await runDueJobs();

    // The poisoned job is off waiting on its backoff; the queue kept moving.
    expect(healthy).toBe(1);
  });

  it("puts a dead-lettered job back with a clean slate", async () => {
    let succeedNow = false;
    let attempts = 0;
    registerJobHandler("test.recovers", () => {
      attempts++;
      if (!succeedNow) throw new Error("supplier down");
    });

    const job = enqueue("test.recovers", {});
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      makeDue(job.id);
      await runDueJobs();
    }
    expect(listJobs().find((j) => j.id === job.id)?.status).toBe("DEAD");

    succeedNow = true;
    expect(retryJob(job.id)).toBe(true);
    await runDueJobs();

    const recovered = listJobs().find((j) => j.id === job.id)!;
    expect(recovered.status).toBe("DONE");
    expect(recovered.attempts).toBe(1);
    expect(attempts).toBe(MAX_ATTEMPTS + 1);
  });
});
