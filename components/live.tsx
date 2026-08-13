"use client";

/**
 * Live surfaces: the SSE subscription, the activity feed, and the agent graph.
 *
 * One EventSource is shared by every consumer on the page through a small
 * subscriber registry — opening one connection per component would multiply
 * server-side streams for no benefit.
 */
import { useEffect, useMemo, useState } from "react";
import { AGENTS, AGENT_IDS } from "@/agents/definitions";
import { Badge, Panel } from "@/components/ui";
import type { AgentId, BusinessEvent } from "@/types";

type Listener = (event: BusinessEvent) => void;

let source: EventSource | null = null;
const listeners = new Set<Listener>();

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (!source) {
    source = new EventSource("/api/events/stream");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as BusinessEvent;
        for (const fn of listeners) fn(event);
      } catch {
        // A malformed frame should not tear down the stream.
      }
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && source) {
      source.close();
      source = null;
    }
  };
}

export function useLiveEvents(limit = 60): BusinessEvent[] {
  const [events, setEvents] = useState<BusinessEvent[]>([]);
  useEffect(
    () =>
      subscribe((event) => {
        setEvents((current) => [event, ...current].slice(0, limit));
      }),
    [limit],
  );
  return events;
}

const AGENT_LABEL: Record<string, string> = Object.fromEntries(
  AGENT_IDS.map((id) => [id, AGENTS[id].name]),
);

function describe(event: BusinessEvent): { text: string; tone: "neutral" | "good" | "warn" | "bad" } {
  const payload = event.payload as Record<string, unknown>;
  const agent = AGENT_LABEL[String(payload.agentId ?? event.source)] ?? event.source;

  switch (event.type) {
    case "AGENT_MESSAGE":
      return { text: `${agent}: ${payload.message}`, tone: "neutral" };
    case "AGENT_STATUS_CHANGED":
      return { text: `${agent} → ${payload.activity}`, tone: "neutral" };
    case "TOOL_CALLED": {
      const status = String(payload.status);
      return {
        text: `${agent} called ${payload.tool} · ${status}${payload.error ? ` — ${payload.error}` : ""}`,
        tone: status === "COMPLETED" ? "good" : status === "PENDING_APPROVAL" ? "warn" : "bad",
      };
    }
    case "TASK_STATUS_CHANGED":
      return { text: `${payload.agentName} task ${String(payload.status).toLowerCase()}`, tone: "neutral" };
    case "APPROVAL_REQUESTED":
      return { text: `Approval requested: ${payload.title}`, tone: "warn" };
    case "APPROVAL_RESOLVED":
      return {
        text: `Approval ${String(payload.decision).toLowerCase()}: ${payload.title}`,
        tone: payload.decision === "APPROVED" ? "good" : "bad",
      };
    case "PLAN_CREATED":
      return { text: `Plan created — ${payload.title}`, tone: "neutral" };
    case "PLAN_COMPLETED":
      return { text: `Plan finished — ${payload.completed} agents reported`, tone: "good" };
    case "STREAM_OPEN" as BusinessEvent["type"]:
      return { text: "Live stream connected", tone: "good" };
    default:
      return {
        text: `${event.type.replace(/_/g, " ").toLowerCase()}${payload.summary ? ` — ${payload.summary}` : ""}`,
        tone: "warn",
      };
  }
}

const TONE_COLOR = {
  neutral: "var(--ink-2)",
  good: "var(--good)",
  warn: "var(--warn)",
  bad: "var(--bad)",
} as const;

