import { getStockoutRisks, listPurchaseOrders, forecastDemand } from "@/database/queries";
import { formatMoney } from "@/lib/money";
import { Cell, Empty, Panel, RiskBadge, Row, SectionTitle, Stat, Table } from "@/components/ui";

export default function InventoryPage() {
  const risks = getStockoutRisks();
  const critical = risks.filter((r) => r.risk === "CRITICAL" || r.risk === "HIGH");
  const overstock = risks.filter((r) => r.daysOfCover > 90 && r.onHand > 60);
  const orders = listPurchaseOrders(15);

  // Forecast only the SKUs that matter — one query each is enough for the view.
  const forecasts = critical.slice(0, 4).map((risk) => ({
    risk,
    forecast: forecastDemand(risk.productId, risk.leadTimeDays + 7),
  }));

  return (
    <div className="space-y-5">
      <SectionTitle hint="Risk = days of cover − supplier lead time">Inventory Intelligence</SectionTitle>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="SKUs tracked" value={String(risks.length)} />
        <Stat label="At risk" value={String(critical.length)} hint="stock out before resupply" />
        <Stat label="Overstocked" value={String(overstock.length)} hint=">90 days of cover" />
        <Stat label="Open purchase orders" value={String(orders.filter((o) => o.status === "PLACED").length)} />
      </div>

      <Panel title="Stockout risk" subtitle="Sorted by slack — the days between running out and resupply" bodyClassName="p-0">
        <Table head={["SKU", "Product", "On hand", "Velocity/day", "Cover", "Lead time", "Slack", "Risk"]}>
          {risks.slice(0, 20).map((risk) => (
            <Row key={risk.productId}>
              <Cell mono className="text-[11px]">{risk.sku}</Cell>
              <Cell>{risk.name}</Cell>
              <Cell mono>{risk.onHand}</Cell>
              <Cell mono>{risk.velocityPerDay}</Cell>
              <Cell mono>{risk.daysOfCover >= 999 ? "—" : `${risk.daysOfCover}d`}</Cell>
              <Cell mono>{risk.leadTimeDays}d</Cell>
              <Cell mono>
                <span style={{ color: risk.slackDays < 0 ? "var(--bad)" : "var(--ink)" }}>
                  {risk.slackDays >= 999 ? "—" : `${risk.slackDays}d`}
                </span>
              </Cell>
              <Cell>
                <RiskBadge risk={risk.risk} />
              </Cell>
            </Row>
          ))}
        </Table>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Demand forecast" subtitle="Weighted moving average · deterministic, not a model output">
          {forecasts.length === 0 ? (
            <Empty title="No SKU is at risk right now" />
          ) : (
            <ul className="space-y-3">
              {forecasts.map(({ risk, forecast }) => (
                <li key={risk.productId} className="panel-flush rounded-md border px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px]">
                      <span className="num" style={{ color: "var(--ink-3)" }}>{risk.sku}</span> {risk.name}
                    </span>
                    <span className="num text-[12px]">{forecast.horizonUnits} units</span>
                  </div>
                  <p className="mt-1 text-[11px]" style={{ color: "var(--ink-3)" }}>
                    {forecast.dailyForecast}/day over {risk.leadTimeDays + 7} days · confidence{" "}
                    {(forecast.confidence * 100).toFixed(0)}% · {forecast.method}
                  </p>
                  <p className="mt-1 text-[11px]" style={{ color: "var(--ink-2)" }}>
                    Recommended order: {Math.max(0, forecast.horizonUnits - risk.onHand)} units
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Purchase orders" bodyClassName={orders.length ? "p-0" : undefined}>
          {orders.length === 0 ? (
            <Empty title="No purchase orders raised" hint="Trigger a stockout in the Simulator." />
          ) : (
            <Table head={["Order", "Qty", "Unit cost", "Total", "Status", "Expected"]}>
              {orders.map((order) => (
                <Row key={order.id}>
                  <Cell mono className="text-[10px]">{order.id}</Cell>
                  <Cell mono>{order.quantity}</Cell>
                  <Cell mono>{formatMoney(order.unitCostPaise)}</Cell>
                  <Cell mono>{formatMoney(order.totalPaise)}</Cell>
                  <Cell>{order.status}</Cell>
                  <Cell mono className="text-[10px]">
                    {new Date(order.expectedAt).toLocaleDateString("en-GB")}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Panel>
      </div>
    </div>
  );
}
