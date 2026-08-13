import { notFound } from "next/navigation";
import { AGENTS, isAgentId } from "@/agents/definitions";
import {
  getAgentBudget,
  getAgentMetrics,
  getAgentRow,
  listApprovals,
  listAudit,
  listMemory,
} from "@/database/queries";
import { getTool } from "@/tools/definitions";
import { str } from "@/database/db";
import { formatMoney } from "@/lib/money";
import {
  Badge,
  Cell,
  DecisionBadge,
  Empty,
  Meter,
  Panel,
  RiskBadge,
  Row,
  SectionTitle,
  Table,
} from "@/components/ui";
import { RunAgentButton } from "@/components/run-agent";

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isAgentId(id)) notFound();

  const agent = AGENTS[id];
  const row = getAgentRow(id);
  const status = row ? str(row.status) : "IDLE";
  const metrics = getAgentMetrics(id);
  const budget = getAgentBudget(id);
  const audit = listAudit({ agentId: id, limit: 25 });
  const memory = listMemory(id, 12);
  const approvals = listApprovals().filter((approval) => approval.agentId === id).slice(0, 6);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle hint={agent.role}>
          <span style={{ color: agent.color }}>{agent.name}</span>
        </SectionTitle>
        <div className="flex items-center gap-2">
          <Badge tone={status === "ERROR" ? "bad" : status === "IDLE" ? "good" : "warn"} dot>
            {status.toLowerCase()}
          </Badge>
          <RunAgentButton agentId={id} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Objective" className="lg:col-span-2">
          <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>
            {agent.objective}
          </p>
          <h3 className="mt-4 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.09em]" style={{ color: "var(--ink-3)" }}>
            System instructions
          </h3>
          <pre
            className="overflow-x-auto rounded-md border p-3 text-[11px] leading-relaxed whitespace-pre-wrap"
            style={{ background: "var(--panel-2)", color: "var(--ink-2)" }}
          >
            {agent.instructions}
          </pre>
        </Panel>

        <div className="space-y-4">
          <Panel title="Performance">
            <dl className="grid grid-cols-2 gap-2">
              {[
                ["Tasks completed", String(metrics.tasksCompleted)],
                ["Tasks failed", String(metrics.tasksFailed)],
                ["Tool calls", String(metrics.toolCalls)],
                ["Avg latency", `${metrics.avgLatencyMs}ms`],
                ["Approvals asked", String(metrics.approvalsRequested)],
                ["Approvals rejected", String(metrics.approvalsRejected)],
              ].map(([label, value]) => (
                <div key={label} className="panel-flush rounded-md border px-2.5 py-2">
                  <dt className="text-[9px] uppercase tracking-[0.07em]" style={{ color: "var(--ink-3)" }}>
                    {label}
                  </dt>
                  <dd className="num text-[14px]">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[11px]" style={{ color: "var(--ink-3)" }}>
              Business impact routed through this agent:{" "}
              <span className="num">{formatMoney(metrics.impactPaise)}</span>{" "}
              <span style={{ color: "var(--warn)" }}>simulated</span>
            </p>
          </Panel>

          <Panel title="Authority">
            <div className="space-y-2 text-[12px]">
              <div className="flex justify-between">
                <span style={{ color: "var(--ink-3)" }}>Autonomy level</span>
                <span className="num">L{agent.autonomy}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--ink-3)" }}>Daily budget</span>
                <span className="num">
                  {agent.dailyBudgetPaise === 0 ? "none" : formatMoney(agent.dailyBudgetPaise)}
                </span>
              </div>
              {budget.limitPaise > 0 && (
                <>
                  <div className="flex justify-between">
                    <span style={{ color: "var(--ink-3)" }}>Used today</span>
                    <span className="num">{formatMoney(budget.usedPaise)}</span>
                  </div>
                  <Meter value={(budget.usedPaise / budget.limitPaise) * 100} />
                </>
              )}
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Tools" subtitle="The complete capability surface" bodyClassName="p-0">
          <Table head={["Tool", "Permission", "Writes", "Risk"]}>
            {agent.tools.map((name) => {
              const tool = getTool(name);
              return (
                <Row key={name}>
                  <Cell>
                    <span className="num text-[11px]">{name}</span>
                    <span className="block text-[10px]" style={{ color: "var(--ink-3)" }}>
                      {tool?.description ?? "not registered"}
                    </span>
                  </Cell>
                  <Cell mono className="text-[10px]">
                    {tool?.permission}
                  </Cell>
                  <Cell>{tool?.mutates ? "yes" : "no"}</Cell>
                  <Cell className="text-[10px]">
                    {typeof tool?.risk === "string" ? tool.risk : "per call"}
                  </Cell>
                </Row>
              );
            })}
          </Table>
        </Panel>

        <Panel title="Permissions" subtitle="Enforced on every call, independent of the model">
          <div className="flex flex-wrap gap-1.5">
            {agent.permissions.map((permission) => (
              <Badge key={permission} tone={permission.startsWith("WRITE") ? "warn" : "neutral"}>
                {permission}
              </Badge>
            ))}
          </div>
          <h3 className="mt-4 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.09em]" style={{ color: "var(--ink-3)" }}>
            Explicitly denied
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {["WRITE_REFUNDS", "WRITE_PURCHASE_ORDERS", "WRITE_PRICES", "READ_CUSTOMER_PII", "WRITE_CAMPAIGNS"]
              .filter((permission) => !agent.permissions.includes(permission as never))
              .map((permission) => (
                <Badge key={permission} tone="bad">
                  {permission}
                </Badge>
              ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Recent decisions" subtitle="Governed calls, newest first" bodyClassName="p-0">
          {audit.length === 0 ? (
            <Empty title="This agent has not acted yet" hint="Run it, or trigger a scenario." />
          ) : (
            <Table head={["Time", "Action", "Policy", "Result"]}>
              {audit.map((entry) => (
                <Row key={entry.id}>
                  <Cell mono className="text-[10px]">
                    {new Date(entry.createdAt).toLocaleTimeString("en-GB", { hour12: false })}
                  </Cell>
                  <Cell>
                    <span className="num text-[11px]">{entry.action}</span>
                    <span className="block text-[10px]" style={{ color: "var(--ink-3)" }}>
                      {entry.entityType} {entry.entityId}
                    </span>
                  </Cell>
                  <Cell>
                    <DecisionBadge decision={entry.policyResult} />
                  </Cell>
                  <Cell>
                    <div className="flex gap-1">
                      <DecisionBadge decision={entry.executionStatus} />
                      <RiskBadge risk={entry.risk} />
                    </div>
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Memory" subtitle="What this agent carries between runs" bodyClassName={memory.length ? "p-0" : undefined}>
            {memory.length === 0 ? (
              <Empty title="No memories yet" />
            ) : (
              <ul>
                {memory.map((record) => (
                  <li key={record.id} className="border-b px-4 py-2 last:border-0">
                    <p className="text-[12px]" style={{ color: "var(--ink-2)" }}>
                      {record.content}
                    </p>
                    <span className="text-[10px]" style={{ color: "var(--ink-3)" }}>
                      {record.kind} · importance {record.importance.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {approvals.length > 0 && (
            <Panel title="Approvals raised" bodyClassName="p-0">
              <ul>
                {approvals.map((approval) => (
                  <li key={approval.id} className="flex items-start justify-between gap-3 border-b px-4 py-2 last:border-0">
                    <span className="text-[12px]">{approval.title}</span>
                    <DecisionBadge decision={approval.status} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
