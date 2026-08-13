/**
 * Model-driven planning.
 *
 * The model decomposes a trigger into a task DAG: which agents run, in what
 * order, and what each one is asked to establish. This replaces the fixed
 * templates in plans.ts as the primary path.
 *
 * Everything the model returns is treated as untrusted structure. A plan is
 * only accepted if it passes, in order:
 *
 *   1. schema validation (shape and types)
 *   2. every agentId is a real agent
 *   3. task keys are unique
 *   4. every dependsOn references a key that exists in the same plan
 *   5. the graph is acyclic
 *   6. size bounds (1..MAX_TASKS)
 *   7. it ends in a synthesis step, so somebody reconciles the findings
 *
 * A plan failing any check is discarded and the deterministic template is used
 * instead. The caller is told which path was taken and the UI shows it, so a
 * fallback is never presented as model output.
 */
import { z } from "zod";
import { AGENTS, AGENT_IDS } from "@/agents/definitions";
import { getAI } from "@/ai/gateway";
import type { PlanTemplate, TaskSpec } from "./plans";
import type { AgentId } from "@/types";

/** A plan larger than this is a runaway, not a plan. */
const MAX_TASKS = 8;

const PlanSchema = z.object({
  title: z.string().min(3).max(120),
  reasoning: z.string().max(600).optional(),
  tasks: z
    .array(
      z.object({
        key: z.string().min(1).max(40),
        agentId: z.string(),
        title: z.string().min(3).max(140),
        dependsOn: z.array(z.string()).max(MAX_TASKS).default([]),
      }),
    )
    .min(1)
    .max(MAX_TASKS),
});

export type ModelPlan = z.infer<typeof PlanSchema>;

export interface PlanningResult {
  template: PlanTemplate;
  plannedBy: "model" | "template";
  /** Why the model plan was rejected, when it was. Surfaced in the UI. */
  rejection: string | null;
  modelReasoning: string | null;
}

/**
 * Asks the model for a plan, validates it, and falls back to `fallback` if the
 * plan is unusable. Never throws.
 */
export async function planWithModel(
  trigger: string,
  fallback: PlanTemplate,
  context: string,
): Promise<PlanningResult> {
  const roster = AGENT_IDS.map(
    (id) => `- ${id}: ${AGENTS[id].role}. ${AGENTS[id].objective}`,
  ).join("\n");

  const { value, engine } = await getAI().structured({
    kind: "orchestration.plan",
    schema: PlanSchema,
    system:
      `You are the orchestrator of a multi-agent commerce system. You decide which ` +
      `specialist agents investigate a situation and in what order.\n\n` +
      `Available agents:\n${roster}\n\n` +
      `Rules:\n` +
      `- Use at most ${MAX_TASKS} tasks. Fewer is better.\n` +
      `- Only use the agent ids listed above.\n` +
      `- dependsOn lists task keys from THIS plan that must finish first. Use [] for tasks that can start immediately.\n` +
      `- Tasks that do not depend on each other run in parallel, so do not chain work that could run at the same time.\n` +
      `- The final task must be the "ceo" agent, which reconciles what the others found. It must depend on every task whose findings it needs.\n` +
      `- Do not invent agents, tools, or data.`,
    user: `${trigger}\n\n${context}\n\nProduce the task graph.`,
    // Used verbatim when no model is configured, so the deterministic path is
    // indistinguishable in shape from a model plan.
    fallback: () => ({
      title: fallback.title,
      reasoning: undefined,
      tasks: fallback.tasks.map((task) => ({
        key: task.key,
        agentId: task.agentId,
        title: task.title,
        dependsOn: task.dependsOn,
      })),
    }),
  });

  // No model configured — structured() returned the fallback verbatim.
  if (engine === "Deterministic Business Engine") {
    return { template: fallback, plannedBy: "template", rejection: null, modelReasoning: null };
  }

  const problem = validate(value);
  if (problem) {
    console.warn(`[planner] model plan rejected (${problem}); using the deterministic template`);
    return { template: fallback, plannedBy: "template", rejection: problem, modelReasoning: value.reasoning ?? null };
  }

  return {
    template: {
      id: `model:${fallback.id}`,
      title: value.title,
      triggers: [],
      metrics: [],
      intents: [],
      tasks: value.tasks.map((task) => ({
        key: task.key,
        agentId: task.agentId as AgentId,
        title: task.title,
        dependsOn: task.dependsOn,
      })) satisfies TaskSpec[],
    },
    plannedBy: "model",
    rejection: null,
    modelReasoning: value.reasoning ?? null,
  };
}

/** Returns a human-readable reason the plan is unusable, or null if it is fine. */
export function validate(plan: ModelPlan): string | null {
  const keys = new Set<string>();

  for (const task of plan.tasks) {
    if (!AGENT_IDS.includes(task.agentId as AgentId)) {
      return `unknown agent "${task.agentId}"`;
    }
    if (keys.has(task.key)) return `duplicate task key "${task.key}"`;
    keys.add(task.key);
  }

  for (const task of plan.tasks) {
    for (const dep of task.dependsOn) {
      if (!keys.has(dep)) return `task "${task.key}" depends on unknown task "${dep}"`;
      if (dep === task.key) return `task "${task.key}" depends on itself`;
    }
  }

  const cycle = findCycle(plan.tasks);
  if (cycle) return `dependency cycle: ${cycle.join(" → ")}`;

  // Without a reconciling step the run produces findings nobody joins up.
  const terminal = plan.tasks.filter(
    (task) => !plan.tasks.some((other) => other.dependsOn.includes(task.key)),
  );
  if (!terminal.some((task) => task.agentId === "ceo")) {
    return `plan does not end in a "ceo" synthesis task`;
  }

  return null;
}

/** Depth-first search; returns the offending path if the graph has a cycle. */
function findCycle(tasks: ModelPlan["tasks"]): string[] | null {
  const edges = new Map(tasks.map((task) => [task.key, task.dependsOn]));
  const state = new Map<string, "open" | "done">();
  const stack: string[] = [];

  const visit = (key: string): string[] | null => {
    const seen = state.get(key);
    if (seen === "done") return null;
    if (seen === "open") return [...stack.slice(stack.indexOf(key)), key];

    state.set(key, "open");
    stack.push(key);
    for (const dep of edges.get(key) ?? []) {
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(key, "done");
    return null;
  };

  for (const task of tasks) {
    const cycle = visit(task.key);
    if (cycle) return cycle;
  }
  return null;
}
