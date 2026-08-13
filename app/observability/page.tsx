import { AGENTS, AGENT_IDS } from "@/agents/definitions";
import { getAgentMetrics, listAudit } from "@/database/queries";
import { listPlans, loadTasks } from "@/orchestration/orchestrator";
import { Badge, Cell, Empty, Meter, Panel, Row, SectionTitle, Stat, Table } from "@/components/ui";

export default function ObservabilityPage() {
  const audit = listAudit({ limit: 500 });
  const failures = audit.filter((entry) => entry.executionStatus === "FAILED");
  const denied = audit.filter((entry) => entry.executionStatus === "DENIED");
  const plans = listPlans(10);

  const perAgent = AGENT_IDS.map((id) => ({ id, ...getAgentMetrics(id) }));
  const slowest = Math.max(...perAgent.map((agent) => agent.avgLatencyMs), 1);

  return (
    <div className="space-y-5">
      <SectionTitle hint="Metrics stored locally — no monitoring service, no cost">
        Observability
      </SectionTitle>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tool calls" value={String(audit.length)} />
        <Stat
          label="Error rate"
          value={`${audit.length ? ((failures.length / audit.length) * 100).toFixed(1) : 0}%`}
          invertDelta
        />
        <Stat label="Denied by governance" value={String(denied.length)} />
        <Stat label="Plans run" value={String(plans.length)} />
      </div>

      <Panel title="Per-agent" bodyClassName="p-0">
        <Table head={["Agent", "Completed", "Failed", "Tool calls", "Avg latency", "Latency"]}>
          {perAgent.map((agent) => (
            <Row key={agent.id}>
              <Cell>
                <span style={{ color: AGENTS[agent.id].color }}>{AGENTS[agent.id].name}</span>
              </Cell>
              <Cell mono>{agent.tasksCompleted}</Cell>
              <Cell mono>
                <span style={{ color: agent.tasksFailed > 0 ? "var(--bad)" : "var(--ink)" }}>
                  {agent.tasksFailed}
                </span>
              </Cell>
              <Cell mono>{agent.toolCalls}</Cell>
              <Cell mono>{agent.avgLatencyMs}ms</Cell>
              <Cell className="w-32">
                <Meter value={(agent.avgLatencyMs / slowest) * 100} />
              </Cell>
            </Row>
          ))}
        </Table>
      </Panel>

      <Panel title="Recent plans" subtitle="Task state machine outcomes" bodyClassName={plans.length ? "p-0" : undefined}>
        {plans.length === 0 ? (
          <Empty title="No plans have run yet" />
        ) : (
          <ul>
            {plans.map((plan) => {
              const tasks = loadTasks(plan.id);
              const done = tasks.filter((task) => task.status === "COMPLETED").length;
              return (
                <li key={plan.id} className="border-b px-4 py-3 last:border-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-[12px] font-medium">{plan.title}</p>
                      <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>
                        {plan.trigger} ·{" "}
                        <span className="num">
                          {new Date(plan.createdAt).toLocaleTimeString("en-GB", { hour12: false })}
                        </span>
                      </p>
                    </div>
                    <Badge tone={plan.status === "COMPLETED" ? "good" : plan.status === "FAILED" ? "bad" : "warn"}>
                      {done}/{tasks.length} tasks
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {tasks.map((task) => (
                      <span
                        key={task.id}
                        className="rounded border px-1.5 py-0.5 text-[10px]"
                        style={{
                          color:
                            task.status === "COMPLETED"
                              ? "var(--good)"
                              : task.status === "FAILED"
                                ? "var(--bad)"
                                : task.status === "BLOCKED"
                                  ? "var(--warn)"
                                  : "var(--ink-3)",
                        }}
                        title={task.error ?? task.title}
                      >
                        {AGENTS[task.agentId].name.split(" ")[0]} · {task.status.toLowerCase()}
                        {task.attempts > 1 ? ` ×${task.attempts}` : ""}
                      </span>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {failures.length > 0 && (
        <Panel title="Failures" subtitle="What broke, and where" bodyClassName="p-0">
          <Table head={["Time", "Agent", "Action", "Detail"]}>
            {failures.slice(0, 10).map((entry) => (
              <Row key={entry.id}>
                <Cell mono className="text-[10px]">
                  {new Date(entry.createdAt).toLocaleTimeString("en-GB", { hour12: false })}
                </Cell>
                <Cell className="text-[11px]">{entry.agentId}</Cell>
                <Cell mono className="text-[11px]">{entry.action}</Cell>
                <Cell className="text-[11px]">{JSON.stringify(entry.output)}</Cell>
              </Row>
            ))}
          </Table>
        </Panel>
      )}
    </div>
  );
}
