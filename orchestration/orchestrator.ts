/**
 * Orchestrator.
 *
 * Turns a trigger (an event, a goal, or a typed question) into a task DAG,
 * then walks it: every task whose dependencies are satisfied runs, results feed
 * forward to dependants, and each task moves through the documented state
 * machine with retries.
 *
 *   PENDING → PLANNING → RUNNING → VERIFYING → COMPLETED
 *                     ↘ FAILED / BLOCKED / CANCELLED
 *
 * Plan construction is deterministic (see plans.ts); the reasoning inside each
 * task is the agent's own.
 */
import { getAgentImpl } from "@/agents";
import { AGENTS } from "@/agents/definitions";
import { callTool } from "@/tools/executor";
import { getBus } from "@/events/bus";
import { getDb, fromJson, num, str, toJson } from "@/database/db";
import { newCorrelationId, newId } from "@/lib/ids";
import {
  PLAN_TEMPLATES,
  templateForEvent,
  templateForGoal,
  templateForIntent,
  type PlanTemplate,
  type TaskSpec,
} from "./plans";
import type {
  AgentId,
  AgentResult,
  AgentTask,
  BusinessGoal,
  EventType,
  Plan,
  TaskStatus,
} from "@/types";

const MAX_ATTEMPTS = 2;

export interface PlanRunResult {
  plan: Plan;
  tasks: AgentTask[];
  results: AgentResult[];
  failed: { taskId: string; agentId: AgentId; error: string }[];
  executions: ExecutionOutcome[];
  /** Recommendations not attempted, and why. Never silently dropped. */
  skipped: { title: string; reason: string }[];
}

export interface ExecutionOutcome {
  recommendationId: string;
  agentId: AgentId;
  title: string;
  tool: string;
  status: "COMPLETED" | "PENDING_APPROVAL" | "DENIED" | "FAILED";
  decision: string;
  reason: string;
  approvalId?: string;
  financialImpactPaise: number;
}

/**
 * How many actionable recommendations a single plan will attempt. A plan can
 * surface dozens; running all of them would bury the interesting ones and make
 * the approval queue unreadable. Whatever is left over is reported in
 * `skipped`, never dropped quietly.
 */
const MAX_EXECUTIONS_PER_PLAN = 6;

export interface PlanRequest {
  /** Human-readable description of what started this. */
  trigger: string;
  template: PlanTemplate;
  goalId?: string | null;
  correlationId?: string;
  triggerPayload?: Record<string, unknown>;
}

// ─── Plan selection ──────────────────────────────────────────────────────────

export function planForEvent(type: EventType, payload: Record<string, unknown> = {}): PlanRequest | null {
  const template = templateForEvent(type);
  if (!template) return null;
  return { trigger: `Event: ${type}`, template, triggerPayload: payload };
}

export function planForGoal(goal: BusinessGoal): PlanRequest {
  return {
    trigger: `Goal: ${goal.statement}`,
    template: templateForGoal(goal.metric),
    goalId: goal.id,
    triggerPayload: { goalId: goal.id, metric: goal.metric, target: goal.targetPercent },
  };
}

export function planForQuestion(question: string): PlanRequest {
  return {
    trigger: `Question: ${question}`,
    template: templateForIntent(question),
    triggerPayload: { question },
  };
}

// ─── Execution ───────────────────────────────────────────────────────────────

