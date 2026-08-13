import Link from "next/link";
import { AGENTS, AGENT_IDS } from "@/agents/definitions";
import { getAgentBudget, getAgentMetrics, getAgentRow, listApprovals } from "@/database/queries";
import { str } from "@/database/db";
import { formatMoney } from "@/lib/money";
import { AgentGraph } from "@/components/live";
import { Badge, Meter, Panel, SectionTitle } from "@/components/ui";

const AUTONOMY_LABEL = [
  "Manual",
  "Recommend only",
  "Execute with approval",
  "Bounded autonomy",
  "Full autonomy",
];

export default function AgentsPage() {
  const pending = listApprovals("PENDING");

  return (
    <div className="space-y-5">
      <SectionTitle hint="Seven specialists, one shared governance layer">
        Agent Command Center
      </SectionTitle>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="grid gap-3 md:grid-cols-2">
          {AGENT_IDS.map((id) => {
            const agent = AGENTS[id];
            const row = getAgentRow(id);
            const status = row ? str(row.status) : "IDLE";
            const metrics = getAgentMetrics(id);
            const budget = getAgentBudget(id);
            const agentPending = pending.filter((approval) => approval.agentId === id).length;
            const budgetUsedPct =
              budget.limitPaise > 0 ? (budget.usedPaise / budget.limitPaise) * 100 : 0;

            return (
              <Panel
                key={id}
                title={
                  <Link href={`/agents/${id}`} style={{ color: agent.color }}>
                    {agent.name}
                  </Link>
                }
                subtitle={agent.role}
                actions={
                  <Badge tone={status === "ERROR" ? "bad" : status === "IDLE" ? "good" : "warn"} dot>
                    {status.toLowerCase()}
                  </Badge>
                }
              >
                <p className="text-[12px]" style={{ color: "var(--ink-2)" }}>
                  {agent.objective}
                </p>

                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[
                    ["Tools", String(agent.tools.length)],
                    ["Permissions", String(agent.permissions.length)],
                    ["Tool calls", String(metrics.toolCalls)],
                    ["Completed", String(metrics.tasksCompleted)],
                    ["Failed", String(metrics.tasksFailed)],
                    ["Avg latency", `${metrics.avgLatencyMs}ms`],
                  ].map(([label, value]) => (
                    <div key={label} className="panel-flush rounded-md border px-2 py-1.5">
                      <dt className="text-[9px] uppercase tracking-[0.07em]" style={{ color: "var(--ink-3)" }}>
                        {label}
                      </dt>
                      <dd className="num text-[13px]">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-3 flex items-center justify-between gap-3 text-[11px]">
                  <span style={{ color: "var(--ink-3)" }}>
                    Autonomy L{agent.autonomy} · {AUTONOMY_LABEL[agent.autonomy]}
                  </span>
                  {agentPending > 0 && <Badge tone="warn">{agentPending} awaiting approval</Badge>}
                </div>

                {budget.limitPaise > 0 && (
                  <div className="mt-2">
                    <div className="mb-1 flex justify-between text-[10px]" style={{ color: "var(--ink-3)" }}>
                      <span>Daily spend authority</span>
                      <span className="num">
                        {formatMoney(budget.usedPaise)} / {formatMoney(budget.limitPaise)}
                      </span>
                    </div>
                    <Meter value={budgetUsedPct} tone={budgetUsedPct > 80 ? "bad" : "accent"} />
                  </div>
                )}
              </Panel>
            );
          })}
        </div>

        <div className="space-y-4">
          <AgentGraph />
          <Panel title="Delegation" subtitle="Who may hand work to whom">
            <ul className="space-y-2">
              {AGENT_IDS.filter((id) => AGENTS[id].delegatesTo.length > 0).map((id) => (
                <li key={id} className="text-[12px]">
                  <span style={{ color: AGENTS[id].color }}>{AGENTS[id].name}</span>
                  <span style={{ color: "var(--ink-3)" }}> → </span>
                  {AGENTS[id].delegatesTo.map((target) => AGENTS[target].name).join(", ")}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px]" style={{ color: "var(--ink-3)" }}>
              Delegation moves findings, never permissions. An agent that receives work still runs
              every tool call through its own permission set.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
