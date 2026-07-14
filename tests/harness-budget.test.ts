import assert from "node:assert/strict";
import test from "node:test";
import { createHarnessBudget, HarnessBudgetExceededError } from "../src/lib/harness-budget";

test("Harness budget records authorized model and tool actions", () => {
  let now = 1_000;
  const budget = createHarnessBudget({}, () => now);
  budget.consume("model", "Planner");
  now += 250;
  const snapshot = budget.consume("tool", "search_web");

  assert.deepEqual(snapshot.usage, {
    steps: 2,
    modelCalls: 1,
    toolCalls: 1,
    elapsedMs: 250,
    lastAction: "search_web",
  });
  assert.equal(snapshot.limits.maxSteps, 8);
});

test("Harness budget fails closed before exceeding each call limit", () => {
  const modelBudget = createHarnessBudget({ maxSteps: 9, maxModelCalls: 1 });
  modelBudget.consume("model", "Planner");
  assert.throws(() => modelBudget.consume("model", "Executor"), HarnessBudgetExceededError);

  const toolBudget = createHarnessBudget({ maxSteps: 9, maxToolCalls: 1 });
  toolBudget.consume("tool", "search_web");
  assert.throws(() => toolBudget.consume("tool", "second_tool"), HarnessBudgetExceededError);

  const stepBudget = createHarnessBudget({ maxSteps: 1, maxModelCalls: 9 });
  stepBudget.consume("model", "Planner");
  assert.throws(() => stepBudget.consume("model", "Executor"), HarnessBudgetExceededError);
});

test("Harness budget rejects work after the total duration limit", () => {
  let now = 5_000;
  const budget = createHarnessBudget({ maxDurationMs: 1_000 }, () => now);
  budget.consume("model", "Planner");
  now += 1_001;
  assert.throws(() => budget.consume("tool", "search_web"), /总耗时预算已超限/);
});
