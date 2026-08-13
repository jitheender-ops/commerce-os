import { getBusinessSummary, listGoals } from "@/database/queries";
import { GoalForm } from "@/components/interactive";
import { Badge, Empty, Meter, Panel, SectionTitle } from "@/components/ui";
import { formatMoneyCompact } from "@/lib/money";
import type { GoalMetric } from "@/types";

export default function GoalsPage() {
  const summary = getBusinessSummary();
  const goals = listGoals();

  const current = (metric: GoalMetric): number => {
    switch (metric) {
      case "profit": return summary.profitPaise;
      case "revenue": return summary.revenuePaise;
      case "conversion": return summary.conversionRate;
      case "margin": return summary.marginPercent;
      case "stockouts": return summary.inventoryRisks;
      case "refund_rate":
        return summary.revenuePaise === 0 ? 0 : (summary.refundsPaise / summary.revenuePaise) * 100;
      case "repeat_rate": return summary.orders;
    }
  };

  const isMoney = (metric: GoalMetric) => metric === "profit" || metric === "revenue";

  return (
    <div className="space-y-5">
      <SectionTitle hint="A goal selects a plan template; the plan decomposes into agent tasks">
        Business Goals
      </SectionTitle>

      <GoalForm />

      <Panel title="Active goals" bodyClassName={goals.length ? "p-0" : undefined}>
        {goals.length === 0 ? (
          <Empty title="No goals yet" hint="Create one above and the orchestrator will run it." />
        ) : (
          <ul>
            {goals.map((goal) => {
              const value = current(goal.metric);
              const achieved =
                goal.baselineValue === 0
                  ? 0
                  : ((value - goal.baselineValue) / Math.abs(goal.baselineValue)) * 100;
              const progress =
                goal.targetPercent === 0
                  ? 0
                  : Math.max(0, Math.min(100, (achieved / goal.targetPercent) * 100));

              return (
                <li key={goal.id} className="border-b px-4 py-3 last:border-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-[13px] font-medium">{goal.statement}</p>
                      <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>
                        {goal.metric} · target {goal.targetPercent > 0 ? "+" : ""}
                        {goal.targetPercent}% · {goal.deadlineDays} days
                      </p>
                    </div>
                    <Badge tone={progress >= 100 ? "good" : progress > 40 ? "warn" : "neutral"}>
                      {progress.toFixed(0)}% of target
                    </Badge>
                  </div>

                  <div className="mt-2">
                    <Meter value={progress} tone={progress >= 100 ? "good" : "accent"} />
                  </div>

                  <div className="mt-1.5 flex flex-wrap gap-4 text-[11px]" style={{ color: "var(--ink-3)" }}>
                    <span className="num">
                      baseline{" "}
                      {isMoney(goal.metric)
                        ? formatMoneyCompact(goal.baselineValue)
                        : goal.baselineValue.toFixed(2)}
                    </span>
                    <span className="num">
                      now{" "}
                      {isMoney(goal.metric) ? formatMoneyCompact(value) : value.toFixed(2)}
                    </span>
                    <span className="num">
                      moved {achieved > 0 ? "+" : ""}
                      {achieved.toFixed(1)}%
                    </span>
                  </div>

                  {goal.constraints.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {goal.constraints.map((constraint) => (
                        <Badge key={constraint} tone="warn">
                          {constraint}
                        </Badge>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
