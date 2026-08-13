import { bumpAgentMetrics, getApproval, resolveApproval, writeAudit } from "@/database/queries";
import { getBus } from "@/events/bus";
import { fail, handle, ok, ready } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    ready();
    const { id } = await context.params;
    const approval = getApproval(id);
    if (!approval) return fail(`No such approval: ${id}`, 404);
    if (approval.status !== "PENDING") {
      return fail(`Approval ${id} was already ${approval.status.toLowerCase()}`, 409);
    }

    let note = "Rejected by operator";
    try {
      const parsed = (await request.json()) as { note?: string; by?: string };
      if (parsed.note?.trim()) note = parsed.note.trim();
    } catch {
      // No body is fine.
    }

    if (!resolveApproval(id, "REJECTED", "operator")) {
      return fail(`Approval ${id} was resolved by someone else`, 409);
    }
    bumpAgentMetrics(approval.agentId, { approvals_rejected: 1 });

    writeAudit({
      agentId: approval.agentId,
      action: `approval:${approval.toolName}`,
      entityType: approval.entityType,
      entityId: approval.entityId,
      input: approval.input,
      output: { note },
      policyResult: "DENY",
      approvalRequired: true,
      approvalStatus: "REJECTED",
      risk: approval.risk,
      executionStatus: "DENIED",
      correlationId: approval.correlationId,
    });

    getBus().publish(
      "APPROVAL_RESOLVED",
      { approvalId: id, decision: "REJECTED", agentId: approval.agentId, title: approval.title, note },
      { source: "human", correlationId: approval.correlationId },
    );

    return ok({ approval: { ...approval, status: "REJECTED" }, note });
  } catch (error) {
    return handle(error, "approvals/reject");
  }
}
