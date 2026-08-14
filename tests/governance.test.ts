/**
 * Governance is the part of this system that must not be wrong, so it is tested
 * directly rather than through an agent.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { callTool } from "@/tools/executor";
import { evaluate } from "@/policies/governance";
import { getTool } from "@/tools/definitions";
import { seedDemo } from "@/simulation/seed";
import { getProduct, getSupplierQuotes, listOrders, listProducts } from "@/database/queries";
import { newCorrelationId } from "@/lib/ids";
import type { ToolContext } from "@/types";

const ctx = (agentId: ToolContext["agentId"]): ToolContext => ({
  agentId,
  taskId: null,
  correlationId: newCorrelationId(),
});

beforeAll(() => {
  seedDemo();
});

describe("permissions", () => {
  it("denies a tool the agent has no permission for", async () => {
    // Pricing holds WRITE_PRICES but never WRITE_REFUNDS.
    const result = await callTool(
      "create_refund",
      { orderId: listOrders(1)[0].id, amountPaise: 100, reason: "test" },
      ctx("pricing"),
    );

    expect(result.status).toBe("DENIED");
    expect(result.governance.decision).toBe("DENY");
    expect(result.governance.reasons[0].check).toBe("PERMISSION");
  });

  it("denies an analytics agent trying to write prices", async () => {
    const product = listProducts(1)[0];
    const result = await callTool(
      "update_price",
      { productId: product.id, newPricePaise: product.pricePaise, reason: "test" },
      ctx("analytics"),
    );
    expect(result.status).toBe("DENIED");
  });
});

describe("input validation", () => {
  it("rejects malformed tool arguments before governance runs", async () => {
    const result = await callTool(
      "update_price",
      { productId: 123, newPricePaise: "free" },
      ctx("pricing"),
    );
    expect(result.status).toBe("DENIED");
    expect(result.governance.reasons[0].check).toBe("SCHEMA");
  });

  it("rejects a negative purchase quantity", async () => {
    const result = await callTool(
      "create_purchase_order",
      { productId: "prd_001", supplierId: "sup_01", quantity: -50, reason: "test" },
      ctx("procurement"),
    );
    expect(result.status).toBe("DENIED");
  });

  it("denies an order no supplier has quoted rather than pricing it at ₹0", async () => {
    // Without a quote the cost is unknown, and an unknown cost reads as ₹0 —
    // which would clear every money check and reach a human as a "₹0" approval
    // that fails the moment they approve it.
    const quoted = listProducts(50).find((p) => getSupplierQuotes(p.id).length > 0)!;
    const quotedBy = new Set(getSupplierQuotes(quoted.id).map((q) => q.supplierId));
    const stranger = ["sup_01", "sup_02", "sup_03"].find((id) => !quotedBy.has(id))!;

    const result = await callTool(
      "create_purchase_order",
      { productId: quoted.id, supplierId: stranger, quantity: 200, reason: "test" },
      ctx("procurement"),
    );

    expect(result.status).toBe("DENIED");
    expect(result.governance.decision).toBe("DENY");
    expect(result.governance.reasons.some((r) => r.policyId === "FIN-002")).toBe(true);
  });

  it("denies a purchase order for a product that does not exist", async () => {
    const result = await callTool(
      "create_purchase_order",
      { productId: "prd_01", supplierId: "sup_01", quantity: 200, reason: "test" },
      ctx("procurement"),
    );
    expect(result.status).toBe("DENIED");
    expect(result.governance.financialImpactPaise).toBe(0);
  });
});

describe("pricing policy", () => {
  it("denies a price that breaks the margin floor", async () => {
    const product = listProducts(1)[0];
    const result = await callTool(
      "update_price",
      {
        productId: product.id,
        newPricePaise: product.costPaise + 1,
        reason: "attempt to sell at cost",
      },
      ctx("pricing"),
    );

    expect(result.status).toBe("DENIED");
    expect(result.governance.reasons.some((r) => r.policyId === "PRC-001")).toBe(true);
  });

  it("denies a price change larger than the step limit", async () => {
    const product = listProducts(1)[0];
    // A 30% *increase*: margin only improves, so the step limit is the sole
    // rule this can breach. A 30% cut would trip the margin floor first and
    // would not prove the step limit works.
    const result = await callTool(
      "update_price",
      {
        productId: product.id,
        newPricePaise: Math.round(product.pricePaise * 1.3),
        reason: "30% increase",
      },
      ctx("pricing"),
    );

    expect(result.status).toBe("DENIED");
    expect(result.governance.reasons.some((r) => r.policyId === "PRC-002")).toBe(true);
  });

  it("allows a change inside both limits and records the new price", async () => {
    const product = listProducts(1)[0];
    const target = Math.round(product.pricePaise * 1.04);
    const result = await callTool(
      "update_price",
      { productId: product.id, newPricePaise: target, reason: "within limits" },
      ctx("pricing"),
    );

    expect(result.status).toBe("COMPLETED");
    expect(getProduct(product.id)!.pricePaise).toBe(target);
  });
});

describe("financial policy", () => {
  it("auto-approves a refund under the limit", async () => {
    const order = listOrders(50).find((o) => o.totalPaise > 300_00)!;
    const result = await callTool(
      "create_refund",
      { orderId: order.id, amountPaise: 150_00, reason: "damaged item" },
      ctx("customer"),
    );

    expect(result.status).toBe("COMPLETED");
    expect(result.governance.decision).toBe("ALLOW");
  });

  it("requires approval for a refund over ₹2,000", async () => {
    const order = listOrders(50).find((o) => o.totalPaise > 5_000_00)!;
    const result = await callTool(
      "create_refund",
      { orderId: order.id, amountPaise: 4_000_00, reason: "large refund" },
      ctx("customer"),
    );

    expect(result.status).toBe("PENDING_APPROVAL");
    expect(result.approvalId).toBeTruthy();
    expect(result.governance.reasons.some((r) => r.policyId === "FIN-001")).toBe(true);
  });

  it("sends suspected fraud to a human regardless of amount", async () => {
    const order = listOrders(50).find((o) => o.totalPaise > 300_00)!;
    const result = await callTool(
      "create_refund",
      { orderId: order.id, amountPaise: 100_00, reason: "possible fraud", suspectedFraud: true },
      ctx("customer"),
    );
    expect(result.status).toBe("PENDING_APPROVAL");
  });

  it("refuses to refund more than the order was worth", async () => {
    const order = listOrders(1)[0];
    const result = await callTool(
      "create_refund",
      { orderId: order.id, amountPaise: order.totalPaise + 100_00, reason: "over-refund" },
      ctx("customer"),
    );
    // Governance permits it; the tool's own business validation rejects it.
    expect(result.status).not.toBe("COMPLETED");
  });
});

describe("risk escalation", () => {
  it("escalates risk with the amount of money moved", () => {
    const tool = getTool("create_refund")!;
    const small = evaluate(tool, { orderId: "x", amountPaise: 50_00, reason: "r" }, "customer");
    const large = evaluate(tool, { orderId: "x", amountPaise: 60_000_00, reason: "r" }, "customer");

    expect(small.risk).toBe("MEDIUM");
    expect(large.risk).toBe("HIGH");
    expect(large.decision).toBe("REQUIRE_APPROVAL");
  });

  it("denies anything above the hard ceiling outright", () => {
    const tool = getTool("create_refund")!;
    // ₹6,00,000 — above the ₹5,00,000 hard ceiling.
    const absurd = evaluate(tool, { orderId: "x", amountPaise: 6_00_000_00, reason: "r" }, "customer");

    expect(absurd.decision).toBe("DENY");
    expect(absurd.reasons.some((r) => r.policyId === "FIN-003")).toBe(true);
  });
});

describe("marketing policy", () => {
  it("denies a budget move beyond the daily cap", async () => {
    const result = await callTool(
      "propose_budget_change",
      { campaignId: "cmp_01", deltaPaise: 50_000_00, reason: "scale up" },
      ctx("marketing"),
    );
    expect(result.status).toBe("DENIED");
    expect(result.governance.reasons.some((r) => r.policyId === "MKT-001")).toBe(true);
  });
});

describe("read-only tools", () => {
  it("never require approval and never consume budget", async () => {
    const result = await callTool("get_business_summary", {}, ctx("analytics"));
    expect(result.status).toBe("COMPLETED");
    expect(result.governance.decision).toBe("ALLOW");
    expect(result.governance.financialImpactPaise).toBe(0);
    expect(result.governance.budget).toBeNull();
  });
});
