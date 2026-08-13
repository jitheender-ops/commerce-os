import { getBusinessSummary, listCustomers, listTickets } from "@/database/queries";
import { getDb, num, str } from "@/database/db";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import { ShopperConsole } from "@/components/interactive";
import { Badge, Cell, Panel, Row, SectionTitle, Stat, Table } from "@/components/ui";

export default function CustomersPage() {
  const summary = getBusinessSummary();
  const customers = listCustomers(20);
  const tickets = listTickets();
  const open = tickets.filter((ticket) => ticket.status === "OPEN");
  const escalated = tickets.filter((ticket) => ticket.status === "ESCALATED");

  const segments = getDb()
    .all(
      `SELECT segment, COUNT(*) AS n, COALESCE(SUM(ltv_paise), 0) AS ltv
         FROM customers GROUP BY segment ORDER BY ltv DESC`,
    )
    .map((row) => ({
      segment: str(row.segment),
      customers: num(row.n),
      totalLtvPaise: num(row.ltv),
      avgLtvPaise: num(row.n) > 0 ? Math.round(num(row.ltv) / num(row.n)) : 0,
    }));

  const refundRate =
    summary.revenuePaise === 0 ? 0 : (summary.refundsPaise / summary.revenuePaise) * 100;

  return (
    <div className="space-y-5">
      <SectionTitle hint="Customer text is treated as untrusted input throughout">
        Customer Intelligence
      </SectionTitle>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open tickets" value={String(open.length)} invertDelta />
        <Stat label="Escalated" value={String(escalated.length)} invertDelta />
        <Stat label="Refund rate" value={`${refundRate.toFixed(2)}%`} invertDelta />
        <Stat
          label="Top segment LTV"
          value={formatMoneyCompact(segments[0]?.avgLtvPaise ?? 0)}
          hint={segments[0]?.segment}
        />
      </div>

      <ShopperConsole />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Segments" bodyClassName="p-0">
          <Table head={["Segment", "Customers", "Total LTV", "Average LTV"]}>
            {segments.map((segment) => (
              <Row key={segment.segment}>
                <Cell>{segment.segment.replace("_", " ")}</Cell>
                <Cell mono>{segment.customers}</Cell>
                <Cell mono>{formatMoneyCompact(segment.totalLtvPaise)}</Cell>
                <Cell mono>{formatMoney(segment.avgLtvPaise)}</Cell>
              </Row>
            ))}
          </Table>
        </Panel>

        <Panel title="Highest value customers" bodyClassName="p-0">
          <Table head={["Customer", "Segment", "Orders", "LTV"]}>
            {customers.slice(0, 8).map((customer) => (
              <Row key={customer.id}>
                <Cell>{customer.name}</Cell>
                <Cell className="text-[11px]">{customer.segment.replace("_", " ")}</Cell>
                <Cell mono>{customer.ordersCount}</Cell>
                <Cell mono>{formatMoneyCompact(customer.ltvPaise)}</Cell>
              </Row>
            ))}
          </Table>
        </Panel>
      </div>

      <Panel title="Ticket queue" subtitle={`${tickets.length} tickets · ${open.length} unanswered`} bodyClassName="p-0">
        <ul>
          {tickets.slice(0, 12).map((ticket) => (
            <li key={ticket.id} className="border-b px-4 py-3 last:border-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="text-[12px] font-medium">{ticket.subject}</span>
                <Badge
                  tone={
                    ticket.status === "OPEN" ? "warn" : ticket.status === "ESCALATED" ? "bad" : "good"
                  }
                >
                  {ticket.status.toLowerCase()}
                </Badge>
              </div>
              <p className="mt-1 text-[11px]" style={{ color: "var(--ink-3)" }}>
                {ticket.body}
              </p>
              {ticket.reply && (
                <p
                  className="mt-2 border-l-2 pl-3 text-[11px]"
                  style={{ borderColor: "var(--accent)", color: "var(--ink-2)" }}
                >
                  {ticket.reply}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
