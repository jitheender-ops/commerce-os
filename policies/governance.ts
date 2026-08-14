/**
 * Governance pipeline.
 *
 * One entry point evaluates every mutating tool call through five checks in a
 * fixed order:
 *
 *   permission → policy → risk → budget → autonomy
 *
 * They are merged into a single pipeline on purpose. When policy, risk and
 * budget are separate subsystems it becomes possible for a call to satisfy one
 * and silently skip another; here a call gets exactly one `GovernanceResult`
 * and the executor has one thing to obey.
 *
 * No model is consulted. Every decision below is deterministic code.
 */
import { AGENTS } from "@/agents/definitions";
import { getAgentBudget, getProduct, getSupplierQuotes, marginOf } from "./lookups";
import { POLICY_LIMITS } from "./rules";
import { marginPct } from "@/lib/money";
import type {
  AgentId,
  GovernanceReason,
  GovernanceResult,
  PolicyDecision,
  RiskLevel,
  ToolDefinition,
} from "@/types";

const SEVERITY: Record<PolicyDecision, number> = { ALLOW: 0, REQUIRE_APPROVAL: 1, DENY: 2 };
const RISK_ORDER: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export function evaluate(
  tool: ToolDefinition<unknown, unknown>,
  input: unknown,
  agentId: AgentId,
): GovernanceResult {
  const reasons: GovernanceReason[] = [];
  const agent = AGENTS[agentId];
  const financialImpactPaise = Math.abs(tool.financialImpactPaise?.(input) ?? 0);
  let risk = typeof tool.risk === "function" ? tool.risk(input) : tool.risk;

  // 1 — Permission. The agent's own definition is the allowlist.
  if (!agent.permissions.includes(tool.permission)) {
    reasons.push({
      check: "PERMISSION",
      decision: "DENY",
      message: `${agent.name} does not hold ${tool.permission}, required by ${tool.name}`,
    });
    return finalise(reasons, "CRITICAL", financialImpactPaise, null);
  }
  reasons.push({
    check: "PERMISSION",
    decision: "ALLOW",
    message: `${agent.name} holds ${tool.permission}`,
  });

  // Read-only tools stop here: nothing to spend, nothing to approve.
  if (!tool.mutates) {
    return finalise(reasons, "LOW", 0, null);
  }

  // 2 — Policy.
  for (const check of policyChecks(tool.name, input, financialImpactPaise)) {
    reasons.push(check);
    if (check.decision === "DENY") {
      return finalise(reasons, "CRITICAL", financialImpactPaise, null);
    }
  }

  // 3 — Risk. Money escalates risk regardless of the tool's own rating.
  risk = escalateRiskForMoney(risk, financialImpactPaise);
  reasons.push({
    check: "RISK",
    decision: risk === "HIGH" || risk === "CRITICAL" ? "REQUIRE_APPROVAL" : "ALLOW",
    message: `Assessed risk ${risk}`,
  });

  // 4 — Budget.
  const budget = agent.dailyBudgetPaise > 0 ? getAgentBudget(agentId) : null;
  let snapshot = null;
  if (budget && financialImpactPaise > 0) {
    const remaining = budget.limitPaise - budget.usedPaise;
    snapshot = {
      limitPaise: budget.limitPaise,
      usedPaise: budget.usedPaise,
      remainingPaise: remaining,
    };
    if (financialImpactPaise > remaining) {
      reasons.push({
        check: "BUDGET",
        decision: "REQUIRE_APPROVAL",
        policyId: "BUD-001",
        message: `Action exceeds ${agent.name}'s remaining daily authority`,
      });
    } else {
      reasons.push({
        check: "BUDGET",
        decision: "ALLOW",
        message: `Within daily authority`,
      });
    }
  }

  // 5 — Autonomy. A low autonomy level can only tighten the outcome.
  reasons.push(autonomyCheck(agentId));

  return finalise(reasons, risk, financialImpactPaise, snapshot);
}

function finalise(
  reasons: GovernanceReason[],
  risk: RiskLevel,
  financialImpactPaise: number,
  budget: GovernanceResult["budget"],
): GovernanceResult {
  const decision = reasons.reduce<PolicyDecision>(
    (worst, reason) => (SEVERITY[reason.decision] > SEVERITY[worst] ? reason.decision : worst),
    "ALLOW",
  );
  return { decision, risk, reasons, financialImpactPaise, budget };
}

function autonomyCheck(agentId: AgentId): GovernanceReason {
  const level = AGENTS[agentId].autonomy;
  if (level <= 1) {
    return {
      check: "POLICY",
      decision: "REQUIRE_APPROVAL",
      message: `Autonomy level ${level} — this agent may only recommend`,
    };
  }
  if (level === 2) {
    return {
      check: "POLICY",
      decision: "REQUIRE_APPROVAL",
      message: `Autonomy level 2 — execution requires human approval`,
    };
  }
  return {
    check: "POLICY",
    decision: "ALLOW",
    message: `Autonomy level ${level} — bounded autonomous execution permitted`,
  };
}

function escalateRiskForMoney(base: RiskLevel, paise: number): RiskLevel {
  const { financial } = POLICY_LIMITS;
  let derived: RiskLevel = "LOW";
  if (paise > financial.maxAutoPurchaseOrderPaise) derived = "HIGH";
  else if (paise > financial.maxAutoRefundPaise) derived = "MEDIUM";
  if (paise > financial.hardCeilingPaise) derived = "CRITICAL";
  return RISK_ORDER[Math.max(RISK_ORDER.indexOf(base), RISK_ORDER.indexOf(derived))];
}

