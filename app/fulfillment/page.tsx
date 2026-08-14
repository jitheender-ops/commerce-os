import { listFulfillments } from "@/database/queries";
import { listJobs } from "@/events/queue";
import { describeSupplier } from "@/integrations/supplier";
import { Badge, Cell, Empty, Panel, Row, SectionTitle, Stat, Table } from "@/components/ui";
import { ActivityFeed } from "@/components/live";
import type { FulfillmentStatus } from "@/types";

const TONE: Record<FulfillmentStatus, "neutral" | "good" | "warn" | "bad"> = {
  PENDING_SUPPLIER: "warn",
  SUBMITTED: "neutral",
  SHIPPED: "good",
  EXCEPTION: "bad",
  CANCELLED: "neutral",
};

export default function FulfillmentPage() {
  const supplier = describeSupplier();
  const fulfillments = listFulfillments(undefined, 60);
  const jobs = listJobs(undefined, 60);
  const dead = jobs.filter((job) => job.status === "DEAD");
  const inQueue = jobs.filter((job) => job.status === "READY" || job.status === "RUNNING");
  const count = (status: FulfillmentStatus) =>
    String(fulfillments.filter((f) => f.status === status).length);

  return (
    <div className="space-y-5">
      <SectionTitle hint={supplier.detail}>Fulfilment</SectionTitle>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Awaiting supplier" value={count("PENDING_SUPPLIER")} />
        <Stat label="Submitted" value={count("SUBMITTED")} />
        <Stat label="Shipped" value={count("SHIPPED")} />
        <Stat label="Exceptions" value={count("EXCEPTION")} invertDelta />
        <Stat label="Queued jobs" value={String(inQueue.length)} />
      </div>

      <Panel
        title="Supplier"
        subtitle={supplier.label}
        actions={<Badge tone={supplier.live ? "good" : "warn"}>{supplier.live ? "live" : "simulated"}</Badge>}
      >
        <p className="text-[12px]" style={{ color: "var(--ink-2)" }}>
          {supplier.detail}
        </p>
      </Panel>

      <Panel title="Pipeline" subtitle="One row per order handed to the supplier" bodyClassName="p-0">
        {fulfillments.length === 0 ? (
          <Empty
            title="Nothing has been handed over yet"
            hint="The Fulfillment Agent proposes paid orders; anything above ₹50,000 of supplier cost waits for a human first."
          />
        ) : (
          <Table head={["Order", "Status", "Supplier reference", "Attempts", "Last error"]}>
            {fulfillments.map((f) => (
              <Row key={f.id}>
                <Cell mono>{f.orderId}</Cell>
                <Cell>
                  <Badge tone={TONE[f.status]}>{f.status.replace(/_/g, " ").toLowerCase()}</Badge>
                </Cell>
                <Cell mono>{f.externalId ?? "—"}</Cell>
                <Cell mono>{f.attempts}</Cell>
                <Cell>{f.lastError ?? "—"}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Panel
          title="Dead letter queue"
          subtitle="Retries exhausted — these need a decision, not another attempt"
          bodyClassName="p-0"
        >
          {dead.length === 0 ? (
            <Empty title="Empty" hint="A job is dead-lettered after three failed attempts." />
          ) : (
            <Table head={["Job", "Kind", "Attempts", "Error"]}>
              {dead.map((job) => (
                <Row key={job.id}>
                  <Cell mono>{job.id}</Cell>
                  <Cell>{job.kind}</Cell>
                  <Cell mono>{job.attempts}</Cell>
                  <Cell>{job.lastError ?? "—"}</Cell>
                </Row>
              ))}
            </Table>
          )}
        </Panel>
        <div className="xl:sticky xl:top-16 xl:self-start">
          <ActivityFeed height="h-[420px]" />
        </div>
      </div>
    </div>
  );
}
