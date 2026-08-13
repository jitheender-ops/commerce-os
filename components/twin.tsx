/**
 * Digital business twin.
 *
 * A live model of the funnel. Only the stages the system actually measures show
 * a number; the two this simulation does not instrument (product discovery and
 * cart) say so rather than displaying a plausible invention. That gap is the
 * honest version of a funnel diagram, and it is also exactly what an operator
 * would want flagged.
 */
import { getDb, num } from "@/database/db";
import { getBusinessSummary, getDailyMetrics } from "@/database/queries";
import { Panel } from "@/components/ui";
import { pct } from "@/lib/money";

interface Stage {
  name: string;
  value: number | null;
  note: string;
  /** Conversion from the previous measured stage. */
  rate?: number;
  tone?: "good" | "warn" | "bad";
}

export function BusinessTwin() {
  const summary = getBusinessSummary();
  const latest = getDailyMetrics(30).at(-1);
  const db = getDb();

  const counts = db.get<{
    delivered: number;
    shipped: number;
    returned: number;
    cancelled: number;
  }>(`SELECT
        SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN status = 'SHIPPED'   THEN 1 ELSE 0 END) AS shipped,
        SUM(CASE WHEN status = 'RETURNED'  THEN 1 ELSE 0 END) AS returned,
        SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled
      FROM orders WHERE created_at >= date('now', '-7 days')`);

  const customers = num(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM customers`)?.n);
  const sessions = latest?.sessions ?? 0;
  const failures = latest?.mobilePaymentFailures ?? 0;
  const orders = summary.orders;
  const checkoutAttempts = orders + failures;

  const stages: Stage[] = [
    { name: "Customers", value: customers, note: "registered accounts" },
    { name: "Traffic", value: sessions, note: "sessions on the latest day" },
    { name: "Product discovery", value: null, note: "not instrumented in this simulation" },
    { name: "Cart", value: null, note: "not instrumented in this simulation" },
    {
      name: "Checkout",
      value: checkoutAttempts,
      note: "orders placed plus failed payment attempts",
      rate: pct(checkoutAttempts, sessions),
    },
    {
      name: "Payment",
      value: orders,
      note: `${failures} failed at payment`,
      rate: pct(orders, checkoutAttempts),
      tone: failures > orders * 0.1 ? "bad" : "good",
    },
    { name: "Order", value: orders, note: "paid and accepted", rate: 100 },
    {
      name: "Fulfilment",
      value: num(counts?.shipped) + num(counts?.delivered),
      note: "shipped or delivered, last 7 days",
    },
    { name: "Delivery", value: num(counts?.delivered), note: "delivered, last 7 days" },
    {
      name: "Returns",
      value: num(counts?.returned),
      note: "returned, last 7 days",
      tone: num(counts?.returned) > num(counts?.delivered) * 0.06 ? "warn" : "good",
    },
  ];

  const peak = Math.max(...stages.map((stage) => stage.value ?? 0), 1);

  return (
    <Panel
      title="Digital business twin"
      subtitle="Live funnel state · unmeasured stages are marked, not estimated"
    >
      <ol className="space-y-1.5">
        {stages.map((stage) => {
          const measured = stage.value !== null;
          const width = measured ? Math.max(4, (stage.value! / peak) * 100) : 0;
          const color =
            stage.tone === "bad"
              ? "var(--bad)"
              : stage.tone === "warn"
                ? "var(--warn)"
                : stage.tone === "good"
                  ? "var(--good)"
                  : "var(--accent)";

          return (
            <li key={stage.name} className="grid grid-cols-[104px_1fr_auto] items-center gap-3">
              <span className="text-[11px]" style={{ color: measured ? "var(--ink-2)" : "var(--ink-3)" }}>
                {stage.name}
              </span>

              <div className="relative h-6">
                {measured ? (
                  <div
                    className="h-full rounded-sm transition-[width] duration-700"
                    style={{
                      width: `${width}%`,
                      background: `color-mix(in srgb, ${color} 22%, transparent)`,
                      borderLeft: `2px solid ${color}`,
                    }}
                  />
                ) : (
                  <div
                    className="h-full rounded-sm border border-dashed"
                    style={{ width: "18%", borderColor: "var(--line-strong)" }}
                  />
                )}
                <span
                  className="absolute inset-y-0 left-2 flex items-center text-[10px]"
                  style={{ color: "var(--ink-3)" }}
                >
                  {stage.note}
                </span>
              </div>

              <span className="num w-20 text-right text-[12px]">
                {measured ? (
                  <>
                    {stage.value!.toLocaleString("en-IN")}
                    {stage.rate !== undefined && (
                      <span className="ml-1.5 text-[10px]" style={{ color: "var(--ink-3)" }}>
                        {stage.rate.toFixed(1)}%
                      </span>
                    )}
                  </>
                ) : (
                  <span style={{ color: "var(--ink-3)" }}>—</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
