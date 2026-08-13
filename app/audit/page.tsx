import { AGENTS, isAgentId } from "@/agents/definitions";
import { listAudit } from "@/database/queries";
import { Cell, DecisionBadge, Empty, Panel, RiskBadge, Row, SectionTitle, Stat, Table } from "@/components/ui";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; risk?: string; status?: string }>;
}) {
  const filters = await searchParams;
  const entries = listAudit({
    agentId: filters.agent,
    risk: filters.risk,
    status: filters.status,
    limit: 200,
  });

  const denied = entries.filter((entry) => entry.executionStatus === "DENIED").length;
  const approvals = entries.filter((entry) => entry.approvalRequired).length;
  const failed = entries.filter((entry) => entry.executionStatus === "FAILED").length;

  const chip = (label: string, href: string, active: boolean) => (
    <a
      key={href}
      href={href}
      className="rounded-full border px-2.5 py-1 text-[11px]"
      style={active ? { borderColor: "var(--accent)", color: "var(--accent)" } : { color: "var(--ink-2)" }}
    >
      {label}
    </a>
  );

  return (
    <div className="space-y-5">
      <SectionTitle hint="Every governed action, immutable and correlated">Audit Log</SectionTitle>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Entries" value={String(entries.length)} />
        <Stat label="Denied by policy" value={String(denied)} />
        <Stat label="Sent to a human" value={String(approvals)} />
        <Stat label="Failed" value={String(failed)} invertDelta />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {chip("All", "/audit", !filters.agent && !filters.risk && !filters.status)}
        {Object.values(AGENTS).map((agent) =>
          chip(agent.name, `/audit?agent=${agent.id}`, filters.agent === agent.id),
        )}
        {["DENIED", "PENDING_APPROVAL", "FAILED"].map((status) =>
          chip(status.toLowerCase().replace("_", " "), `/audit?status=${status}`, filters.status === status),
        )}
        {["HIGH", "CRITICAL"].map((risk) =>
          chip(`${risk.toLowerCase()} risk`, `/audit?risk=${risk}`, filters.risk === risk),
        )}
      </div>

      <Panel title="Entries" bodyClassName={entries.length ? "p-0" : undefined}>
        {entries.length === 0 ? (
          <Empty title="Nothing matches those filters" />
        ) : (
          <Table head={["Time", "Agent", "Action", "Entity", "Policy", "Risk", "Result", "Correlation"]}>
            {entries.map((entry) => (
              <Row key={entry.id}>
                <Cell mono className="text-[10px]">
                  {new Date(entry.createdAt).toLocaleString("en-GB", { hour12: false })}
                </Cell>
                <Cell className="text-[11px]">
                  <span
                    style={{
                      color: isAgentId(entry.agentId) ? AGENTS[entry.agentId].color : "var(--ink-2)",
                    }}
                  >
                    {isAgentId(entry.agentId) ? AGENTS[entry.agentId].name : entry.agentId}
                  </span>
                </Cell>
                <Cell mono className="text-[11px]">{entry.action}</Cell>
                <Cell className="text-[11px]">
                  {entry.entityType}
                  <span className="num block text-[10px]" style={{ color: "var(--ink-3)" }}>
                    {entry.entityId}
                  </span>
                </Cell>
                <Cell>
                  <DecisionBadge decision={entry.policyResult} />
                </Cell>
                <Cell>
                  <RiskBadge risk={entry.risk} />
                </Cell>
                <Cell>
                  <DecisionBadge decision={entry.executionStatus} />
                </Cell>
                <Cell mono className="text-[9px]" >
                  <span style={{ color: "var(--ink-3)" }}>{entry.correlationId.slice(-8)}</span>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}