export function ActivityFeed({ height = "h-[420px]" }: { height?: string }) {
  const events = useLiveEvents(80);
  const [connected, setConnected] = useState(false);

  useEffect(() => subscribe(() => setConnected(true)), []);

  return (
    <Panel
      title="Agent activity"
      subtitle="Live event stream"
      actions={
        <Badge tone={connected ? "good" : "neutral"} dot>
          {connected ? "live" : "connecting"}
        </Badge>
      }
      bodyClassName="p-0"
    >
      <ol className={`${height} overflow-y-auto`}>
        {events.length === 0 && (
          <li className="px-4 py-6 text-center text-[12px]" style={{ color: "var(--ink-3)" }}>
            Waiting for activity. Trigger a scenario from the Simulator to see agents work.
          </li>
        )}
        {events.map((event) => {
          const { text, tone } = describe(event);
          return (
            <li key={event.id} className="enter flex gap-3 border-b px-4 py-2 last:border-0">
              <time
                className="num shrink-0 text-[10px] tabular-nums"
                style={{ color: "var(--ink-3)" }}
                dateTime={event.createdAt}
              >
                {new Date(event.createdAt).toLocaleTimeString("en-GB", { hour12: false })}
              </time>
              <span className="text-[12px] leading-snug" style={{ color: TONE_COLOR[tone] }}>
                {text}
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

/**
 * Agent graph. Edges light up when a message passes between two agents, and
 * fade back after a moment — the picture reflects real traffic on the bus.
 */
/** How long after its last event an agent keeps glowing. */
const ACTIVE_WINDOW_MS = 2500;

export function AgentGraph() {
  const events = useLiveEvents(40);
  // Activity is *derived* from event timestamps rather than tracked in state
  // with per-agent timers: one ticking clock replaces seven timeouts, and there
  // is nothing to clean up or leak.
  const [now, setNow] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 400);
    return () => clearInterval(id);
  }, []);

  const activeAgents = useMemo(() => {
    const active = new Set<string>();
    for (const event of events) {
      const agentId = String((event.payload as Record<string, unknown>).agentId ?? "");
      if (!AGENT_LABEL[agentId]) continue;
      if (now - new Date(event.createdAt).getTime() < ACTIVE_WINDOW_MS) active.add(agentId);
    }
    return active;
  }, [events, now]);

  // Fixed radial layout: CEO at the centre, specialists on a ring.
  const positions = useMemo(() => {
    const specialists = AGENT_IDS.filter((id) => id !== "ceo");
    const radius = 92;
    return {
      ceo: { x: 160, y: 108 },
      ...Object.fromEntries(
        specialists.map((id, index) => {
          const angle = (index / specialists.length) * Math.PI * 2 - Math.PI / 2;
          return [id, { x: 160 + Math.cos(angle) * radius, y: 108 + Math.sin(angle) * radius * 0.82 }];
        }),
      ),
    } as Record<AgentId, { x: number; y: number }>;
  }, []);

  return (
    <Panel title="Agent graph" subtitle="Delegation topology · active agents pulse">
      <svg viewBox="0 0 320 216" className="w-full" role="img" aria-label="Agent delegation graph">
        {AGENT_IDS.filter((id) => id !== "ceo").map((id) => {
          const from = positions.ceo;
          const to = positions[id];
          const active = activeAgents.has(id);
          return (
            <line
              key={`edge-${id}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={active ? AGENTS[id].color : "var(--line)"}
              strokeWidth={active ? 1.6 : 1}
              className={active ? "flowing" : undefined}
            />
          );
        })}
        {/* Inventory delegates to Procurement — the one non-radial edge. */}
        <line
          x1={positions.inventory.x}
          y1={positions.inventory.y}
          x2={positions.procurement.x}
          y2={positions.procurement.y}
          stroke={activeAgents.has("procurement") ? AGENTS.procurement.color : "var(--line)"}
          strokeWidth={1}
          strokeDasharray="2 3"
        />
        {AGENT_IDS.map((id) => {
          const { x, y } = positions[id];
          const active = activeAgents.has(id);
          const isCeo = id === "ceo";
          return (
            <g key={id}>
              <circle
                cx={x}
                cy={y}
                r={isCeo ? 15 : 11}
                fill="var(--panel)"
                stroke={active ? AGENTS[id].color : "var(--line-strong)"}
                strokeWidth={active ? 2 : 1}
                className={active ? "pulse" : undefined}
                style={{ color: AGENTS[id].color }}
              />
              <text
                x={x}
                y={y + 3}
                textAnchor="middle"
                fontSize={isCeo ? 8 : 7}
                fill={AGENTS[id].color}
                fontWeight={600}
              >
                {id === "ceo" ? "CEO" : AGENTS[id].name.split(" ")[0].slice(0, 4).toUpperCase()}
              </text>
              <text
                x={x}
                y={y + (isCeo ? 27 : 23)}
                textAnchor="middle"
                fontSize={6.5}
                fill="var(--ink-3)"
              >
                {AGENTS[id].role.split(" ")[0]}
              </text>
            </g>
          );
        })}
      </svg>
    </Panel>
  );
}
