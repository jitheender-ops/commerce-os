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
    try {
      const raw = await this.chat([
        {
          role: "system",
          content:
            `${request.system}\n\nRespond with a single JSON object and nothing else. ` +
            `No prose, no code fences. Required shape:\n${describeSchema(request.schema)}`,
        },
        { role: "user", content: request.user },
      ]);
      const parsed = request.schema.safeParse(extractJson(raw));
      if (!parsed.success) throw new Error(`schema mismatch: ${parsed.error.issues[0]?.message}`);
      return { value: parsed.data, engine: this.label };
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

  private recordFailure(error: unknown): void {
    // Back off for a minute rather than retrying a dead endpoint on every call.
    this.disabledUntil = Date.now() + 60_000;
    console.warn(
      `[ai] hosted provider unavailable, falling back to the deterministic engine:`,
      error instanceof Error ? error.message : error,
    );
  }

  private async chat(messages: AIMessage[]): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
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
      if (!response.ok) {
        throw new Error(`${response.status} ${await response.text().catch(() => "")}`.slice(0, 200));
      }
      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return body.choices?.[0]?.message?.content ?? "";
    } finally {
      clearTimeout(timer);
    }
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

/** A compact shape hint. Enough for a model to comply without a JSON-Schema round trip. */
function describeSchema(schema: z.ZodType): string {
  const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape;
  if (!shape) return "a JSON object";
  const fields = Object.entries(shape).map(([key, value]) => {
    const def = value as { _def?: { typeName?: string } };
    const name = def._def?.typeName ?? "";
    if (name === "ZodArray") return `  "${key}": ["string", ...]`;
    if (name === "ZodNumber") return `  "${key}": 0.0`;
    return `  "${key}": "string"`;
  });
  return `{\n${fields.join(",\n")}\n}`;
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
