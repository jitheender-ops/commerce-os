import { listApprovals } from "@/database/queries";
import { getPolicyRule } from "@/policies/rules";
import { AGENTS } from "@/agents/definitions";
import { handle, ok, ready, searchParam } from "@/lib/api";
import type { Approval } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    ready();
    const status = searchParam(request, "status") as Approval["status"] | undefined;
    const approvals = listApprovals(status).map((approval) => ({
      ...approval,
      agentName: AGENTS[approval.agentId].name,
      policy: approval.policyId ? getPolicyRule(approval.policyId) ?? null : null,
    }));
    return ok({
      approvals,
      counts: {
        pending: listApprovals("PENDING").length,
        approved: listApprovals("APPROVED").length,
        rejected: listApprovals("REJECTED").length,
      },
    });
  } catch (error) {
    return handle(error, "approvals");
  }
}
