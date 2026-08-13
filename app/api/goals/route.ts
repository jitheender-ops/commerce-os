import { z } from "zod";
import { createGoal, getBusinessSummary, listGoals, updateGoalProgress } from "@/database/queries";
import { planForGoal, runPlan } from "@/orchestration/orchestrator";
import { newId } from "@/lib/ids";
import { body, handle, ok, ready } from "@/lib/api";
import type { BusinessGoal, GoalMetric } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Payload = z.object({
  statement: z.string().min(6).max(300),
  metric: z.enum(["profit", "revenue", "conversion", "stockouts", "refund_rate", "margin", "repeat_rate"]),
  targetPercent: z.number().min(-100).max(500),
  constraints: z.array(z.string().max(160)).max(6).default([]),
  deadlineDays: z.number().int().min(1).max(365).default(30),
  /** Runs the plan the goal selects immediately. */
  execute: z.boolean().default(true),
});

export async function GET() {
  try {
    ready();
    const summary = getBusinessSummary();
    const goals = listGoals().map((goal) => {
      const current = currentValue(goal.metric, summary);
      updateGoalProgress(goal.id, current);
      const achieved = goal.baselineValue === 0 ? 0 : ((current - goal.baselineValue) / Math.abs(goal.baselineValue)) * 100;
      const progress = goal.targetPercent === 0 ? 0 : Math.max(0, Math.min(100, (achieved / goal.targetPercent) * 100));
      return {
        ...goal,
        currentValue: current,
        achievedPercent: Number(achieved.toFixed(1)),
        progressPercent: Number(progress.toFixed(0)),
      };
    });
    return ok({ goals });
  } catch (error) {
    return handle(error, "goals");
  }
}

export async function POST(request: Request) {
  try {
    ready();
    const parsed = await body(request, Payload);
    if (parsed.error) return parsed.error;
    const input = parsed.data;

    const summary = getBusinessSummary();
    const goal: BusinessGoal = {
      id: newId("goal"),
      statement: input.statement,
      metric: input.metric,
      targetPercent: input.targetPercent,
      constraints: input.constraints,
      deadlineDays: input.deadlineDays,
      baselineValue: currentValue(input.metric, summary),
      currentValue: currentValue(input.metric, summary),
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    };
    createGoal(goal);

    if (!input.execute) return ok({ goal, plan: null });

    const run = await runPlan(await planForGoal(goal));
    return ok({
      goal,
      plan: {
        id: run.plan.id,
        title: run.plan.title,
        status: run.plan.status,
        tasks: run.tasks,
        results: run.results,
        failed: run.failed,
      },
    });
  } catch (error) {
    return handle(error, "goals:create");
  }
}

function currentValue(metric: GoalMetric, summary: ReturnType<typeof getBusinessSummary>): number {
  switch (metric) {
    case "profit": return summary.profitPaise;
    case "revenue": return summary.revenuePaise;
    case "conversion": return summary.conversionRate;
    case "margin": return summary.marginPercent;
    case "stockouts": return summary.inventoryRisks;
    case "refund_rate": return summary.revenuePaise === 0 ? 0 : (summary.refundsPaise / summary.revenuePaise) * 100;
    case "repeat_rate": return summary.orders;
  }
}