export async function runPlan(request: PlanRequest): Promise<PlanRunResult> {
  const correlationId = request.correlationId ?? newCorrelationId();
  const plan = persistPlan(request, correlationId);
  const tasks = persistTasks(plan, request.template.tasks);

  getBus().publish(
    "PLAN_CREATED",
    {
      planId: plan.id,
      title: plan.title,
      trigger: plan.trigger,
      tasks: tasks.map((t) => ({ id: t.id, agentId: t.agentId, title: t.title, dependsOn: t.dependsOn })),
    },
    { source: "orchestrator", correlationId },
  );

  const resultsByKey = new Map<string, AgentResult>();
  const keyByTaskId = new Map(tasks.map((task, index) => [task.id, request.template.tasks[index].key]));
  const specByTaskId = new Map(tasks.map((task, index) => [task.id, request.template.tasks[index]]));
  const failed: PlanRunResult["failed"] = [];
  const completed = new Set<string>();
  const finished = new Set<string>();

  // Walk the DAG in waves: everything whose dependencies are done runs together.
  while (finished.size < tasks.length) {
    const ready = tasks.filter((task) => {
      if (finished.has(task.id)) return false;
      const spec = specByTaskId.get(task.id)!;
      return spec.dependsOn.every((dep) => completed.has(dep));
    });

    if (ready.length === 0) {
      // Everything left depends on something that failed.
      for (const task of tasks.filter((t) => !finished.has(t.id))) {
        updateTask(task.id, { status: "BLOCKED", error: "A dependency did not complete" });
        finished.add(task.id);
      }
      break;
    }

    const outcomes = await Promise.all(
      ready.map((task) =>
        executeTask(task, specByTaskId.get(task.id)!, {
          correlationId,
          resultsByKey,
          triggerPayload: request.triggerPayload,
        }),
      ),
    );

    outcomes.forEach((outcome, index) => {
      const task = ready[index];
      const key = keyByTaskId.get(task.id)!;
      finished.add(task.id);
      if (outcome.ok) {
        completed.add(key);
        resultsByKey.set(key, outcome.result);
      } else {
        failed.push({ taskId: task.id, agentId: task.agentId, error: outcome.error });
      }
    });
  }

  // Findings are not outcomes. Every recommendation that names a tool is now
  // put through the governance pipeline, which is what turns a proposal into
  // either an executed action or an item in the approval queue.
  const { executions, skipped } = await executeRecommendations(
    [...resultsByKey.values()],
    correlationId,
  );

  const finalStatus: TaskStatus = failed.length === 0 ? "COMPLETED" : failed.length === tasks.length ? "FAILED" : "COMPLETED";
  const finishedAt = new Date().toISOString();
  getDb().run(
    `UPDATE plans SET status = ?, finished_at = ? WHERE id = ?`,
    finalStatus,
    finishedAt,
    plan.id,
  );

  const results = [...resultsByKey.values()];
  getBus().publish(
    "PLAN_COMPLETED",
    {
      planId: plan.id,
      status: finalStatus,
      completed: results.length,
      failed: failed.length,
      headlines: results.map((r) => ({ agentId: r.agentId, headline: r.headline })),
    },
    { source: "orchestrator", correlationId },
  );

  return {
    plan: { ...plan, status: finalStatus, finishedAt },
    tasks: loadTasks(plan.id),
    results,
    failed,
    executions,
    skipped,
  };
}

/**
 * Runs the actionable recommendations a plan produced.
 *
 * Deduplicated by (tool, entity) so two agents proposing the same change do not
 * fire it twice, then ranked by expected impact and attempted in order. Each
 * call goes through `callTool`, so permission, policy, risk and budget all
 * apply exactly as they would for any other call — an action above a limit
 * becomes an approval rather than an execution.
 */
async function executeRecommendations(
  results: AgentResult[],
  correlationId: string,
): Promise<{ executions: ExecutionOutcome[]; skipped: { title: string; reason: string }[] }> {
  const actionable = results
    .flatMap((result) => result.recommendations)
    .filter((rec) => rec.tool !== null && rec.input !== null);

  const seen = new Set<string>();
  const deduped: typeof actionable = [];
  const skipped: { title: string; reason: string }[] = [];

  for (const rec of actionable) {
    const entity =
      rec.input?.productId ?? rec.input?.campaignId ?? rec.input?.orderId ?? rec.input?.ticketId ?? "-";
    const key = `${rec.tool}:${entity}`;
    if (seen.has(key)) {
      skipped.push({ title: rec.title, reason: "duplicate of an action already attempted this run" });
      continue;
    }
    seen.add(key);
    deduped.push(rec);
  }

  const ranked = deduped.sort(
    (a, b) => b.estimatedImpactPaise * b.confidence - a.estimatedImpactPaise * a.confidence,
  );

  for (const rec of ranked.slice(MAX_EXECUTIONS_PER_PLAN)) {
    skipped.push({
      title: rec.title,
      reason: `beyond the ${MAX_EXECUTIONS_PER_PLAN}-action limit for one plan`,
    });
  }

  const executions: ExecutionOutcome[] = [];
  for (const rec of ranked.slice(0, MAX_EXECUTIONS_PER_PLAN)) {
    const result = await callTool(rec.tool!, rec.input!, {
      agentId: rec.agentId,
      taskId: null,
      correlationId,
    });
    executions.push({
      recommendationId: rec.id,
      agentId: rec.agentId,
      title: rec.title,
      tool: rec.tool!,
      status: result.status,
      decision: result.governance.decision,
      reason:
        result.error ??
        result.governance.reasons.find((r) => r.decision === result.governance.decision)?.message ??
        "Executed within policy",
      approvalId: result.approvalId,
      financialImpactPaise: result.governance.financialImpactPaise,
    });
  }

  return { executions, skipped };
}

interface ExecuteContext {
  correlationId: string;
  resultsByKey: Map<string, AgentResult>;
  triggerPayload?: Record<string, unknown>;
}

type Outcome = { ok: true; result: AgentResult } | { ok: false; error: string };

