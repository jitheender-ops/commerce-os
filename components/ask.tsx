"use client";

/**
 * Free-text entry point. The question selects a plan template; the plan runs
 * the real agents. Results render as they come back from one request — the
 * activity feed carries the step-by-step narration while it runs.
 */
import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Badge, Panel } from "@/components/ui";
import { AGENTS } from "@/agents/definitions";
import type { AgentResult, AgentTask } from "@/types";

const SUGGESTIONS = [
  "Why did sales drop yesterday?",
  "Increase profit by 15% without increasing advertising spend",
  "Are we going to stock out of anything?",
  "Which campaigns are wasting money?",
];

interface AskResponse {
  question: string;
  template: { id: string; title: string };
  plan: { id: string; status: string; tasks: AgentTask[] };
  results: AgentResult[];
  failed: { agentId: string; error: string }[];
  error?: string;
}

export function AskBar() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResponse(null);
    try {
      const result = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const data = (await result.json()) as AskResponse;
      if (!result.ok) throw new Error(data.error ?? "The request failed");
      setResponse(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
        className="panel flex items-center gap-2 px-3 py-2"
      >
        <label htmlFor="ask" className="sr-only">
          Ask the agents a question
        </label>
        <input
          id="ask"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask the business a question, or state a goal…"
          className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-[13px] outline-none"
          style={{ color: "var(--ink)" }}
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium disabled:opacity-40"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />}
          {busy ? "Working" : "Run"}
        </button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={busy}
            onClick={() => {
              setQuestion(suggestion);
              void ask(suggestion);
            }}
            className="rounded-full border px-2.5 py-1 text-[11px] transition-colors hover:bg-[var(--panel-2)] disabled:opacity-40"
            style={{ color: "var(--ink-2)" }}
          >
            {suggestion}
          </button>
        ))}
      </div>

      {error && (
        <Panel title="The run failed">
          <p className="text-[12px]" style={{ color: "var(--bad)" }}>
            {error}
          </p>
          <p className="mt-1 text-[11px]" style={{ color: "var(--ink-3)" }}>
            The agents left the business unchanged. Try again, or reset the demo from the header.
          </p>
        </Panel>
      )}

      {response && (
        <AgentFindings
          results={response.results}
          title={response.template.title}
          subtitle={`${response.results.length} agents reported · plan ${response.plan.id}`}
          status={response.plan.status}
          failed={response.failed.length}
        />
      )}
    </div>
  );
}

/**
 * Renders what agents found, with the fact/inference/recommendation separation
 * kept visible. Shared by the ask bar, the agent detail page, the simulator and
 * the scripted demo so one result never looks different from another.
 */
export function AgentFindings({
  results,
  title = "Findings",
  subtitle,
  status,
  failed = 0,
}: {
  results: AgentResult[];
  title?: string;
  subtitle?: string;
  status?: string;
  failed?: number;
}) {
  if (results.length === 0) return null;

  return (
    <Panel
      title={title}
      subtitle={subtitle ?? `${results.length} agent${results.length === 1 ? "" : "s"} reported`}
      actions={status ? <Badge tone={failed ? "warn" : "good"}>{status}</Badge> : undefined}
      bodyClassName="p-0"
    >
      <ul>
        {results.map((result) => (
          <li key={`${result.agentId}-${result.latencyMs}`} className="enter border-b p-4 last:border-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span
                className="text-[12px] font-semibold"
                style={{ color: AGENTS[result.agentId].color }}
              >
                {AGENTS[result.agentId].name}
              </span>
              <span className="text-[10px]" style={{ color: "var(--ink-3)" }}>
                {result.engine} · {result.latencyMs}ms
              </span>
            </div>
            <p className="mt-1 text-[13px]">{result.headline}</p>
            <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
              {result.narrative}
            </p>

            {result.observed.length > 0 && (
              <div className="mt-3">
                <div className="text-[9px] uppercase tracking-[0.1em]" style={{ color: "var(--ink-3)" }}>
                  Observed — measured, not inferred
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {result.observed.map((item) => (
                    <span key={item.label} className="text-[11px]">
                      <span style={{ color: "var(--ink-3)" }}>{item.label}</span>{" "}
                      <span className="num">{item.value}</span>
                      {item.detail && <span style={{ color: "var(--ink-3)" }}> ({item.detail})</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {result.inference.length > 0 && (
              <div className="mt-3">
                <div className="text-[9px] uppercase tracking-[0.1em]" style={{ color: "var(--ink-3)" }}>
                  Inference
                </div>
                <ul className="mt-1 space-y-0.5">
                  {result.inference.map((line, index) => (
                    <li key={index} className="text-[11px]" style={{ color: "var(--ink-2)" }}>
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.recommendations.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <div className="text-[9px] uppercase tracking-[0.1em]" style={{ color: "var(--ink-3)" }}>
                  Recommendations
                </div>
                {result.recommendations.map((rec) => (
                  <div key={rec.id} className="panel-flush rounded-md border px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[12px]">{rec.title}</span>
                      <Badge tone={rec.risk === "LOW" ? "good" : rec.risk === "MEDIUM" ? "warn" : "bad"}>
                        {rec.risk}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[11px]" style={{ color: "var(--ink-3)" }}>
                      {rec.rationale}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
