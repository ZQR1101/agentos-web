import type { ModelInvocation, TaskObservability } from "@/types/task";

type UsageLike = { prompt_tokens?: number | null; completion_tokens?: number | null; total_tokens?: number | null } | null | undefined;
type ResponseLike = { id?: string; usage?: UsageLike };

function parseRate(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function createModelInvocation(agent: ModelInvocation["agent"], model: string, startedAt: number, response: ResponseLike, environment: NodeJS.ProcessEnv = process.env): ModelInvocation {
  const usage = response.usage;
  const promptTokens = usage?.prompt_tokens ?? undefined;
  const completionTokens = usage?.completion_tokens ?? undefined;
  const totalTokens = usage?.total_tokens ?? (promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined);
  const inputRate = parseRate(environment.DEEPSEEK_INPUT_PRICE_PER_1M_USD);
  const outputRate = parseRate(environment.DEEPSEEK_OUTPUT_PRICE_PER_1M_USD);
  const estimatedCostUsd = promptTokens !== undefined && completionTokens !== undefined && inputRate !== undefined && outputRate !== undefined
    ? Number(((promptTokens / 1_000_000) * inputRate + (completionTokens / 1_000_000) * outputRate).toFixed(8))
    : undefined;
  return { agent, model, responseId: response.id, latencyMs: Math.max(0, Date.now() - startedAt), promptTokens, completionTokens, totalTokens, estimatedCostUsd };
}

export function summarizeObservability(startedAt: string, modelCalls: ModelInvocation[], completedAt?: string): TaskObservability {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const totalTokens = modelCalls.reduce((sum, call) => sum + (call.totalTokens ?? 0), 0);
  const knownCosts = modelCalls.map((call) => call.estimatedCostUsd).filter((cost): cost is number => cost !== undefined);
  return {
    startedAt,
    updatedAt: new Date().toISOString(),
    completedAt,
    totalDurationMs: Math.max(0, end - start),
    totalTokens,
    estimatedCostUsd: knownCosts.length === modelCalls.length && modelCalls.length > 0 ? Number(knownCosts.reduce((sum, cost) => sum + cost, 0).toFixed(8)) : undefined,
    modelCalls,
  };
}