async function executeTask(task: AgentTask, spec: TaskSpec, ctx: ExecuteContext): Promise<Outcome> {
  const priorResults = spec.dependsOn
    .map((dep) => ctx.resultsByKey.get(dep))
    .filter((r): r is AgentResult => Boolean(r));

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    setTaskStatus(task.id, attempt === 1 ? "PLANNING" : "RUNNING", ctx.correlationId, task.agentId);
    setTaskStatus(task.id, "RUNNING", ctx.correlationId, task.agentId);
    getDb().run(
      `UPDATE tasks SET attempts = ?, started_at = COALESCE(started_at, ?) WHERE id = ?`,
      attempt,
      new Date().toISOString(),
      task.id,
    );

    try {
      const result = await getAgentImpl(task.agentId).run({
        correlationId: ctx.correlationId,
        taskId: task.id,
        priorResults,
        trigger: ctx.triggerPayload,
      });

      setTaskStatus(task.id, "VERIFYING", ctx.correlationId, task.agentId);
      const problem = verify(result);
      if (problem) throw new Error(problem);

      updateTask(task.id, { status: "COMPLETED", result });
      setTaskStatus(task.id, "COMPLETED", ctx.correlationId, task.agentId);
      return { ok: true, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === MAX_ATTEMPTS) {
        updateTask(task.id, { status: "FAILED", error: message });
        setTaskStatus(task.id, "FAILED", ctx.correlationId, task.agentId);
        return { ok: false, error: message };
      }
      // Brief backoff before the retry so a transient dependency can recover.
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
  return { ok: false, error: "exhausted retries" };
}

/** A result that carries no evidence is not usable, however well it reads. */
function verify(result: AgentResult): string | null {
  if (!result.headline.trim()) return "agent returned an empty headline";
  if (result.observed.length === 0) return "agent returned no observed evidence";
  return null;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function persistPlan(request: PlanRequest, correlationId: string): Plan {
  const plan: Plan = {
    id: newId("pln"),
    goalId: request.goalId ?? null,
    title: request.template.title,
    trigger: request.trigger,
    status: "RUNNING",
    correlationId,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  getDb().run(
    `INSERT INTO plans (id, goal_id, title, trigger, status, correlation_id, created_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    plan.id, plan.goalId, plan.title, plan.trigger, plan.status, plan.correlationId, plan.createdAt,
  );
  return plan;
}

function persistTasks(plan: Plan, specs: TaskSpec[]): AgentTask[] {
  const idByKey = new Map(specs.map((spec) => [spec.key, newId("tsk")]));
  return specs.map((spec) => {
    const task: AgentTask = {
      id: idByKey.get(spec.key)!,
      planId: plan.id,
      agentId: spec.agentId,
      title: spec.title,
      dependsOn: spec.dependsOn.map((key) => idByKey.get(key)!).filter(Boolean),
      status: "PENDING",
      attempts: 0,
      result: null,
      error: null,
      startedAt: null,
      finishedAt: null,
    };
    getDb().run(
      `INSERT INTO tasks (id, plan_id, agent_id, title, depends_on, status, attempts)
       VALUES (?, ?, ?, ?, ?, 'PENDING', 0)`,
      task.id, task.planId, task.agentId, task.title, toJson(task.dependsOn),
    );
    return task;
  });
}

function setTaskStatus(
  taskId: string,
  status: TaskStatus,
  correlationId: string,
  agentId: AgentId,
): void {
  getDb().run(`UPDATE tasks SET status = ? WHERE id = ?`, status, taskId);
  getBus().publish(
    "TASK_STATUS_CHANGED",
    { taskId, status, agentId, agentName: AGENTS[agentId].name },
    { source: "orchestrator", correlationId },
  );
}

function updateTask(
  taskId: string,
  patch: { status: TaskStatus; result?: AgentResult; error?: string },
): void {
  getDb().run(
    `UPDATE tasks SET status = ?, result = ?, error = ?, finished_at = ? WHERE id = ?`,
    patch.status,
    patch.result ? toJson(patch.result) : null,
    patch.error ?? null,
    new Date().toISOString(),
    taskId,
  );
}

export function loadTasks(planId: string): AgentTask[] {
  return getDb()
    .all(`SELECT * FROM tasks WHERE plan_id = ? ORDER BY rowid`, planId)
    .map((row) => ({
      id: str(row.id),
      planId: str(row.plan_id),
      agentId: str(row.agent_id) as AgentId,
      title: str(row.title),
      dependsOn: fromJson<string[]>(row.depends_on, []),
      status: str(row.status) as TaskStatus,
      attempts: num(row.attempts),
      result: fromJson<AgentResult | null>(row.result, null),
      error: row.error ? str(row.error) : null,
      startedAt: row.started_at ? str(row.started_at) : null,
      finishedAt: row.finished_at ? str(row.finished_at) : null,
    }));
}

export function listPlans(limit = 20): Plan[] {
  return getDb()
    .all(`SELECT * FROM plans ORDER BY created_at DESC LIMIT ?`, limit)
    .map((row) => ({
      id: str(row.id),
      goalId: row.goal_id ? str(row.goal_id) : null,
      title: str(row.title),
      trigger: str(row.trigger),
      status: str(row.status) as TaskStatus,
      correlationId: str(row.correlation_id),
      createdAt: str(row.created_at),
      finishedAt: row.finished_at ? str(row.finished_at) : null,
    }));
}

export function getPlan(planId: string): Plan | null {
  return listPlans(200).find((plan) => plan.id === planId) ?? null;
}

export { PLAN_TEMPLATES };
