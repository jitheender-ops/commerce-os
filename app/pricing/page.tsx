import { getPricingHistory, listProducts } from "@/database/queries";
import { POLICY_LIMITS } from "@/policies/rules";
import { formatMoney, marginPct } from "@/lib/money";
import { PricingSimulator } from "@/components/interactive";
import { Badge, Cell, Empty, Panel, Row, SectionTitle, Stat, Table } from "@/components/ui";

export default function PricingPage() {
  const products = listProducts(50).map((product) => ({
    ...product,
    marginPercent: Number(marginPct(product.pricePaise, product.costPaise).toFixed(1)),
    gapPercent: Number(
      (((product.pricePaise - product.competitorPricePaise) / product.competitorPricePaise) * 100).toFixed(1),
    ),
  }));
  const history = getPricingHistory(undefined, 20);
  const above = products.filter((p) => p.gapPercent > 6);
  const below = products.filter((p) => p.gapPercent < -8);
  const thin = products.filter((p) => p.marginPercent < POLICY_LIMITS.pricing.minimumMarginPercent + 5);

  return (
    <div className="space-y-5">
      <SectionTitle
        hint={`Margin floor ${POLICY_LIMITS.pricing.minimumMarginPercent}% · step limit ${POLICY_LIMITS.pricing.maxPriceChangePercent}%`}
      >
        Pricing Intelligence
      </SectionTitle>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Products priced" value={String(products.length)} />
        <Stat label="Above market >6%" value={String(above.length)} />
        <Stat label="Below market >8%" value={String(below.length)} />
        <Stat label="Thin margin" value={String(thin.length)} hint="within 5pts of the floor" />
      </div>

      <PricingSimulator products={products} />

      <Panel title="Competitive position" subtitle="Positive gap means we are more expensive" bodyClassName="p-0">
        <Table head={["SKU", "Product", "Our price", "Market", "Gap", "Margin", "Headroom"]}>
          {[...products]
            .sort((a, b) => Math.abs(b.gapPercent) - Math.abs(a.gapPercent))
            .slice(0, 15)
            .map((product) => (
              <Row key={product.id}>
                <Cell mono className="text-[11px]">{product.sku}</Cell>
                <Cell>{product.name}</Cell>
                <Cell mono>{formatMoney(product.pricePaise)}</Cell>
                <Cell mono>{formatMoney(product.competitorPricePaise)}</Cell>
                <Cell mono>
                  <span style={{ color: product.gapPercent > 0 ? "var(--warn)" : "var(--good)" }}>
                    {product.gapPercent > 0 ? "+" : ""}
                    {product.gapPercent}%
                  </span>
                </Cell>
                <Cell mono>{product.marginPercent}%</Cell>
                <Cell>
                  <Badge
                    tone={
                      product.marginPercent > POLICY_LIMITS.pricing.minimumMarginPercent + 10
                        ? "good"
                        : product.marginPercent > POLICY_LIMITS.pricing.minimumMarginPercent
                          ? "warn"
                          : "bad"
                    }
                  >
                    {(product.marginPercent - POLICY_LIMITS.pricing.minimumMarginPercent).toFixed(0)}pts
                  </Badge>
                </Cell>
              </Row>
            ))}
        </Table>
      </Panel>

      <Panel title="Price changes" subtitle="Every change an agent made, with its reason" bodyClassName={history.length ? "p-0" : undefined}>
        {history.length === 0 ? (
          <Empty
            title="No price changes yet"
            hint="Trigger a competitor price drop in the Simulator to see the Pricing Agent act."
          />
        ) : (
          <Table head={["When", "Product", "From", "To", "Agent", "Reason"]}>
            {history.map((entry) => (
              <Row key={entry.id}>
                <Cell mono className="text-[10px]">
                  {new Date(entry.createdAt).toLocaleString("en-GB", { hour12: false })}
                </Cell>
                <Cell mono className="text-[11px]">{entry.productId}</Cell>
                <Cell mono>{formatMoney(entry.oldPricePaise)}</Cell>
                <Cell mono>{formatMoney(entry.newPricePaise)}</Cell>
                <Cell>{entry.agentId}</Cell>
                <Cell className="text-[11px]">{entry.reason}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}
