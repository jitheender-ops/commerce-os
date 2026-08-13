import { AGENTS, AGENT_IDS } from "@/agents/definitions";
import { POLICY_RULES } from "@/policies/rules";
import { listTools } from "@/tools/definitions";
import { PLAN_TEMPLATES } from "@/orchestration/plans";
import { describeEngine } from "@/ai/gateway";
import { getState } from "@/database/queries";
import { formatMoney } from "@/lib/money";
import { Badge, Cell, Panel, Row, SectionTitle, Table } from "@/components/ui";

const AUTONOMY = [
  "L0 — manual",
  "L1 — recommend only",
  "L2 — execute with approval",
  "L3 — bounded autonomy",
  "L4 — full autonomy",
];

export default function SettingsPage() {
  const engine = describeEngine();
  const tools = listTools();
  const seededAt = getState("seeded_at");

  return (
    <div className="space-y-5">
      <SectionTitle hint="Everything the platform enforces, in one place">System Settings</SectionTitle>

      <Panel title="Reasoning engine" subtitle="What produces the prose, and what does not">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={engine.mode === "hosted" ? "good" : "warn"} dot>
            {engine.label}
          </Badge>
          <span className="text-[12px]" style={{ color: "var(--ink-2)" }}>
            {engine.detail}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="panel-flush rounded-md border px-3 py-2.5">
            <h3 className="text-[11px] font-medium">Always deterministic</h3>
            <ul className="mt-1 space-y-0.5 text-[11px]" style={{ color: "var(--ink-3)" }}>
              <li>Every figure — margin, ROAS, forecast, profit</li>
              <li>Every policy, permission, budget and risk decision</li>
              <li>Every state change</li>
              <li>Plan construction and task routing</li>
            </ul>
          </div>
          <div className="panel-flush rounded-md border px-3 py-2.5">
            <h3 className="text-[11px] font-medium">Model, when configured</h3>
            <ul className="mt-1 space-y-0.5 text-[11px]" style={{ color: "var(--ink-3)" }}>
              <li>Ranking competing explanations</li>
              <li>Explaining evidence in prose</li>
              <li>Customer replies and campaign copy</li>
              <li>Summarising across agents</li>
            </ul>
          </div>
        </div>
        <p className="mt-3 text-[11px]" style={{ color: "var(--ink-3)" }}>
          Configure a hosted model by setting <span className="num">AI_BASE_URL</span>,{" "}
          <span className="num">AI_API_KEY</span> and <span className="num">AI_MODEL</span> — any
          OpenAI-compatible free tier works. Nothing runs on this machine either way.
          {seededAt && (
            <>
              {" "}Demo data seeded{" "}
              <span className="num">{new Date(seededAt).toLocaleString("en-GB", { hour12: false })}</span>.
            </>
          )}
        </p>
      </Panel>

      <Panel title="Autonomy" subtitle="How far each agent may act without a human" bodyClassName="p-0">
        <Table head={["Agent", "Level", "Meaning", "Daily spend authority"]}>
          {AGENT_IDS.map((id) => (
            <Row key={id}>
              <Cell>
                <span style={{ color: AGENTS[id].color }}>{AGENTS[id].name}</span>
              </Cell>
              <Cell mono>L{AGENTS[id].autonomy}</Cell>
              <Cell className="text-[11px]">{AUTONOMY[AGENTS[id].autonomy].split("— ")[1]}</Cell>
              <Cell mono>
                {AGENTS[id].dailyBudgetPaise === 0 ? "—" : formatMoney(AGENTS[id].dailyBudgetPaise)}
              </Cell>
            </Row>
          ))}
        </Table>
      </Panel>

      <Panel title="Policies" subtitle="Deterministic rules — never evaluated by a model" bodyClassName="p-0">
        <Table head={["ID", "Category", "Rule", "Limit"]}>
          {POLICY_RULES.map((rule) => (
            <Row key={rule.id}>
              <Cell mono className="text-[11px]">{rule.id}</Cell>
              <Cell>
                <Badge tone={rule.category === "security" ? "bad" : "neutral"}>{rule.category}</Badge>
              </Cell>
              <Cell className="text-[11px]">{rule.description}</Cell>
              <Cell mono className="text-[11px]">{rule.limit}</Cell>
            </Row>
          ))}
        </Table>
      </Panel>

      <Panel title="Tool registry" subtitle={`${tools.length} typed tools · agents have no other capability`} bodyClassName="p-0">
        <Table head={["Tool", "Permission", "Writes", "Risk", "Description"]}>
          {tools.map((tool) => (
            <Row key={tool.name}>
              <Cell mono className="text-[11px]">{tool.name}</Cell>
              <Cell mono className="text-[10px]">{tool.permission}</Cell>
              <Cell>
                {tool.mutates ? <Badge tone="warn">writes</Badge> : <Badge tone="neutral">read</Badge>}
              </Cell>
              <Cell className="text-[10px]">
                {typeof tool.risk === "string" ? tool.risk : "per call"}
              </Cell>
              <Cell className="text-[11px]">{tool.description}</Cell>
            </Row>
          ))}
        </Table>
      </Panel>

      <Panel title="Plan templates" subtitle="Goal and event decomposition is deterministic by design" bodyClassName="p-0">
        <Table head={["Plan", "Triggers", "Task graph"]}>
          {PLAN_TEMPLATES.map((template) => (
            <Row key={template.id}>
              <Cell>{template.title}</Cell>
              <Cell className="text-[10px]">
                {template.triggers.length ? template.triggers.join(", ").toLowerCase() : "goal or question"}
              </Cell>
              <Cell className="text-[11px]">
                {template.tasks
                  .map((task) =>
                    task.dependsOn.length ? `${task.agentId}←(${task.dependsOn.join(",")})` : task.agentId,
                  )
                  .join("  ")}
              </Cell>
            </Row>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
