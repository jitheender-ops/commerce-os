import { listApprovals } from "@/database/queries";
import { getPolicyRule } from "@/policies/rules";
import { ApprovalQueue } from "@/components/interactive";
import { Cell, DecisionBadge, Panel, Row, SectionTitle, Table } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { AGENTS } from "@/agents/definitions";

export default function ApprovalsPage() {
  const pending = listApprovals("PENDING").map((approval) => ({
    ...approval,
    policy: approval.policyId ? getPolicyRule(approval.policyId) ?? null : null,
  }));
  const resolved = listApprovals().filter((approval) => approval.status !== "PENDING").slice(0, 20);

  return (
    <div className="space-y-5">
      <SectionTitle hint={`${pending.length} awaiting a decision`}>Human Approval Queue</SectionTitle>

      <ApprovalQueue initial={pending} />

      {resolved.length > 0 && (
        <Panel title="Resolved" subtitle="Decisions already taken" bodyClassName="p-0">
          <Table head={["Action", "Agent", "Impact", "Risk", "Outcome"]}>
            {resolved.map((approval) => (
              <Row key={approval.id}>
                <Cell>{approval.title}</Cell>
                <Cell>
                  <span style={{ color: AGENTS[approval.agentId].color }}>
                    {AGENTS[approval.agentId].name}
                  </span>
                </Cell>
                <Cell mono>{formatMoney(approval.financialImpactPaise)}</Cell>
                <Cell>{approval.risk}</Cell>
                <Cell>
                  <DecisionBadge decision={approval.status} />
                </Cell>
              </Row>
            ))}
          </Table>
        </Panel>
      )}
    </div>
  );
}
