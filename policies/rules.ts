/**
 * Policy configuration.
 *
 * These are the business rules the platform enforces. They are plain data and
 * plain functions — a model is never asked whether a policy is satisfied.
 */
import { rupees } from "@/lib/money";
import type { PolicyRule } from "@/types";

export const POLICY_LIMITS = {
  financial: {
    /** Refunds at or below this execute without a human. */
    maxAutoRefundPaise: rupees(2_000),
    /** Purchase orders at or below this execute without a human. */
    maxAutoPurchaseOrderPaise: rupees(50_000),
    /** Nothing in the system may move more than this, ever. */
    hardCeilingPaise: rupees(5_00_000),
  },
  pricing: {
    minimumMarginPercent: 25,
    maxPriceChangePercent: 10,
  },
  marketing: {
    maxDailyBudgetChangePaise: rupees(10_000),
  },
  inventory: {
    maxReorderPointDelta: 200,
  },
  security: {
    /** Permissions no agent may hold without an explicit grant in its definition. */
    restricted: ["READ_CUSTOMER_PII"] as const,
  },
} as const;

/** Rendered on the Settings → Policies screen. */
export const POLICY_RULES: PolicyRule[] = [
  {
    id: "FIN-001",
    category: "financial",
    description: "Refunds above the auto-approval limit require a human decision",
    limit: "₹2,000 per refund",
  },
  {
    id: "FIN-002",
    category: "financial",
    description: "Purchase orders above the auto-approval limit require a human decision",
    limit: "₹50,000 per order",
  },
  {
    id: "FIN-003",
    category: "financial",
    description: "No single action may move more than the hard ceiling",
    limit: "₹5,00,000 — denied outright",
  },
  {
    id: "PRC-001",
    category: "pricing",
    description: "Gross margin may never fall below the floor",
    limit: "25% minimum margin",
  },
  {
    id: "PRC-002",
    category: "pricing",
    description: "A single price change may not exceed the step limit",
    limit: "10% per change",
  },
  {
    id: "MKT-001",
    category: "marketing",
    description: "Daily campaign budget movement is capped",
    limit: "₹10,000 per day",
  },
  {
    id: "INV-001",
    category: "inventory",
    description: "Reorder point adjustments are bounded to prevent runaway restocking",
    limit: "±200 units",
  },
  {
    id: "SEC-001",
    category: "security",
    description: "Customer personally identifiable information is restricted",
    limit: "Explicit permission grant required",
  },
  {
    id: "BUD-001",
    category: "financial",
    description: "An agent may not exceed its daily spend authority",
    limit: "Per-agent daily budget",
  },
];

export const getPolicyRule = (id: string): PolicyRule | undefined =>
  POLICY_RULES.find((rule) => rule.id === id);
