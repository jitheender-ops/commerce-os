"use client";

/**
 * The interactive surfaces: approval queue, scenario simulator, the scripted
 * demo, goal creation, the pricing simulator, memory management and the shopper
 * console. Each one drives a real API route — none of them fake a result.
 */
import { useEffect, useState } from "react";
import { AGENTS } from "@/agents/definitions";
import { AgentFindings } from "@/components/ask";
import { Badge, Empty, Estimated, Meter, Panel, RiskBadge, Table, Row, Cell } from "@/components/ui";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import type { AgentResult, Approval, MemoryRecord, Product } from "@/types";

const button =
  "rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40";

// ─── Approvals ───────────────────────────────────────────────────────────────

export function ApprovalQueue({ initial }: { initial: (Approval & { policy?: { id: string; description: string; limit: string } | null })[] }) {
  const [approvals, setApprovals] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  async function resolve(id: string, decision: "approve" | "reject") {
    setBusy(id);
    setOutcome(null);
    try {
      const response = await fetch(`/api/approvals/${id}/${decision}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ by: "operator" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Failed");

      setApprovals((current) => current.filter((approval) => approval.id !== id));
      setOutcome({
        id,
        ok: decision === "approve" ? payload.execution?.status === "COMPLETED" : true,
        text:
          decision === "approve"
            ? `Executed: ${payload.execution?.status}${payload.execution?.error ? ` — ${payload.execution.error}` : ""}`
            : "Rejected. Nothing was executed and the agent was told why.",
      });
    } catch (error) {
      setOutcome({ id, ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  if (approvals.length === 0) {
    return (
      <>
        {outcome && <Outcome outcome={outcome} />}
        <Panel title="Approval queue">
          <Empty
            title="Nothing waiting for a human"
            hint="Actions inside policy execute on their own; anything above the limits lands here."
          />
        </Panel>
      </>
    );
  }

  return (
    <div className="space-y-3">
      {outcome && <Outcome outcome={outcome} />}
      {/* Operators and judges ask the same question before clicking Approve.
          Answer it next to the button, not in the README. */}
      <p className="px-1 text-[11px]" style={{ color: "var(--ink-3)" }}>
        Approving executes against the simulated business only — no supplier, payment
        processor or ad platform is contacted, and no real money moves.
      </p>
      {approvals.map((approval) => (
        <Panel
          key={approval.id}
          spine="ask"
          title={approval.title}
          subtitle={`${AGENTS[approval.agentId].name} · ${approval.entityType} ${approval.entityId}`}
          actions={<RiskBadge risk={approval.risk} />}
        >
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Field label="Reason">{approval.reason}</Field>
            <Field label="Financial impact">
              <span className="num">{formatMoney(approval.financialImpactPaise)}</span>
            </Field>
            <Field label="Policy triggered">
              {approval.policy ? `${approval.policy.id} — ${approval.policy.description} (${approval.policy.limit})` : approval.policyId ?? "None"}
            </Field>
            <Field label="Expected outcome">{approval.expectedOutcome}</Field>
          </dl>

          <details className="mt-3">
            <summary className="cursor-pointer text-[11px]" style={{ color: "var(--ink-3)" }}>
              Inspect the exact call
            </summary>
            <pre
              className="num mt-2 overflow-x-auto rounded-md border p-3 text-[11px]"
              style={{ background: "var(--panel-2)" }}
            >
              {approval.toolName}({JSON.stringify(approval.input, null, 2)})
            </pre>
          </details>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className={button}
              style={{ background: "var(--good)", color: "#04140d" }}
              disabled={busy === approval.id}
              onClick={() => void resolve(approval.id, "approve")}
            >
              {busy === approval.id ? "Executing…" : "Approve"}
            </button>
            <button
              type="button"
              className={`${button} border`}
              style={{ color: "var(--bad)", borderColor: "var(--bad)" }}
              disabled={busy === approval.id}
              onClick={() => void resolve(approval.id, "reject")}
            >
              Reject
            </button>
          </div>
        </Panel>
      ))}
    </div>
  );
}

const Outcome = ({ outcome }: { outcome: { text: string; ok: boolean } }) => (
  <div
    className="panel px-4 py-2.5 text-[12px]"
    style={{ borderColor: outcome.ok ? "var(--good)" : "var(--bad)" }}
  >
    {outcome.text}
  </div>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <dt className="caps">{label}</dt>
    <dd className="mt-0.5 text-[12px]" style={{ color: "var(--ink-2)" }}>
      {children}
    </dd>
  </div>
);

// ─── Scenario simulator ──────────────────────────────────────────────────────

interface Scenario {
  id: string;
  label: string;
  description: string;
  expect: string;
}

export function ScenarioRunner({ scenarios }: { scenarios: Scenario[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [run, setRun] = useState<{ summary: string; label: string; expect: string; results: AgentResult[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fire(id: string) {
    setBusy(id);
    setError(null);
    setRun(null);
    try {
      const response = await fetch("/api/events/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario: id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Failed");
      setRun({
        summary: payload.summary,
        label: payload.scenario.label,
        expect: payload.scenario.expect,
        results: payload.plan?.results ?? [],
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Panel title="Business event simulator" subtitle="Each button writes a real change, then the matching plan runs">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {scenarios.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void fire(scenario.id)}
              className="panel-flush rounded-md border p-3 text-left transition-colors hover:border-[var(--accent)] disabled:opacity-40"
            >
              <div className="text-[12px] font-medium">{scenario.label}</div>
              <div className="mt-1 text-[11px] leading-snug" style={{ color: "var(--ink-3)" }}>
                {scenario.description}
              </div>
              {busy === scenario.id && (
                <div className="mt-2 text-[10px]" style={{ color: "var(--accent)" }}>
                  Agents working…
                </div>
              )}
            </button>
          ))}
        </div>
      </Panel>

      {error && (
        <Panel title="Scenario failed">
          <p className="text-[12px]" style={{ color: "var(--bad)" }}>
            {error}
          </p>
        </Panel>
      )}

      {run && (
        <>
          <Panel title={run.label} subtitle="What changed in the data">
            <p className="text-[12px]">{run.summary}</p>
            <p className="mt-1.5 text-[11px]" style={{ color: "var(--ink-3)" }}>
              Expected response: {run.expect}
            </p>
          </Panel>
          <AgentFindings results={run.results} />
        </>
      )}
    </div>
  );
}

// ─── Scripted demo ───────────────────────────────────────────────────────────

interface StoryStep {
  key: string;
  title: string;
  detail: string;
  summary: string;
  facts: string[];
  results: AgentResult[];
}

export function DemoStory() {
  const [busy, setBusy] = useState(false);
  const [story, setStory] = useState<{
    steps: StoryStep[];
    before: Record<string, number>;
    after: Record<string, number>;
    pendingApprovals: Approval[];
    disclaimer: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    setStory(null);
    try {
      const response = await fetch("/api/simulation/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Failed");
      setStory(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Panel
        title="One-click demo"
        subtitle="Resets the business, injects three faults, and runs the full loop"
        actions={
          <button
            type="button"
            className={button}
            style={{ background: "var(--accent)", color: "#fff" }}
            disabled={busy}
            onClick={() => void start()}
          >
            {busy ? "Running…" : "Start hackathon demo"}
          </button>
        }
      >
        <p className="text-[12px]" style={{ color: "var(--ink-2)" }}>
          Only the disruption is scripted. Everything after it is the ordinary system: the same event
          bus, plan templates, agents and governance you can drive by hand from the panels above.
        </p>
      </Panel>

      {error && (
        <Panel title="Demo failed">
          <p className="text-[12px]" style={{ color: "var(--bad)" }}>
            {error}
          </p>
        </Panel>
      )}

      {story && (
        <>
          <ol className="space-y-3">
            {story.steps.map((step, index) => (
              <li key={step.key}>
                <Panel
                  title={
                    <span className="flex items-center gap-2">
                      <span
                        className="num grid h-5 w-5 place-items-center rounded-full text-[10px]"
                        style={{ background: "var(--panel-2)", color: "var(--accent)" }}
                      >
                        {index + 1}
                      </span>
                      {step.title}
                    </span>
                  }
                  subtitle={step.detail}
                >
                  <p className="text-[12px] font-medium">{step.summary}</p>
                  {step.facts.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {step.facts.map((fact, factIndex) => (
                        <li key={factIndex} className="num text-[11px]" style={{ color: "var(--ink-3)" }}>
                          {fact}
                        </li>
                      ))}
                    </ul>
                  )}
                  {step.results.length > 0 && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-[11px]" style={{ color: "var(--accent)" }}>
                        Show the {step.results.length} agent findings behind this
                      </summary>
                      <div className="mt-3">
                        <AgentFindings results={step.results} />
                      </div>
                    </details>
                  )}
                </Panel>
              </li>
            ))}
          </ol>

          <Panel title="Business impact" subtitle="Before and after, measured from the same tables">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["Revenue", "revenuePaise", true],
                ["Profit", "profitPaise", true],
                ["Conversion %", "conversionRate", false],
                ["At-risk SKUs", "inventoryRisks", false],
              ].map(([label, key, money]) => (
                <div key={String(key)} className="panel-flush rounded-md border px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.07em]" style={{ color: "var(--ink-3)" }}>
                    {label}
                  </div>
                  <div className="num mt-1 text-[13px]">
                    {money ? formatMoneyCompact(story.before[String(key)]) : story.before[String(key)]}
                    <span style={{ color: "var(--ink-3)" }}> → </span>
                    {money ? formatMoneyCompact(story.after[String(key)]) : story.after[String(key)]}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px]" style={{ color: "var(--warn)" }}>
              {story.disclaimer}
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}

// ─── Goals ───────────────────────────────────────────────────────────────────

export function GoalForm() {
  const [statement, setStatement] = useState("Increase profit by 15% without increasing ad spend");
  const [metric, setMetric] = useState("profit");
  const [target, setTarget] = useState(15);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<AgentResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const response = await fetch("/api/goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          statement,
          metric,
          targetPercent: target,
          constraints: statement.toLowerCase().includes("without increasing ad spend")
            ? ["No increase in advertising spend"]
            : [],
          deadlineDays: 30,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Failed");
      setResults(payload.plan?.results ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Panel title="Set a business goal" subtitle="The goal selects a plan; the plan runs immediately">
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label htmlFor="statement" className="text-[11px]" style={{ color: "var(--ink-3)" }}>
              Goal
            </label>
            <input
              id="statement"
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
              className="panel-flush mt-1 w-full rounded-md border px-3 py-2 text-[13px] outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <div>
              <label htmlFor="metric" className="text-[11px]" style={{ color: "var(--ink-3)" }}>
                Metric
              </label>
              <select
                id="metric"
                value={metric}
                onChange={(event) => setMetric(event.target.value)}
                className="panel-flush mt-1 block rounded-md border px-3 py-2 text-[12px] outline-none"
              >
                {["profit", "revenue", "conversion", "margin", "stockouts", "refund_rate"].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="target" className="text-[11px]" style={{ color: "var(--ink-3)" }}>
                Target change %
              </label>
              <input
                id="target"
                type="number"
                value={target}
                onChange={(event) => setTarget(Number(event.target.value))}
                className="panel-flush mt-1 block w-24 rounded-md border px-3 py-2 text-[12px] outline-none"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={busy}
                className={button}
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                {busy ? "Agents working…" : "Create goal and run"}
              </button>
            </div>
          </div>
        </form>
      </Panel>

      {error && (
        <Panel title="Goal failed">
          <p className="text-[12px]" style={{ color: "var(--bad)" }}>
            {error}
          </p>
        </Panel>
      )}
      {results && <AgentFindings results={results} title="What the agents found" />}
    </div>
  );
}

// ─── Pricing simulator ───────────────────────────────────────────────────────

interface SimulationResponse {
  before: { pricePaise: number; units: number; revenuePaise: number; profitPaise: number; marginPercent: number };
  after: { pricePaise: number; units: number; revenuePaise: number; profitPaise: number; marginPercent: number };
  policy: { withinMarginFloor: boolean; withinStepLimit: boolean; changePercent: number };
  basis: string;
}

export function PricingSimulator({ products }: { products: Product[] }) {
  // Product and price live in one piece of state because the price is only
  // meaningful against its product. Splitting them forces a sync effect that
  // briefly renders one product's price under another product.
  const [draft, setDraft] = useState({
    productId: products[0]?.id ?? "",
    pricePaise: products[0]?.pricePaise ?? 0,
  });
  const [elasticity, setElasticity] = useState(-1.4);
  const [result, setResult] = useState<SimulationResponse | null>(null);

  const { productId, pricePaise } = draft;
  const product = products.find((p) => p.id === productId);

  const selectProduct = (id: string) => {
    const next = products.find((p) => p.id === id);
    setDraft({ productId: id, pricePaise: next?.pricePaise ?? 0 });
  };
  const setPricePaise = (value: number) =>
    setDraft((current) => ({ ...current, pricePaise: value }));

  useEffect(() => {
    if (!productId || !pricePaise) return;
    const timer = setTimeout(async () => {
      const response = await fetch("/api/pricing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId, newPricePaise: Math.round(pricePaise), elasticity }),
      });
      if (response.ok) setResult(await response.json());
    }, 220);
    return () => clearTimeout(timer);
  }, [productId, pricePaise, elasticity]);

  return (
    <Panel
      title="Pricing simulator"
      subtitle="Constant-elasticity projection over trailing demand"
      actions={<Estimated />}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div>
            <label htmlFor="sim-product" className="text-[11px]" style={{ color: "var(--ink-3)" }}>
              Product
            </label>
            <select
              id="sim-product"
              value={productId}
              onChange={(event) => selectProduct(event.target.value)}
              className="panel-flush mt-1 w-full rounded-md border px-3 py-2 text-[12px] outline-none"
            >
              {products.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.sku} · {option.name}
                </option>
              ))}
            </select>
          </div>

          {product && (
            <>
              <div>
                <label htmlFor="sim-price" className="text-[11px]" style={{ color: "var(--ink-3)" }}>
                  Price · <span className="num">{formatMoney(pricePaise)}</span>{" "}
                  <span style={{ color: "var(--ink-3)" }}>
                    (cost {formatMoney(product.costPaise)}, market {formatMoney(product.competitorPricePaise)})
                  </span>
                </label>
                <input
                  id="sim-price"
                  type="range"
                  min={Math.round(product.costPaise * 1.05)}
                  max={Math.round(product.pricePaise * 1.6)}
                  step={100}
                  value={pricePaise}
                  onChange={(event) => setPricePaise(Number(event.target.value))}
                  className="mt-2 w-full"
                />
              </div>
              <div>
                <label htmlFor="sim-elasticity" className="text-[11px]" style={{ color: "var(--ink-3)" }}>
                  Demand elasticity · <span className="num">{elasticity.toFixed(1)}</span>
                </label>
                <input
                  id="sim-elasticity"
                  type="range"
                  min={-3}
                  max={-0.2}
                  step={0.1}
                  value={elasticity}
                  onChange={(event) => setElasticity(Number(event.target.value))}
                  className="mt-2 w-full"
                />
              </div>
            </>
          )}
        </div>

        <div>
          {result ? (
            <>
              <Table head={["", "Now", "Projected"]}>
                {[
                  ["Units / month", result.before.units.toFixed(1), result.after.units.toFixed(1)],
                  ["Revenue", formatMoneyCompact(result.before.revenuePaise), formatMoneyCompact(result.after.revenuePaise)],
                  ["Profit", formatMoneyCompact(result.before.profitPaise), formatMoneyCompact(result.after.profitPaise)],
                  ["Margin", `${result.before.marginPercent}%`, `${result.after.marginPercent}%`],
                ].map(([label, before, after]) => (
                  <Row key={label}>
                    <Cell className="text-[11px]">{label}</Cell>
                    <Cell mono>{before}</Cell>
                    <Cell mono>{after}</Cell>
                  </Row>
                ))}
              </Table>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone={result.policy.withinMarginFloor ? "good" : "bad"}>
                  margin floor {result.policy.withinMarginFloor ? "ok" : "breached"}
                </Badge>
                <Badge tone={result.policy.withinStepLimit ? "good" : "bad"}>
                  step limit {result.policy.withinStepLimit ? "ok" : `breached (${result.policy.changePercent}%)`}
                </Badge>
              </div>
              <p className="mt-2 text-[10px]" style={{ color: "var(--warn)" }}>
                {result.basis}
              </p>
            </>
          ) : (
            <Empty title="Move the price slider to project an outcome" />
          )}
        </div>
      </div>
    </Panel>
  );
}

// ─── Memory ──────────────────────────────────────────────────────────────────

export function MemoryPanel({ initial }: { initial: MemoryRecord[] }) {
  const [memories, setMemories] = useState(initial);
  const [busy, setBusy] = useState(false);

  const byKind = memories.reduce<Record<string, MemoryRecord[]>>((acc, memory) => {
    (acc[memory.kind] ??= []).push(memory);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <Panel
        title="Agent memory"
        subtitle={`${memories.length} records across ${Object.keys(byKind).length} layers`}
        actions={
          <button
            type="button"
            disabled={busy || memories.length === 0}
            className={`${button} border`}
            style={{ color: "var(--bad)", borderColor: "var(--bad)" }}
            onClick={async () => {
              setBusy(true);
              await fetch("/api/memory", { method: "DELETE" });
              setMemories([]);
              setBusy(false);
            }}
          >
            Clear all memory
          </button>
        }
      >
        <p className="text-[12px]" style={{ color: "var(--ink-2)" }}>
          Retrieval is term-overlap ranked, not embedding-based — at this corpus size it is more
          accurate and needs no model. Only records matching the current question enter a prompt;
          the whole store is never pasted into context.
        </p>
      </Panel>

      {Object.entries(byKind).map(([kind, records]) => (
        <Panel key={kind} title={`${kind} memory`} subtitle={`${records.length} records`} bodyClassName="p-0">
          <ul>
            {records.map((memory) => (
              <li key={memory.id} className="border-b px-4 py-2.5 last:border-0">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[12px]" style={{ color: "var(--ink-2)" }}>
                    {memory.content}
                  </p>
                  <Badge tone="neutral">{memory.agentId}</Badge>
                </div>
                <div className="mt-1 flex items-center gap-3 text-[10px]" style={{ color: "var(--ink-3)" }}>
                  <span>importance {memory.importance.toFixed(2)}</span>
                  <span className="num">{new Date(memory.createdAt).toLocaleDateString("en-GB")}</span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}

// ─── Shopper console ─────────────────────────────────────────────────────────

interface ScoredResult {
  product: Product & { rating: number };
  score: number;
  breakdown: Record<string, number>;
  reasons: string[];
}

export function ShopperConsole() {
  const [query, setQuery] = useState("I need a laptop under ₹80,000 for programming and video editing");
  const [budget, setBudget] = useState(80000);
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<{ results: ScoredResult[]; explanation: string; engine: string } | null>(null);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await fetch("/api/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, maxBudgetPaise: budget * 100, limit: 4 }),
      });
      if (result.ok) setResponse(await result.json());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Panel title="Customer console" subtitle="Act as a shopper — the Customer Agent queries the real catalogue">
        <form onSubmit={search} className="space-y-3">
          <textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            rows={2}
            className="panel-flush w-full rounded-md border px-3 py-2 text-[13px] outline-none"
          />
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="budget" className="text-[11px]" style={{ color: "var(--ink-3)" }}>
                Budget ₹
              </label>
              <input
                id="budget"
                type="number"
                value={budget}
                onChange={(event) => setBudget(Number(event.target.value))}
                className="panel-flush mt-1 block w-32 rounded-md border px-3 py-2 text-[12px] outline-none"
              />
            </div>
            <button type="submit" disabled={busy} className={button} style={{ background: "var(--accent)", color: "#fff" }}>
              {busy ? "Searching…" : "Ask"}
            </button>
          </div>
        </form>
      </Panel>

      {response && (
        <>
          <Panel title="Recommendation" actions={<Badge tone={response.engine.startsWith("Hosted") ? "good" : "warn"}>{response.engine}</Badge>}>
            <p className="text-[12px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
              {response.explanation}
            </p>
          </Panel>

          <div className="grid gap-3 md:grid-cols-2">
            {response.results.map((result) => (
              <Panel
                key={result.product.id}
                title={result.product.name}
                subtitle={`${result.product.brand} · ${result.product.category} · rated ${result.product.rating}/5`}
                actions={<span className="num text-[13px]">{formatMoney(result.product.pricePaise)}</span>}
              >
                <div className="space-y-1.5">
                  {Object.entries(result.breakdown).map(([factor, value]) => (
                    <div key={factor}>
                      <div className="flex justify-between text-[10px]" style={{ color: "var(--ink-3)" }}>
                        <span>{factor}</span>
                        <span className="num">{value.toFixed(3)}</span>
                      </div>
                      <Meter value={(value / Math.max(result.score, 0.0001)) * 100} />
                    </div>
                  ))}
                </div>
                {result.reasons.length > 0 && (
                  <p className="mt-2 text-[11px]" style={{ color: "var(--ink-3)" }}>
                    {result.reasons.join(" · ")}
                  </p>
                )}
              </Panel>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
