/**
 * Verifies the hosted model connection and reports what the gateway will use.
 *
 *   npm run check-ai
 *
 * Lists the models the endpoint actually offers rather than trusting a model id
 * copied from documentation, then runs one real structured request through the
 * gateway so a broken key or a wrong model surfaces here instead of mid-demo.
 */
import { existsSync } from "node:fs";
import { z } from "zod";
import { describeEngine, getAI, resetAI } from "@/ai/gateway";

// Next.js loads these itself; this script does not run under Next, so it reads
// them the same way Next would. `loadEnvFile` is a Node builtin — no dependency.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const baseUrl = process.env.AI_BASE_URL?.trim();
const apiKey = process.env.AI_API_KEY?.trim();
const model = process.env.AI_MODEL?.trim();

console.log("\n  AI gateway check\n");
console.log(`  AI_PROVIDER  ${process.env.AI_PROVIDER ?? "(unset)"}`);
console.log(`  AI_BASE_URL  ${baseUrl ?? "(unset)"}`);
console.log(`  AI_API_KEY   ${apiKey ? `set, ${apiKey.length} chars` : "(unset)"}`);
console.log(`  AI_MODEL     ${model ?? "(unset)"}\n`);

if (!baseUrl || !apiKey) {
  console.log("  No hosted model configured — the deterministic engine is active.");
  console.log("  Set AI_BASE_URL, AI_API_KEY and AI_MODEL in .env.local to enable one.\n");
  process.exit(0);
}

// 1 — what does this endpoint actually offer?
try {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    console.log(`  models lookup: HTTP ${response.status} — check the key and base URL\n`);
  } else {
    const body = (await response.json()) as { data?: { id: string }[] };
    const ids = (body.data ?? []).map((m) => m.id).sort();
    console.log(`  models available (${ids.length}):`);
    for (const id of ids.slice(0, 25)) {
      console.log(`    ${id === model ? "→" : " "} ${id}`);
    }
    if (model && !ids.includes(model)) {
      console.log(`\n  WARNING: AI_MODEL "${model}" is not in this endpoint's list.`);
    }
    console.log();
  }
} catch (error) {
  console.log(`  models lookup failed: ${error instanceof Error ? error.message : error}\n`);
}

// 2 — one real round trip through the gateway the app itself uses.
resetAI();
const engine = describeEngine();
console.log(`  gateway resolves to: ${engine.label} (${engine.mode})\n`);

const Probe = z.object({
  driver: z.string(),
  confidence: z.coerce.number().min(0).max(1),
});

const started = Date.now();
const { value, engine: usedEngine } = await getAI().structured({
  kind: "probe",
  schema: Probe,
  system: "You analyse retail metrics. Answer only with the JSON object requested.",
  user:
    "Revenue fell 29%. Sessions were flat at +1.9%, conversion fell 49.7%, order value fell 6.6%. " +
    "Which driver explains the fall? Reply with {driver, confidence}.",
  fallback: () => ({ driver: "(deterministic fallback)", confidence: 0 }),
});

const ms = Date.now() - started;
console.log(`  live request: ${ms}ms`);
console.log(`  answered by:  ${usedEngine}`);
console.log(`  result:       driver="${value.driver}" confidence=${value.confidence}\n`);

if (usedEngine === "Deterministic Business Engine") {
  console.log("  The model did not answer — the gateway fell back. Check the warning above.\n");
  process.exit(1);
}
console.log("  Hosted model is live. Agents will use it for reasoning and planning.\n");
