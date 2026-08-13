/**
 * Database adapter.
 *
 * One implementation ships: SQLite through Node's built-in `node:sqlite`.
 * `DatabaseAdapter` is the seam a hosted Postgres/Supabase adapter would
 * implement later — see docs/architecture.md. It is deliberately narrow
 * (query / mutate / transaction) so a remote adapter is a small surface.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { RESET_ORDER, SCHEMA } from "./schema";

export type Row = Record<string, unknown>;
export type Param = string | number | null | Uint8Array;

export interface DatabaseAdapter {
  all<T = Row>(sql: string, ...params: Param[]): T[];
  get<T = Row>(sql: string, ...params: Param[]): T | undefined;
  run(sql: string, ...params: Param[]): { changes: number };
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
}

class SqliteAdapter implements DatabaseAdapter {
  constructor(private readonly db: DatabaseSync) {}

  all<T = Row>(sql: string, ...params: Param[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  get<T = Row>(sql: string, ...params: Param[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: Param[]): { changes: number } {
    const result = this.db.prepare(sql).run(...params);
    return { changes: Number(result.changes) };
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  /** Nested calls join the outer transaction rather than failing. */
  transaction<T>(fn: () => T): T {
    if (depth > 0) return fn();
    depth++;
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      depth--;
    }
  }
}

let depth = 0;

const DB_PATH =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "commerce.db");

/**
 * The connection is pinned to globalThis. Next.js recompiles modules on every
 * edit in dev; without this the app would open a new handle per compile and the
 * in-memory event bus would fork alongside it.
 */
const globalRef = globalThis as unknown as {
  __commerceDb?: SqliteAdapter;
};

export function getDb(): DatabaseAdapter {
  if (!globalRef.__commerceDb) {
    if (DB_PATH !== ":memory:") mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const raw = new DatabaseSync(DB_PATH);
    raw.exec("PRAGMA journal_mode = WAL;");
    raw.exec("PRAGMA foreign_keys = ON;");
    raw.exec(SCHEMA);
    globalRef.__commerceDb = new SqliteAdapter(raw);
  }
  return globalRef.__commerceDb;
}

/** Creates an isolated in-memory database. Used by tests. */
export function createMemoryDb(): DatabaseAdapter {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  raw.exec(SCHEMA);
  return new SqliteAdapter(raw);
}

export function truncateAll(db: DatabaseAdapter): void {
  db.exec("PRAGMA foreign_keys = OFF;");
  for (const table of RESET_ORDER) db.run(`DELETE FROM ${table}`);
  db.exec("PRAGMA foreign_keys = ON;");
}

// ─── Small helpers used across the data layer ────────────────────────────────

export const toJson = (value: unknown): string => JSON.stringify(value ?? null);

export function fromJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const bool = (value: unknown): boolean => value === 1 || value === true;

export function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}
