/**
 * Approving replays the parked tool call through the full pipeline again.
 * The approval satisfies the approval requirement only — permission and policy
 * are re-evaluated, so an approval that has gone stale (price moved, stock
 * changed) still cannot execute something the rules now forbid.
 */
import { getApproval, resolveApproval, writeAudit } from "@/database/queries";
import { executeApproved } from "@/tools/executor";
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

    const approvedBy = (await resolver(request)) ?? "operator";
    if (!resolveApproval(id, "APPROVED", approvedBy)) {
      return fail(`Approval ${id} was resolved by someone else`, 409);
    }

    const result = await executeApproved(approval);

    writeAudit({
      agentId: approval.agentId,
      action: `approval:${approval.toolName}`,
      entityType: approval.entityType,
      entityId: approval.entityId,
      input: approval.input,
      output: result.output,
      policyResult: result.governance.decision,
      approvalRequired: true,
      approvalStatus: "APPROVED",
      risk: approval.risk,
      executionStatus: result.status,
      correlationId: approval.correlationId,
    });

    getBus().publish(
      "APPROVAL_RESOLVED",
      {
        approvalId: id,
        decision: "APPROVED",
        agentId: approval.agentId,
        title: approval.title,
        executionStatus: result.status,
      },
      { source: "human", correlationId: approval.correlationId },
    );

    return ok({ approval: { ...approval, status: "APPROVED", resolvedBy: approvedBy }, execution: result });
  } catch (error) {
    return handle(error, "approvals/approve");
  }
}

async function resolver(request: Request): Promise<string | null> {
  try {
    const parsed = (await request.json()) as { by?: string };
    return typeof parsed.by === "string" && parsed.by.trim() ? parsed.by.trim() : null;
  } catch {
    return null;
  }
}
