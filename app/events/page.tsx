import { getBus } from "@/events/bus";
import { PLAN_TEMPLATES } from "@/orchestration/plans";
import { ActivityFeed } from "@/components/live";
import { Badge, Cell, Empty, Panel, Row, SectionTitle, Table } from "@/components/ui";

export default function EventsPage() {
  const events = getBus().recent(60);

  return (
    <div className="space-y-5">
      <SectionTitle hint="Persisted domain events · lifecycle chatter streams live but is not stored">
        Event Stream
      </SectionTitle>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Panel title="Recorded events" bodyClassName={events.length ? "p-0" : undefined}>
            {events.length === 0 ? (
              <Empty title="No events recorded yet" hint="Trigger a scenario from the Simulator." />
            ) : (
              <Table head={["Time", "Type", "Source", "Detail"]}>
                {events.map((event) => {
                  const payload = event.payload as Record<string, unknown>;
                  return (
                    <Row key={event.id}>
                      <Cell mono className="text-[10px]">
                        {new Date(event.createdAt).toLocaleTimeString("en-GB", { hour12: false })}
                      </Cell>
                      <Cell>
                        <Badge tone="accent">{event.type.replace(/_/g, " ").toLowerCase()}</Badge>
                      </Cell>
                      <Cell className="text-[11px]">{event.source}</Cell>
                      <Cell className="text-[11px]" >
                        {typeof payload.summary === "string"
                          ? payload.summary
                          : Object.entries(payload)
                              .filter(([key]) => key !== "result")
                              .slice(0, 3)
                              .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
                              .join(" · ")}
                      </Cell>
                    </Row>
                  );
                })}
              </Table>
            )}
          </Panel>

          <Panel title="Event routing" subtitle="Which plan each event type selects" bodyClassName="p-0">
            <Table head={["Event", "Plan", "Agents in order"]}>
              {PLAN_TEMPLATES.filter((template) => template.triggers.length > 0).map((template) => (
                <Row key={template.id}>
                  <Cell className="text-[11px]">
                    {template.triggers.map((trigger) => (
                      <span key={trigger} className="mr-1 inline-block">
                        {trigger.toLowerCase()}
                      </span>
                    ))}
                  </Cell>
                  <Cell>{template.title}</Cell>
                  <Cell className="text-[11px]">
                    {template.tasks.map((task) => task.agentId).join(" → ")}
                  </Cell>
                </Row>
              ))}
            </Table>
          </Panel>
        </div>

        <div className="xl:sticky xl:top-16 xl:self-start">
          <ActivityFeed height="h-[640px]" />
        </div>
      </div>
    </div>
  );
}
