/**
 * Points every test run at a throwaway database file.
 *
 * `node:sqlite` in-memory databases cannot be shared across the module graph
 * here (the connection is a module singleton), so each worker gets its own
 * file under the OS temp directory and deletes it when the run ends.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "commerce-os-test-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
process.env.AI_PROVIDER = "deterministic";

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
