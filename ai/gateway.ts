/**
 * AI gateway.
 *
 * Two providers, one interface:
 *
 *   DeterministicProvider  default. No network, no key, no local model. Produces
 *                          reasoning from the same evidence the agents already
 *                          computed, using explicit rules.
 *   HostedProvider         optional. Speaks the OpenAI-compatible chat shape, so
 *                          one adapter covers Groq, Google Gemini and OpenRouter
 *                          free tiers. Enabled only when AI_BASE_URL and
 *                          AI_API_KEY are set.
 *
 * The contract that matters: every structured request carries a deterministic
 * `fallback()`. If no model is configured, or the model errors, times out, or
 * returns something that fails schema validation, the fallback is used and the
 * returned `engine` label says so. The UI renders that label verbatim, so the
 * screen never claims a model produced something it didn't.
 *
 * Numbers never come from here. Facts are computed by database/queries.ts;
 * this layer only ranks, explains and phrases.
 */
import { z } from "zod";
import type { AIMessage, AIProvider, EngineLabel, StructuredRequest } from "@/types";

const DETERMINISTIC_LABEL: EngineLabel = "Deterministic Business Engine";
const REQUEST_TIMEOUT_MS = 20_000;

class DeterministicProvider implements AIProvider {
  readonly label = DETERMINISTIC_LABEL;
  readonly available = true;

  async structured<T>(request: StructuredRequest<T>) {
    return { value: request.fallback(), engine: this.label };
  }

  async text(_messages: AIMessage[], fallback: () => string) {
    return { value: fallback(), engine: this.label };
  }
}

interface HostedConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

class HostedProvider implements AIProvider {
  readonly label: EngineLabel;
  readonly available = true;
  private readonly deterministic = new DeterministicProvider();
  /** Set after a failure so one broken key doesn't stall every later request. */
  private disabledUntil = 0;

  constructor(private readonly config: HostedConfig) {
    this.label = `Hosted model · ${config.model}`;
  }

  async structured<T>(request: StructuredRequest<T>) {
    if (Date.now() < this.disabledUntil) {
      return this.deterministic.structured(request);
    }

    const system =
      `${request.system}\n\nRespond with a single JSON object and nothing else. ` +
      `No prose, no code fences. Numbers must be JSON numbers, not quoted strings. ` +
      `Required shape:\n${describeSchema(request.schema)}`;

    try {
      const messages: AIMessage[] = [
        { role: "system", content: system },
        { role: "user", content: request.user },
      ];

      // Two attempts. Models miss a schema in small, correctable ways — a
      // quoted number, a missing optional, an extra wrapper key — and handing
      // the validation error back fixes most of them far more cheaply than
      // discarding a response that was otherwise correct.
      for (let attempt = 1; attempt <= 2; attempt++) {
        const raw = await this.chat(messages);
        const parsed = request.schema.safeParse(extractJson(raw));
        if (parsed.success) return { value: parsed.data, engine: this.label };

        const problem = parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
          .join("; ");

        if (attempt === 2) throw new Error(`schema mismatch after retry: ${problem}`);

        messages.push(
          { role: "assistant", content: raw.slice(0, 2000) },
          {
            role: "user",
            content:
              `That did not match the required shape: ${problem}. ` +
              `Return the corrected JSON object only.`,
          },
        );
      }
      throw new Error("unreachable");
    } catch (error) {
      this.recordFailure(error);
      return this.deterministic.structured(request);
    }
  }

  async text(messages: AIMessage[], fallback: () => string) {
    if (Date.now() < this.disabledUntil) {
      return this.deterministic.text(messages, fallback);
    }
    try {
      const value = await this.chat(messages);
      if (!value.trim()) throw new Error("empty response");
      return { value: value.trim(), engine: this.label };
    } catch (error) {
      this.recordFailure(error);
      return this.deterministic.text(messages, fallback);
    }
  }

  /**
   * Not every failure means the provider is down, and treating them alike was a
   * real bug: one agent's malformed JSON disabled the model for every agent
   * that ran after it.
   *
   *   schema mismatch → this call falls back; the provider stays enabled
   *   rate limit      → short cooldown, so the next agent isn't punished
   *   anything else   → a minute, on the assumption the endpoint is unwell
   */
  private recordFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const isSchema = message.startsWith("schema mismatch");
    const isRateLimit = message.startsWith("429");

