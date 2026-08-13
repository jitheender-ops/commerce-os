import { z } from "zod";
import { getProduct, getPricingHistory, getSalesVelocity, listProducts } from "@/database/queries";
import { marginPct } from "@/lib/money";
import { POLICY_LIMITS } from "@/policies/rules";
import { body, handle, ok, ready } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    ready();
    const products = listProducts(50).map((product) => ({
      ...product,
      marginPercent: Number(marginPct(product.pricePaise, product.costPaise).toFixed(1)),
      competitorGapPercent: Number(
        (((product.pricePaise - product.competitorPricePaise) / product.competitorPricePaise) * 100).toFixed(1),
      ),
    }));
    return ok({
      products,
      history: getPricingHistory(undefined, 30),
      limits: POLICY_LIMITS.pricing,
    });
  } catch (error) {
    return handle(error, "pricing");
  }
}

const Simulation = z.object({
  productId: z.string(),
  newPricePaise: z.number().int().positive(),
  elasticity: z.number().min(-4).max(0).default(-1.4),
});

/**
 * Interactive pricing simulator. Constant-elasticity, stated openly — this is a
 * model, not a measurement, and the response says so.
 */
export async function POST(request: Request) {
  try {
    ready();
    const parsed = await body(request, Simulation);
    if (parsed.error) return parsed.error;
    const { productId, newPricePaise, elasticity } = parsed.data;

    const product = getProduct(productId);
    if (!product) return ok({ error: `Unknown product ${productId}` }, { status: 404 });

    const baselineUnits = Math.max(1, getSalesVelocity(productId, 14) * 30);
    const projectedUnits = baselineUnits * (newPricePaise / product.pricePaise) ** elasticity;
    const resultingMargin = marginPct(newPricePaise, product.costPaise);
    const changePercent = ((newPricePaise - product.pricePaise) / product.pricePaise) * 100;

    return ok({
      product,
      elasticity,
      before: {
        pricePaise: product.pricePaise,
        units: Number(baselineUnits.toFixed(1)),
        revenuePaise: Math.round(baselineUnits * product.pricePaise),
        profitPaise: Math.round(baselineUnits * (product.pricePaise - product.costPaise)),
        marginPercent: Number(marginPct(product.pricePaise, product.costPaise).toFixed(1)),
      },
      after: {
        pricePaise: newPricePaise,
        units: Number(projectedUnits.toFixed(1)),
        revenuePaise: Math.round(projectedUnits * newPricePaise),
        profitPaise: Math.round(projectedUnits * (newPricePaise - product.costPaise)),
        marginPercent: Number(resultingMargin.toFixed(1)),
      },
      policy: {
        withinMarginFloor: resultingMargin >= POLICY_LIMITS.pricing.minimumMarginPercent,
        withinStepLimit: Math.abs(changePercent) <= POLICY_LIMITS.pricing.maxPriceChangePercent,
        changePercent: Number(changePercent.toFixed(1)),
      },
      basis: "ESTIMATED — constant price elasticity applied to 30 days of trailing demand. Not a measured outcome.",
    });
  } catch (error) {
    return handle(error, "pricing:simulate");
  }
}
