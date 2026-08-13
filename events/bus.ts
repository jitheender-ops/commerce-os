/**
 * Event bus.
 *
 * `EventBus` is the interface a Redis/NATS-backed bus would implement for a
 * multi-process deployment. This application is a single-process modular
 * monolith, so the shipped implementation is in-process: no broker to run, no
 * cost, and ordering is trivially guaranteed.
 *
 * Every published event is persisted to `events` before subscribers run, so the
 * event log survives a restart and the UI can replay history.
 */
import { getDb, toJson } from "@/database/db";
import type { BusinessEvent, EventHandler, EventType } from "@/types";
import { newId } from "@/lib/ids";

export interface EventBus {
  publish<P extends Record<string, unknown>>(
    type: EventType,
    payload: P,
    options?: { source?: string; correlationId?: string; persist?: boolean },
  ): BusinessEvent<P>;
  subscribe(types: EventType[] | "*", handler: EventHandler): () => void;
  recent(limit?: number): BusinessEvent[];
}

type Subscription = { types: Set<EventType> | "*"; handler: EventHandler };

class InMemoryEventBus implements EventBus {
  private subscriptions = new Set<Subscription>();

  publish<P extends Record<string, unknown>>(
    type: EventType,
    payload: P,
    options: { source?: string; correlationId?: string; persist?: boolean } = {},
  ): BusinessEvent<P> {
    const event: BusinessEvent<P> = {
      id: newId("evt"),
      type,
      payload,
      source: options.source ?? "system",
      correlationId: options.correlationId ?? newId("cor"),
      createdAt: new Date().toISOString(),
    };

    // Lifecycle chatter (agent status, tool calls) is high volume and already
    // captured in the audit log, so it streams to the UI without being stored.
    if (options.persist !== false && !EPHEMERAL.has(type)) {
      getDb().run(
        `INSERT INTO events (id, type, payload, source, correlation_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        event.id,
        event.type,
        toJson(event.payload),
        event.source,
        event.correlationId,
        event.createdAt,
      );
    }

    for (const sub of this.subscriptions) {
      if (sub.types !== "*" && !sub.types.has(type)) continue;
      try {
        const result = sub.handler(event as BusinessEvent);
        // A failing subscriber must never break the publisher.
        if (result instanceof Promise) result.catch(reportHandlerError);
      } catch (error) {
        reportHandlerError(error);
      }
    }
    return event;
  }

  subscribe(types: EventType[] | "*", handler: EventHandler): () => void {
    const sub: Subscription = {
      types: types === "*" ? "*" : new Set(types),
      handler,
    };
    this.subscriptions.add(sub);
    return () => this.subscriptions.delete(sub);
  }

  recent(limit = 100): BusinessEvent[] {
    const rows = getDb().all<{
      id: string;
      type: string;
      payload: string;
      source: string;
      correlation_id: string;
      created_at: string;
    }>(`SELECT * FROM events ORDER BY created_at DESC, rowid DESC LIMIT ?`, limit);
    return rows.map((row) => ({
      id: row.id,
      type: row.type as EventType,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      source: row.source,
      correlationId: row.correlation_id,
      createdAt: row.created_at,
    }));
  }
}

const EPHEMERAL = new Set<EventType>([
  "AGENT_STATUS_CHANGED",
  "AGENT_MESSAGE",
  "TASK_STATUS_CHANGED",
  "TOOL_CALLED",
  "GOAL_PROGRESS",
]);

function reportHandlerError(error: unknown): void {
  console.error("[event-bus] subscriber failed:", error);
}

const globalRef = globalThis as unknown as { __commerceBus?: InMemoryEventBus };

export function getBus(): EventBus {
  globalRef.__commerceBus ??= new InMemoryEventBus();
  return globalRef.__commerceBus;
}
