import type { HarnessBudgetSnapshot, HarnessLimits, HarnessUsage } from "@/types/task";

export const DEFAULT_HARNESS_LIMITS: HarnessLimits = {
  maxSteps: 8,
  maxModelCalls: 5,
  maxToolCalls: 3,
  maxDurationMs: 180_000,
};

export type HarnessActionKind = "model" | "tool";

export class HarnessBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessBudgetExceededError";
  }
}

export function createHarnessBudget(
  overrides: Partial<HarnessLimits> = {},
  now: () => number = Date.now,
) {
  const limits: HarnessLimits = { ...DEFAULT_HARNESS_LIMITS, ...overrides };
  const startedAt = now();
  let usage: HarnessUsage = { steps: 0, modelCalls: 0, toolCalls: 0, elapsedMs: 0 };

  function elapsedMs() {
    return Math.max(0, now() - startedAt);
  }

  function assertWithinDuration(label: string) {
    const elapsed = elapsedMs();
    if (elapsed > limits.maxDurationMs) {
      throw new HarnessBudgetExceededError(`Harness 总耗时预算已超限：${label} 时已用 ${elapsed}ms / ${limits.maxDurationMs}ms。`);
    }
  }

  function snapshot(): HarnessBudgetSnapshot {
    return {
      limits: { ...limits },
      usage: { ...usage, elapsedMs: elapsedMs() },
    };
  }

  function consume(kind: HarnessActionKind, label: string) {
    assertWithinDuration(label);
    const next: HarnessUsage = {
      steps: usage.steps + 1,
      modelCalls: usage.modelCalls + (kind === "model" ? 1 : 0),
      toolCalls: usage.toolCalls + (kind === "tool" ? 1 : 0),
      elapsedMs: elapsedMs(),
      lastAction: label,
    };
    if (next.steps > limits.maxSteps) {
      throw new HarnessBudgetExceededError(`Harness 步骤预算已超限：${next.steps} / ${limits.maxSteps}。`);
    }
    if (next.modelCalls > limits.maxModelCalls) {
      throw new HarnessBudgetExceededError(`Harness 模型调用预算已超限：${next.modelCalls} / ${limits.maxModelCalls}。`);
    }
    if (next.toolCalls > limits.maxToolCalls) {
      throw new HarnessBudgetExceededError(`Harness 工具调用预算已超限：${next.toolCalls} / ${limits.maxToolCalls}。`);
    }
    usage = next;
    return snapshot();
  }

  return { consume, snapshot, assertWithinDuration };
}
