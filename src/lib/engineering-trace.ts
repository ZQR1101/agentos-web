import { AsyncLocalStorage } from "node:async_hooks";
import type { EngineeringAnalysisTask } from "@/types/software-engineering";

export type EngineeringTraceSpan = NonNullable<EngineeringAnalysisTask["trace"]>["spans"][number];
type TraceKind = EngineeringTraceSpan["kind"];
export type EngineeringTraceContext = { taskId: string; attempt: number; spans: EngineeringTraceSpan[] };

const storage = new AsyncLocalStorage<EngineeringTraceContext>();

export function createEngineeringTraceContext(taskId: string, attempt: number): EngineeringTraceContext { return { taskId, attempt, spans: [] }; }
export function runWithEngineeringTrace<T>(context: EngineeringTraceContext, operation: () => Promise<T>) { return storage.run(context, operation); }

export async function traceEngineeringOperation<T>(kind: TraceKind, name: string, operation: () => Promise<T>, attributes?: EngineeringTraceSpan["attributes"]) {
  const context = storage.getStore();
  if (!context) return operation();
  const startedAt = new Date(); const started = performance.now();
  try {
    const result = await operation();
    context.spans.push({ id: crypto.randomUUID(), attempt: context.attempt, kind, name, status: "ok", startedAt: startedAt.toISOString(), endedAt: new Date().toISOString(), durationMs: Math.max(0, Math.round(performance.now() - started)), attributes });
    return result;
  } catch (error) {
    context.spans.push({ id: crypto.randomUUID(), attempt: context.attempt, kind, name, status: "error", startedAt: startedAt.toISOString(), endedAt: new Date().toISOString(), durationMs: Math.max(0, Math.round(performance.now() - started)), error: error instanceof Error ? error.message : "未知异常", attributes });
    throw error;
  }
}

export function mergeEngineeringTrace(existing: EngineeringAnalysisTask["trace"], incoming: EngineeringTraceSpan[]) {
  const spans = [...(existing?.spans ?? []), ...incoming];
  const attempts = new Set(spans.map((span) => span.attempt)).size;
  return { spans, summary: {
    attempts,
    totalDurationMs: spans.filter((span) => span.kind === "runtime").reduce((sum, span) => sum + span.durationMs, 0),
    toolDurationMs: spans.filter((span) => span.kind === "tool").reduce((sum, span) => sum + span.durationMs, 0),
    toolCalls: spans.filter((span) => span.kind === "tool").length,
    agentSteps: spans.filter((span) => span.kind === "agent" || span.kind === "reviewer").length,
    modelCalls: spans.filter((span) => span.kind === "model").length,
    failedSpans: spans.filter((span) => span.status === "error").length,
    tokenUsage: "not_collected" as const,
  } };
}
