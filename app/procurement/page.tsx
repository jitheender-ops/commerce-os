import { getStockoutRisks, getSupplierQuotes, listPurchaseOrders, listSuppliers } from "@/database/queries";
import { formatMoney } from "@/lib/money";
import { Badge, Cell, Empty, Panel, Row, SectionTitle, Stat, Table } from "@/components/ui";

export default function ProcurementPage() {
  const suppliers = listSuppliers();
  const orders = listPurchaseOrders(20);
  const risks = getStockoutRisks().filter((r) => r.risk === "HIGH" || r.risk === "CRITICAL").slice(0, 3);
  const committed = orders
    .filter((order) => order.status === "PLACED")
    .reduce((sum, order) => sum + order.totalPaise, 0);

  return (
    <div className="space-y-5">
      <SectionTitle hint="Lead time beats unit cost when a stockout is imminent">Procurement</SectionTitle>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Suppliers" value={String(suppliers.length)} />
        <Stat label="Open orders" value={String(orders.filter((o) => o.status === "PLACED").length)} />
        <Stat label="Delayed" value={String(orders.filter((o) => o.status === "DELAYED").length)} invertDelta />
        <Stat label="Committed spend" value={formatMoney(committed)} />
      </div>

      <Panel title="Supplier panel" bodyClassName="p-0">
        <Table head={["Supplier", "Quality", "Reliability", "Lead time", "Min order"]}>
          {suppliers.map((supplier) => (
            <Row key={supplier.id}>
              <Cell>{supplier.name}</Cell>
              <Cell mono>{supplier.qualityScore.toFixed(2)}</Cell>
              <Cell mono>{supplier.reliabilityScore.toFixed(2)}</Cell>
              <Cell mono>{supplier.leadTimeDays}d</Cell>
              <Cell mono>{supplier.minimumOrderQuantity}</Cell>
            </Row>
          ))}
        </Table>
      </Panel>

      {risks.map((risk) => {
        const quotes = getSupplierQuotes(risk.productId);
        const cheapest = [...quotes].sort((a, b) => a.unitCostPaise - b.unitCostPaise)[0];
        const fastest = [...quotes].sort((a, b) => a.leadTimeDays - b.leadTimeDays)[0];
        const urgent = risk.slackDays < 0;

        return (
          <Panel
            key={risk.productId}
            title={`Quotes for ${risk.sku} — ${risk.name}`}
            subtitle={`${risk.onHand} on hand · ${risk.daysOfCover}d cover · slack ${risk.slackDays}d`}
            actions={<Badge tone={urgent ? "bad" : "warn"}>{urgent ? "lead time wins" : "cost wins"}</Badge>}
            bodyClassName="p-0"
          >
            <Table head={["Supplier", "Unit cost", "Lead time", "Min order", "Reliability", "Selected"]}>
              {quotes.map((quote) => {
                const chosen = urgent
                  ? quote.supplierId === fastest.supplierId
                  : quote.supplierId === cheapest.supplierId;
                return (
                  <Row key={quote.supplierId}>
                    <Cell>{quote.supplierName}</Cell>
                    <Cell mono>{formatMoney(quote.unitCostPaise)}</Cell>
                    <Cell mono>{quote.leadTimeDays}d</Cell>
                    <Cell mono>{quote.minimumOrderQuantity}</Cell>
                    <Cell mono>{quote.reliabilityScore.toFixed(2)}</Cell>
                    <Cell>{chosen && <Badge tone="good">would choose</Badge>}</Cell>
                  </Row>
                );
              })}
            </Table>
          </Panel>
        );
      })}

      <Panel title="Purchase orders" bodyClassName={orders.length ? "p-0" : undefined}>
        {orders.length === 0 ? (
          <Empty title="No purchase orders yet" hint="Trigger a stockout in the Simulator." />
        ) : (
          <Table head={["Order", "Product", "Qty", "Unit", "Total", "Status", "Expected"]}>
            {orders.map((order) => (
              <Row key={order.id}>
                <Cell mono className="text-[10px]">{order.id}</Cell>
                <Cell mono className="text-[11px]">{order.productId}</Cell>
                <Cell mono>{order.quantity}</Cell>
                <Cell mono>{formatMoney(order.unitCostPaise)}</Cell>
                <Cell mono>{formatMoney(order.totalPaise)}</Cell>
                <Cell>
                  <Badge tone={order.status === "DELAYED" ? "bad" : order.status === "RECEIVED" ? "good" : "neutral"}>
                    {order.status.toLowerCase()}
                  </Badge>
                </Cell>
                <Cell mono className="text-[10px]">
                  {new Date(order.expectedAt).toLocaleDateString("en-GB")}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}
