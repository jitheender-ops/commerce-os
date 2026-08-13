import { randomUUID } from "node:crypto";

/** Short, prefixed, sortable-enough identifier: `evt_lz4k1c_8f2a`. */
export function newId(prefix: string): string {
  const time = Date.now().toString(36);
  const rand = randomUUID().replace(/-/g, "").slice(0, 4);
  return `${prefix}_${time}_${rand}`;
}

/** Correlation id tying one trigger to every downstream task, tool call and audit row. */
export const newCorrelationId = (): string => newId("cor");
