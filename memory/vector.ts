/**
 * Product retrieval and ranking.
 *
 * `VectorStore` is the seam an embedding-backed store would implement. The
 * shipped implementation is lexical: term-overlap relevance (an IDF-weighted
 * cosine over the term index) combined with commercial signals. At a
 * fifty-product catalogue this beats embeddings on both accuracy and honesty —
 * there is no model in the loop, so nothing is claimed that isn't computed.
 *
 * Weights are configurable so the ranking is inspectable rather than magic.
 */
import { getDb, num, str } from "@/database/db";
import { listProducts, round, tokenise } from "@/database/queries";
import { marginPct } from "@/lib/money";
import type { Product } from "@/types";

export interface ScoredProduct {
  product: Product;
  score: number;
  breakdown: Record<string, number>;
  reasons: string[];
}

export interface RankingWeights {
  relevance: number;
  budgetFit: number;
  availability: number;
  rating: number;
  margin: number;
  popularity: number;
}

export const DEFAULT_WEIGHTS: RankingWeights = {
  relevance: 0.3,
  budgetFit: 0.2,
  availability: 0.15,
  rating: 0.15,
  margin: 0.1,
  popularity: 0.1,
};

export interface VectorStore {
  index(product: Product): void;
  search(query: string, limit: number): { productId: string; relevance: number }[];
}

class LocalVectorStore implements VectorStore {
  index(product: Product): void {
    const db = getDb();
    const text = `${product.name} ${product.brand} ${product.category} ${product.description}`;
    const counts = new Map<string, number>();
    for (const term of tokenise(text)) counts.set(term, (counts.get(term) ?? 0) + 1);
    db.run(`DELETE FROM product_terms WHERE product_id = ?`, product.id);
    for (const [term, count] of counts) {
      db.run(
        `INSERT INTO product_terms (product_id, term, weight) VALUES (?, ?, ?)
         ON CONFLICT(product_id, term) DO UPDATE SET weight = excluded.weight`,
        product.id,
        term,
        count,
      );
    }
  }

  /** IDF-weighted overlap, normalised to [0,1] against the best-scoring match. */
  search(query: string, limit: number): { productId: string; relevance: number }[] {
    const terms = tokenise(query);
    if (terms.length === 0) return [];
    const db = getDb();
    const totalDocs = num(
      db.get<{ n: number }>(`SELECT COUNT(DISTINCT product_id) AS n FROM product_terms`)?.n,
    ) || 1;

    const scores = new Map<string, number>();
    for (const term of terms) {
      const rows = db.all(
        `SELECT product_id, weight FROM product_terms WHERE term = ?`,
        term,
      );
      if (rows.length === 0) continue;
      const idf = Math.log(1 + totalDocs / rows.length);
      for (const row of rows) {
        const id = str(row.product_id);
        scores.set(id, (scores.get(id) ?? 0) + num(row.weight) * idf);
      }
    }

    const max = Math.max(...scores.values(), 1);
    return [...scores.entries()]
      .map(([productId, raw]) => ({ productId, relevance: round(raw / max, 3) }))
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);
  }
}

const globalRef = globalThis as unknown as { __commerceVectors?: LocalVectorStore };

export function getVectorStore(): VectorStore {
  globalRef.__commerceVectors ??= new LocalVectorStore();
  return globalRef.__commerceVectors;
}

export interface RecommendationQuery {
  text: string;
  maxBudgetPaise?: number;
  category?: string;
  limit?: number;
  weights?: Partial<RankingWeights>;
}

/**
 * Ranks the catalogue against a shopper's stated need. Every component of the
 * score is returned so the UI can show why a product ranked where it did.
 */
export function recommendProducts(query: RecommendationQuery): ScoredProduct[] {
  const weights = { ...DEFAULT_WEIGHTS, ...query.weights };
  const limit = query.limit ?? 5;
  const relevanceById = new Map(
    getVectorStore().search(query.text, 40).map((r) => [r.productId, r.relevance]),
  );

  const stock = new Map(
    getDb()
      .all(`SELECT product_id, on_hand FROM inventory`)
      .map((r) => [str(r.product_id), num(r.on_hand)]),
  );
  const sold = new Map(
    getDb()
      .all(
        `SELECT oi.product_id, SUM(oi.quantity) AS units
           FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE o.created_at >= date('now', '-30 days') AND o.status != 'CANCELLED'
          GROUP BY oi.product_id`,
      )
      .map((r) => [str(r.product_id), num(r.units)]),
  );
  const maxSold = Math.max(...sold.values(), 1);

  const candidates = listProducts(500).filter((p) => {
    if (query.category && p.category.toLowerCase() !== query.category.toLowerCase()) return false;
    // A hard budget is a constraint, not a preference — never recommend over it.
    if (query.maxBudgetPaise && p.pricePaise > query.maxBudgetPaise) return false;
    return relevanceById.size === 0 || relevanceById.has(p.id);
  });

  return candidates
    .map((product) => {
      const relevance = relevanceById.get(product.id) ?? 0;
      const onHand = stock.get(product.id) ?? 0;
      const budgetFit = query.maxBudgetPaise
        ? // Best value sits just under budget, not far beneath it.
          round(Math.min(1, product.pricePaise / query.maxBudgetPaise), 3)
        : 0.5;
      const availability = onHand === 0 ? 0 : Math.min(1, onHand / 25);
      const rating = product.rating / 5;
      const margin = Math.min(1, Math.max(0, marginPct(product.pricePaise, product.costPaise) / 60));
      const popularity = (sold.get(product.id) ?? 0) / maxSold;

      const breakdown = {
        relevance: round(relevance * weights.relevance, 4),
        budgetFit: round(budgetFit * weights.budgetFit, 4),
        availability: round(availability * weights.availability, 4),
        rating: round(rating * weights.rating, 4),
        margin: round(margin * weights.margin, 4),
        popularity: round(popularity * weights.popularity, 4),
      };
      const score = round(Object.values(breakdown).reduce((s, v) => s + v, 0), 4);

      const reasons: string[] = [];
      if (relevance > 0.5) reasons.push("closely matches the stated requirement");
      if (query.maxBudgetPaise && product.pricePaise <= query.maxBudgetPaise)
        reasons.push("within budget");
      if (onHand === 0) reasons.push("out of stock — cannot ship today");
      else if (onHand < 5) reasons.push(`only ${onHand} left in stock`);
      if (product.rating >= 4.5) reasons.push(`rated ${product.rating.toFixed(1)}/5`);

      return { product, score, breakdown, reasons };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