/**
 * Per-tool business rules. Adding a mutating tool without a case here means it
 * gets only the generic financial checks — which is why `default` still applies
 * the hard ceiling.
 */
function policyChecks(
  toolName: string,
  input: unknown,
  financialImpactPaise: number,
): GovernanceReason[] {
  const reasons: GovernanceReason[] = [];
  const { financial, pricing, marketing, inventory } = POLICY_LIMITS;

  if (financialImpactPaise > financial.hardCeilingPaise) {
    return [
      {
        check: "POLICY",
        decision: "DENY",
        policyId: "FIN-003",
        message: `Action moves more than the hard ceiling and cannot be approved`,
      },
    ];
  }

  switch (toolName) {
    case "update_price": {
      const { productId, newPricePaise } = input as { productId: string; newPricePaise: number };
      const product = getProduct(productId);
      if (!product) {
        return [{ check: "POLICY", decision: "DENY", message: `Unknown product ${productId}` }];
      }
      const changePercent = Math.abs(
        ((newPricePaise - product.pricePaise) / product.pricePaise) * 100,
      );
      const resultingMargin = marginPct(newPricePaise, product.costPaise);

      if (resultingMargin < pricing.minimumMarginPercent) {
        reasons.push({
          check: "POLICY",
          decision: "DENY",
          policyId: "PRC-001",
          message: `Resulting margin ${resultingMargin.toFixed(1)}% is below the ${pricing.minimumMarginPercent}% floor`,
        });
        return reasons;
      }
      if (changePercent > pricing.maxPriceChangePercent) {
        reasons.push({
          check: "POLICY",
          decision: "DENY",
          policyId: "PRC-002",
          message: `Price change of ${changePercent.toFixed(1)}% exceeds the ${pricing.maxPriceChangePercent}% step limit`,
        });
        return reasons;
      }
      reasons.push({
        check: "POLICY",
        decision: "ALLOW",
        policyId: "PRC-001",
        message: `Change ${changePercent.toFixed(1)}% keeps margin at ${resultingMargin.toFixed(1)}%`,
      });
      break;
    }

    case "create_refund": {
      if (financialImpactPaise > financial.maxAutoRefundPaise) {
        reasons.push({
          check: "POLICY",
          decision: "REQUIRE_APPROVAL",
          policyId: "FIN-001",
          message: `Refund exceeds the ₹2,000 auto-approval limit`,
        });
      } else {
        reasons.push({
          check: "POLICY",
          decision: "ALLOW",
          policyId: "FIN-001",
          message: `Refund within the auto-approval limit`,
        });
      }
      const { suspectedFraud } = input as { suspectedFraud?: boolean };
      if (suspectedFraud) {
        reasons.push({
          check: "POLICY",
          decision: "REQUIRE_APPROVAL",
          policyId: "FIN-001",
          message: `Suspected fraud always goes to a human`,
        });
      }
      break;
    }

    case "create_purchase_order": {
      // An order the supplier has not quoted has no computable cost, and
      // `financialImpactPaise` reports an uncosted order as ₹0 — which would
      // sail through every money check below and reach a human as a "₹0"
      // approval that fails on execution. Deny it here, where the reason is
      // legible, rather than downstream where it is an exception.
      const { productId, supplierId } = input as { productId: string; supplierId: string };
      if (!getSupplierQuotes(productId).some((quote) => quote.supplierId === supplierId)) {
        return [
          {
            check: "POLICY",
            decision: "DENY",
            policyId: "FIN-002",
            message: `No quote from ${supplierId} for ${productId} — the cost of this order is unknown`,
          },
        ];
      }

      if (financialImpactPaise > financial.maxAutoPurchaseOrderPaise) {
        reasons.push({
          check: "POLICY",
          decision: "REQUIRE_APPROVAL",
          policyId: "FIN-002",
          message: `Purchase order exceeds the ₹50,000 auto-approval limit`,
        });
      } else {
        reasons.push({
          check: "POLICY",
          decision: "ALLOW",
          policyId: "FIN-002",
          message: `Purchase order within the auto-approval limit`,
        });
      }
      break;
    }

    case "propose_budget_change": {
      const { deltaPaise } = input as { deltaPaise: number };
      if (Math.abs(deltaPaise) > marketing.maxDailyBudgetChangePaise) {
        reasons.push({
          check: "POLICY",
          decision: "DENY",
          policyId: "MKT-001",
          message: `Budget movement exceeds the ₹10,000 daily cap`,
        });
        return reasons;
      }
      reasons.push({
        check: "POLICY",
        decision: "ALLOW",
        policyId: "MKT-001",
        message: `Budget movement within the daily cap`,
      });
      break;
    }

    case "adjust_reorder_point": {
      const { delta } = input as { delta: number };
      if (Math.abs(delta) > inventory.maxReorderPointDelta) {
        reasons.push({
          check: "POLICY",
          decision: "DENY",
          policyId: "INV-001",
          message: `Reorder point change of ${delta} exceeds the ±${inventory.maxReorderPointDelta} bound`,
        });
        return reasons;
      }
      reasons.push({
        check: "POLICY",
        decision: "ALLOW",
        policyId: "INV-001",
        message: `Reorder point change within bounds`,
      });
      break;
    }

    default:
      reasons.push({
        check: "POLICY",
        decision: "ALLOW",
        message: `No specific policy applies`,
      });
  }

  return reasons;
}

export { marginOf };
