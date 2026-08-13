import { listInventory, listProducts } from "@/database/queries";
import { formatMoney, marginPct } from "@/lib/money";
import { Badge, Cell, Panel, Row, SectionTitle, Stat, Table } from "@/components/ui";

export default function ProductsPage() {
  const stock = new Map(listInventory().map((item) => [item.productId, item.onHand]));
  const products = listProducts(60);
  const categories = new Set(products.map((product) => product.category));
  const inventoryValue = products.reduce(
    (sum, product) => sum + product.costPaise * (stock.get(product.id) ?? 0),
    0,
  );

  return (
    <div className="space-y-5">
      <SectionTitle hint="The catalogue every agent queries">Product Catalogue</SectionTitle>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Products" value={String(products.length)} />
        <Stat label="Categories" value={String(categories.size)} />
        <Stat label="Units in stock" value={String([...stock.values()].reduce((a, b) => a + b, 0))} />
        <Stat label="Inventory at cost" value={formatMoney(inventoryValue)} />
      </div>

      <Panel title="Catalogue" bodyClassName="p-0">
        <Table head={["SKU", "Product", "Category", "Cost", "Price", "Margin", "Market", "Stock", "Rating"]}>
          {products.map((product) => {
            const margin = marginPct(product.pricePaise, product.costPaise);
            const onHand = stock.get(product.id) ?? 0;
            return (
              <Row key={product.id}>
                <Cell mono className="text-[11px]">{product.sku}</Cell>
                <Cell>
                  <span className="text-[12px]">{product.name}</span>
                  <span className="block text-[10px]" style={{ color: "var(--ink-3)" }}>
                    {product.brand}
                  </span>
                </Cell>
                <Cell className="text-[11px]">{product.category}</Cell>
                <Cell mono>{formatMoney(product.costPaise)}</Cell>
                <Cell mono>{formatMoney(product.pricePaise)}</Cell>
                <Cell mono>{margin.toFixed(1)}%</Cell>
                <Cell mono>{formatMoney(product.competitorPricePaise)}</Cell>
                <Cell>
                  <Badge tone={onHand === 0 ? "bad" : onHand < 20 ? "warn" : "neutral"}>{onHand}</Badge>
                </Cell>
                <Cell mono>{product.rating.toFixed(1)}</Cell>
              </Row>
            );
          })}
        </Table>
      </Panel>
    </div>
  );
}
