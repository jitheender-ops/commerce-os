import { beforeAll, describe, expect, it } from "vitest";
import { ensureSeeded, seedDemo } from "@/simulation/seed";
import { AGENTS } from "@/agents/definitions";
import { getDb } from "@/database/db";
import {
  getBusinessSummary,
  getDailyMetrics,
  getRevenueDecomposition,
  getStockoutRisks,
  listProducts,
} from "@/database/queries";
import { recommendProducts } from "@/memory/vector";

let report: ReturnType<typeof seedDemo>;

beforeAll(() => {
  report = seedDemo();
});

describe("deterministic seed", () => {
  it("creates the dataset the brief asks for", () => {
    expect(report.products).toBe(50);
    expect(report.customers).toBe(500);
    expect(report.suppliers).toBe(10);
    expect(report.campaigns).toBe(8);
    expect(report.days).toBe(30);
    expect(report.orders).toBeGreaterThanOrEqual(2000);
  });

  it("is reproducible — reseeding produces identical figures", () => {
    const first = getBusinessSummary();
    seedDemo();
    const second = getBusinessSummary();
    expect(second.revenuePaise).toBe(first.revenuePaise);
    expect(second.orders).toBe(first.orders);
    expect(second.conversionRate).toBe(first.conversionRate);
  });

  it("keeps every product priced above cost", () => {
    for (const product of listProducts(500)) {
      expect(product.pricePaise).toBeGreaterThan(product.costPaise);
    }
  });

  it("derives daily metrics from the generated orders", () => {
    const metrics = getDailyMetrics(30);
    expect(metrics).toHaveLength(30);
    for (const day of metrics) {
      expect(day.revenuePaise).toBeGreaterThan(day.cogsPaise);
      expect(day.orders).toBeGreaterThan(0);
      expect(day.sessions).toBeGreaterThan(day.orders);
    }
  });

  it("plants a discoverable conversion fault on the latest day", () => {
    const decomposition = getRevenueDecomposition();
    expect(decomposition.revenueChangePct).toBeLessThan(0);
    expect(decomposition.primaryDriver).toBe("Conversion rate");

    const failures = decomposition.supporting.find((s) =>
      s.label.startsWith("Mobile payment failures"),
    );
    expect(failures?.detail).toMatch(/^\+/);
    // The label has to say what it counts. Attempts and failed order rows are
    // different quantities that sit next to each other on screen, and an
    // external agent reading both once concluded the data contradicted itself.
    expect(failures?.label).toContain("attempts");
  });

  it("produces inventory with a spread of stockout risk", () => {
    const risks = getStockoutRisks();
    expect(risks.length).toBe(50);
    expect(risks.some((r) => r.risk === "HIGH" || r.risk === "CRITICAL")).toBe(true);
    expect(risks.some((r) => r.risk === "LOW")).toBe(true);
  });

  /**
   * Every other test here seeds a fresh database, which is exactly why none of
   * them could catch this: an agent added after a database was seeded has a
   * definition in code and no row in the table, and its first metrics write
   * dies on a foreign key. Only an upgrade hits it, so an upgrade is what this
   * simulates.
   */
  it("gives an agent added after seeding its rows", () => {
    const db = getDb();
    db.run(`DELETE FROM agents WHERE id = ?`, "fulfillment");
    expect(db.get(`SELECT id FROM agents WHERE id = ?`, "fulfillment")).toBeUndefined();

    ensureSeeded();

    expect(db.get(`SELECT id FROM agents WHERE id = ?`, "fulfillment")).toBeTruthy();
    expect(
      db.get(`SELECT agent_id FROM agent_metrics WHERE agent_id = ?`, "fulfillment"),
    ).toBeTruthy();
    expect(
      db.all(`SELECT permission FROM agent_permissions WHERE agent_id = ?`, "fulfillment"),
    ).toHaveLength(AGENTS.fulfillment.permissions.length);

    // And it adds nothing when every agent is already present.
    ensureSeeded();
    const count = db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM agents WHERE id = ?`,
      "fulfillment",
    );
    expect(Number(count?.n)).toBe(1);
  });

  it("ranks the catalogue against a shopper's stated need", () => {
    const results = recommendProducts({
      text: "laptop for programming and video editing",
      maxBudgetPaise: 80_000_00,
      limit: 3,
    });
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.product.pricePaise).toBeLessThanOrEqual(80_000_00);
    }
    expect(results[0].product.category).toBe("Laptops");
  });
});
