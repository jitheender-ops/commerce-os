/**
 * Customer-facing product search.
 *
 * The ranking is deterministic and its score breakdown is returned, so the UI
 * can show exactly why each product placed where it did. The optional narration
 * comes from the AI gateway and is labelled with the engine that produced it.
 */
import { z } from "zod";
import { recommendProducts, DEFAULT_WEIGHTS } from "@/memory/vector";
import { getAI } from "@/ai/gateway";
import { formatMoney } from "@/lib/money";
import { body, handle, ok, ready } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Payload = z.object({
  query: z.string().min(2).max(300),
  maxBudgetPaise: z.number().int().positive().optional(),
  category: z.string().optional(),
  limit: z.number().int().min(1).max(8).default(4),
});

export async function GET() {
  return ok({ weights: DEFAULT_WEIGHTS });
}

export async function POST(request: Request) {
  try {
    ready();
    const parsed = await body(request, Payload);
    if (parsed.error) return parsed.error;
    const { query, maxBudgetPaise, category, limit } = parsed.data;

    const results = recommendProducts({ text: query, maxBudgetPaise, category, limit });

    const fallback = () =>
      results.length === 0
        ? `Nothing in the catalogue matches that within the stated budget.`
        : results
            .map(
              (r) =>
                `${r.product.name} at ${formatMoney(r.product.pricePaise)} — ${r.reasons.join(", ") || "matches the requirement"}.`,
            )
            .join(" ");

    const { value: explanation, engine } = await getAI().text(
      [
        {
          role: "system",
          content:
            "You help a shopper choose between products that have already been ranked for them. " +
            "Use only the products and figures given. Be specific about the trade-off between the top two. " +
            "Do not invent specifications.",
        },
        {
          role: "user",
          content: [
            `Shopper asked: ${query}`,
            maxBudgetPaise ? `Budget: ${formatMoney(maxBudgetPaise)}` : "No stated budget.",
            ``,
            `Ranked results:`,
            ...results.map(
              (r, index) =>
                `${index + 1}. ${r.product.name} (${r.product.category}, ${r.product.brand}) — ` +
                `${formatMoney(r.product.pricePaise)}, rated ${r.product.rating}/5, score ${r.score}. ` +
                `${r.product.description} Notes: ${r.reasons.join("; ") || "none"}.`,
            ),
          ].join("\n"),
        },
      ],
      fallback,
    );

    return ok({
      query,
      results,
      explanation,
      engine,
      weights: DEFAULT_WEIGHTS,
    });
  } catch (error) {
    return handle(error, "recommend");
  }
}
