/**
 * The plan validator is the safety net for model-driven orchestration: it is
 * the only thing standing between a malformed LLM response and a broken run.
 * It is tested directly, against the shapes models actually get wrong.
 */
import { describe, expect, it } from "vitest";
import { validate, type ModelPlan } from "@/orchestration/llm-planner";

const ok: ModelPlan = {
  title: "Investigate the revenue movement",
  tasks: [
    { key: "analyse", agentId: "analytics", title: "Decompose revenue", dependsOn: [] },
    { key: "stock", agentId: "inventory", title: "Check availability", dependsOn: ["analyse"] },
    { key: "decide", agentId: "ceo", title: "Synthesise", dependsOn: ["analyse", "stock"] },
  ],
};

describe("model plan validation", () => {
  it("accepts a well-formed plan", () => {
    expect(validate(ok)).toBeNull();
  });

  it("accepts parallel tasks with no dependencies", () => {
    expect(
      validate({
        title: "Wide sweep",
        tasks: [
          { key: "a", agentId: "analytics", title: "A", dependsOn: [] },
          { key: "b", agentId: "pricing", title: "B", dependsOn: [] },
          { key: "c", agentId: "marketing", title: "C", dependsOn: [] },
          { key: "d", agentId: "ceo", title: "D", dependsOn: ["a", "b", "c"] },
        ],
      }),
    ).toBeNull();
  });

  it("rejects a hallucinated agent", () => {
    const plan = { ...ok, tasks: [...ok.tasks, { key: "x", agentId: "logistics", title: "X", dependsOn: [] }] };
    expect(validate(plan)).toContain("unknown agent");
  });

  it("rejects duplicate task keys", () => {
    const plan = { ...ok, tasks: [...ok.tasks, { key: "analyse", agentId: "pricing", title: "Dup", dependsOn: [] }] };
    expect(validate(plan)).toContain("duplicate task key");
  });

  it("rejects a dependency on a task that does not exist", () => {
    const plan: ModelPlan = {
      title: "Broken",
      tasks: [
        { key: "a", agentId: "analytics", title: "A", dependsOn: ["ghost"] },
        { key: "decide", agentId: "ceo", title: "D", dependsOn: ["a"] },
      ],
    };
    expect(validate(plan)).toContain("unknown task");
  });

  it("rejects a self-dependency", () => {
    const plan: ModelPlan = {
      title: "Self",
      tasks: [
        { key: "a", agentId: "analytics", title: "A", dependsOn: ["a"] },
        { key: "decide", agentId: "ceo", title: "D", dependsOn: [] },
      ],
    };
    expect(validate(plan)).toContain("depends on itself");
  });

  it("rejects a dependency cycle", () => {
    // The failure that would hang the DAG walker forever if it got through.
    const plan: ModelPlan = {
      title: "Cycle",
      tasks: [
        { key: "a", agentId: "analytics", title: "A", dependsOn: ["b"] },
        { key: "b", agentId: "pricing", title: "B", dependsOn: ["c"] },
        { key: "c", agentId: "inventory", title: "C", dependsOn: ["a"] },
        { key: "decide", agentId: "ceo", title: "D", dependsOn: ["a"] },
      ],
    };
    expect(validate(plan)).toContain("cycle");
  });

  it("rejects a plan with no synthesis step", () => {
    const plan: ModelPlan = {
      title: "No CEO",
      tasks: [
        { key: "a", agentId: "analytics", title: "A", dependsOn: [] },
        { key: "b", agentId: "pricing", title: "B", dependsOn: ["a"] },
      ],
    };
    expect(validate(plan)).toContain("ceo");
  });

  it("rejects a plan whose CEO task is not terminal", () => {
    // A CEO step someone else depends on isn't a synthesis step.
    const plan: ModelPlan = {
      title: "CEO in the middle",
      tasks: [
        { key: "decide", agentId: "ceo", title: "Decide early", dependsOn: [] },
        { key: "after", agentId: "pricing", title: "Act", dependsOn: ["decide"] },
      ],
    };
    expect(validate(plan)).toContain("ceo");
  });
});