    if (isSchema) {
      console.warn(`[ai] response did not match the schema, using the deterministic result: ${message}`);
      return;
    }

    this.disabledUntil = Date.now() + (isRateLimit ? 3_000 : 60_000);
    console.warn(
      `[ai] hosted provider unavailable${isRateLimit ? " (rate limited)" : ""}, ` +
        `falling back to the deterministic engine: ${message.slice(0, 160)}`,
    );
  }

  private async chat(messages: AIMessage[]): Promise<string> {
    // Free tiers are metered on tokens per minute, and a plan fans several
    // agents out at once. Without this gate they stampede the limit together
    // and most of them lose; with it they queue and nearly all succeed.
    return withSlot(async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const response = await this.send(messages);

        if (response.status === 429 && attempt < 3) {
          // Honour the server's own guidance when it gives any.
          const header = Number(response.headers.get("retry-after"));
          const waitMs = Number.isFinite(header) && header > 0
            ? Math.min(header * 1000, 8_000)
            : attempt * 1_500;
          await sleep(waitMs);
          continue;
        }

        if (!response.ok) {
          throw new Error(
            `${response.status} ${await response.text().catch(() => "")}`.slice(0, 200),
          );
        }

        const body = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        return body.choices?.[0]?.message?.content ?? "";
      }
      throw new Error("429 rate limited after retries");
    });
  }

  private async send(messages: AIMessage[]): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0.2,
          max_tokens: 900,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Caps how many model requests are in flight at once, process-wide.
 *
 * Agents in the same wave run concurrently by design, but a token-per-minute
 * quota is a shared resource: six simultaneous requests all read the quota as
 * available, all send, and most get a 429. Two at a time keeps the pipeline
 * busy while staying inside a free-tier allowance.
 */
const MAX_CONCURRENT = 2;
let inFlight = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

/** Models often wrap JSON in prose or fences; recover the object rather than failing. */
function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * The exact contract the response must satisfy, derived from the Zod schema
 * itself so the two can never drift.
 *
 * This was previously a hand-rolled summary that rendered every array as
 * `["string", ...]` — which meant a schema like the planner's, whose array
 * holds objects, told the model nothing about the fields inside. The model
 * duly invented its own field names and every plan failed validation. Deriving
 * it removes that whole class of bug.
 */
function describeSchema(schema: z.ZodType): string {
  try {
    const json = z.toJSONSchema(schema) as Record<string, unknown>;
    delete json.$schema;
    return JSON.stringify(json);
  } catch {
    return "a single JSON object";
  }
}

const globalRef = globalThis as unknown as { __commerceAI?: AIProvider };

export function getAI(): AIProvider {
  if (globalRef.__commerceAI) return globalRef.__commerceAI;

  const baseUrl = process.env.AI_BASE_URL?.trim();
  const apiKey = process.env.AI_API_KEY?.trim();
  const model = process.env.AI_MODEL?.trim();
  const provider = process.env.AI_PROVIDER?.trim() ?? (baseUrl && apiKey ? "hosted" : "deterministic");

  globalRef.__commerceAI =
    provider === "hosted" && baseUrl && apiKey && model
      ? new HostedProvider({ baseUrl, apiKey, model })
      : new DeterministicProvider();

  return globalRef.__commerceAI;
}

/** Shown in the UI header and on every agent result. */
export function describeEngine(): {
  label: EngineLabel;
  mode: "deterministic" | "hosted";
  detail: string;
} {
  const ai = getAI();
  const hosted = ai.label !== DETERMINISTIC_LABEL;
  return {
    label: ai.label,
    mode: hosted ? "hosted" : "deterministic",
    detail: hosted
      ? "Reasoning and narration come from a hosted model. All figures, policies and decisions remain deterministic."
      : "No model configured. Reasoning is produced by explicit rules over the same computed evidence. Nothing here is generated by an LLM.",
  };
}

/** Reset between tests, or after changing environment variables at runtime. */
export function resetAI(): void {
  delete globalRef.__commerceAI;
}
