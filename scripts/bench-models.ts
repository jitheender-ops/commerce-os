/**
 * Benchmarks candidate models on the two jobs this system actually gives them:
 * producing a valid task DAG, and ranking a root cause.
 *
 *   npm run bench-models
 *
 * Picking a model from a docs page is guesswork; the hard requirement here is
 * strict JSON that survives validation, and that varies between models far more
 * than benchmark scores suggest.
 */
import { existsSync } from "node:fs";
import { validate, type ModelPlan } from "@/orchestration/llm-planner";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const BASE = process.env.AI_BASE_URL!.replace(/\/$/, "");
const KEY = process.env.AI_API_KEY!;

const CANDIDATES = [
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile",
  "qwen/qwen3.6-27b",
  "openai/gpt-oss-20b",
  "llama-3.1-8b-instant",
];

const PLAN_PROMPT = `You are the orchestrator of a multi-agent commerce system.

Available agents:
- ceo: Strategy & coordination. Reconciles findings.
- analytics: Measurement & root-cause analysis.
- inventory: Stock intelligence.
- pricing: Price & margin optimisation.
- marketing: Demand generation efficiency.
- customer: Customer experience & recovery.
- procurement: Supply & supplier selection.

Rules:
- At most 8 tasks. Only the agent ids above.
- dependsOn lists task keys from THIS plan. Use [] for tasks that start immediately.
- The final task must be "ceo" and must depend on the tasks whose findings it needs.

Respond with a single JSON object, no prose, no code fences:
{"title":"string","reasoning":"string","tasks":[{"key":"string","agentId":"string","title":"string","dependsOn":["string"]}]}`;

const USER = `Question: why did sales drop yesterday?

The operator asked this about the business. Decide who needs to investigate.
Produce the task graph.`;

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const c = (fenced?.[1] ?? raw).trim();
  const s = c.indexOf("{"), e = c.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try { return JSON.parse(c.slice(s, e + 1)); } catch { return null; }
}

async function ask(model: string, system: string, user: string) {
  const started = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.2,
      max_tokens: 900,
    }),
  });
  const ms = Date.now() - started;
  if (!res.ok) return { ms, error: `HTTP ${res.status}`, text: "" };
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return { ms, error: null, text: body.choices?.[0]?.message?.content ?? "" };
}

console.log("\n  Model bench — task-DAG planning (3 runs each)\n");
console.log("  model                        ok/3   median   notes");
console.log("  " + "-".repeat(74));

const results: { model: string; ok: number; median: number }[] = [];

for (const model of CANDIDATES) {
  const times: number[] = [];
  let ok = 0;
  const notes: string[] = [];

  for (let i = 0; i < 3; i++) {
    const r = await ask(model, PLAN_PROMPT, USER);
    times.push(r.ms);
    if (r.error) { notes.push(r.error); continue; }
    const parsed = extractJson(r.text);
    if (!parsed) { notes.push("unparseable"); continue; }
    const plan = parsed as ModelPlan;
    if (!Array.isArray(plan?.tasks)) { notes.push("no tasks[]"); continue; }
    const problem = validate(plan);
    if (problem) { notes.push(problem.slice(0, 34)); continue; }
    ok++;
  }

  const median = [...times].sort((a, b) => a - b)[1] ?? 0;
  results.push({ model, ok, median });
  const uniq = [...new Set(notes)].join("; ").slice(0, 40);
  console.log(`  ${model.padEnd(28)} ${ok}/3   ${String(median).padStart(5)}ms   ${uniq || "all valid"}`);
}

const best = results.filter(r => r.ok === 3).sort((a, b) => a.median - b.median)[0]
  ?? results.sort((a, b) => b.ok - a.ok || a.median - b.median)[0];

console.log("\n  recommended: " + best.model + `  (${best.ok}/3 valid, ${best.median}ms median)\n`);
