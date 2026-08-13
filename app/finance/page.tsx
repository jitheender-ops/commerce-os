import { getDailyMetrics } from "@/database/queries";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import { Cell, Panel, Row, SectionTitle, Stat, Table } from "@/components/ui";

export default function FinancePage() {
  const metrics = getDailyMetrics(30);
  const sum = (pick: (m: (typeof metrics)[number]) => number) =>
    metrics.reduce((total, day) => total + pick(day), 0);

  const revenue = sum((m) => m.revenuePaise);
  const cogs = sum((m) => m.cogsPaise);
  const adSpend = sum((m) => m.adSpendPaise);
  const refunds = sum((m) => m.refundsPaise);
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - adSpend - refunds;

  const lines: [string, number, boolean][] = [
    ["Revenue", revenue, false],
    ["Cost of goods sold", -cogs, true],
    ["Gross profit", grossProfit, false],
    ["Marketing spend", -adSpend, true],
    ["Refunds", -refunds, true],
    ["Net profit", netProfit, false],
  ];

  return (
    <div className="space-y-5">
      <SectionTitle hint="30-day period · every figure is plain arithmetic, no model involved">
        Finance
      </SectionTitle>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Revenue" value={formatMoneyCompact(revenue)} />
        <Stat label="Gross profit" value={formatMoneyCompact(grossProfit)} hint={`${((grossProfit / revenue) * 100).toFixed(1)}% margin`} />
        <Stat label="Net profit" value={formatMoneyCompact(netProfit)} hint={`${((netProfit / revenue) * 100).toFixed(1)}% margin`} />
        <Stat label="Marketing spend" value={formatMoneyCompact(adSpend)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Profit and loss" subtitle="Trailing 30 days">
          <dl className="space-y-1.5">
            {lines.map(([label, value, indent]) => {
              const total = label === "Gross profit" || label === "Net profit";
              return (
                <div
                  key={label}
                  className={`flex justify-between py-1 ${total ? "hairline pt-2 font-medium" : ""}`}
                  style={indent ? { paddingLeft: 12 } : undefined}
                >
                  <dt className="text-[12px]" style={{ color: total ? "var(--ink)" : "var(--ink-2)" }}>
                    {label}
                  </dt>
                  <dd
                    className="num text-[12px]"
                    style={{ color: value < 0 ? "var(--ink-3)" : total ? "var(--good)" : "var(--ink)" }}
                  >
                    {formatMoney(value)}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="mt-3 text-[10px]" style={{ color: "var(--ink-3)" }}>
            Simulated business. Payments are not processed and no money moves.
          </p>
        </Panel>

        <Panel title="Daily contribution" subtitle="Last 12 days" bodyClassName="p-0">
          <Table head={["Day", "Revenue", "Gross", "Net"]}>
            {metrics.slice(-12).reverse().map((day) => {
              const gross = day.revenuePaise - day.cogsPaise;
              const net = gross - day.adSpendPaise - day.refundsPaise;
              return (
                <Row key={day.day}>
                  <Cell mono className="text-[11px]">{day.day}</Cell>
                  <Cell mono>{formatMoneyCompact(day.revenuePaise)}</Cell>
                  <Cell mono>{formatMoneyCompact(gross)}</Cell>
                  <Cell mono>
                    <span style={{ color: net < 0 ? "var(--bad)" : "var(--ink)" }}>
                      {formatMoneyCompact(net)}
                    </span>
                  </Cell>
                </Row>
              );
            })}
          </Table>
        </Panel>
      </div>
    </div>
  );
}
