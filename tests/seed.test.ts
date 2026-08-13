import { beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "@/simulation/seed";
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

    const failures = decomposition.supporting.find(
      (s) => s.label === "Mobile payment failures",
    );
    expect(failures?.detail).toMatch(/^\+/);
  });

  it("produces inventory with a spread of stockout risk", () => {
    const risks = getStockoutRisks();
    expect(risks.length).toBe(50);
    expect(risks.some((r) => r.risk === "HIGH" || r.risk === "CRITICAL")).toBe(true);
    expect(risks.some((r) => r.risk === "LOW")).toBe(true);
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
