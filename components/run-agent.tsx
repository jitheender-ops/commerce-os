"use client";

import { useState } from "react";
import { AgentFindings } from "@/components/ask";
import { Panel } from "@/components/ui";
import type { AgentId, AgentResult } from "@/types";

export function RunAgentButton({ agentId }: { agentId: AgentId }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          setResult(null);
          try {
            const response = await fetch(`/api/agents/${agentId}/run`, { method: "POST" });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error ?? "Run failed");
            setResult(payload.result);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-md px-3 py-1.5 text-[11px] font-medium disabled:opacity-40"
        style={{ background: "var(--accent)", color: "#fff" }}
      >
        {busy ? "Running…" : "Run agent now"}
      </button>

      {(result || error) && (
        <div className="mt-4 w-full basis-full">
          {error ? (
            <Panel title="Run failed">
              <p className="text-[12px]" style={{ color: "var(--bad)" }}>
                {error}
              </p>
            </Panel>
          ) : (
            <AgentFindings results={result ? [result] : []} />
          )}
        </div>
      )}
    </>
  );
}
