import { runBugTriageTask } from "@/lib/bug-triage-workflow";
import { runCodeUnderstandingTask } from "@/lib/code-understanding-workflow";
import { runPullRequestReviewTask } from "@/lib/pull-request-review-workflow";
import { appendEngineeringTrace, claimEngineeringTask, getEngineeringTask, listEngineeringTasks, recoverExpiredEngineeringTasks, renewEngineeringTaskLease, requeueEngineeringTask, updateEngineeringTask } from "@/lib/engineering-task-store";
import { createEngineeringTraceContext, runWithEngineeringTrace, traceEngineeringOperation } from "@/lib/engineering-trace";

export type EngineeringTaskRunner = (taskId: string) => Promise<void>;
type RuntimeOptions = { runner?: EngineeringTaskRunner; workerId?: string; leaseMs?: number; retryDelayMs?: number };

const activeTasks = new Set<string>();
const scheduledTasks = new Map<string, ReturnType<typeof setTimeout>>();

async function dispatch(taskId: string) {
  const task = await getEngineeringTask(taskId);
  if (!task) return;
  const agent = task.input.useCase === "bug_triage" ? "bug-triage-agent" : task.input.useCase === "pull_request_review" ? "pull-request-review-agent" : "code-understanding-agent";
  await traceEngineeringOperation("agent", agent, async () => {
    if (task.input.useCase === "bug_triage") await runBugTriageTask(taskId);
    else if (task.input.useCase === "pull_request_review") await runPullRequestReviewTask(taskId);
    else await runCodeUnderstandingTask(taskId);
  }, { useCase: task.input.useCase });
}

export function shouldRetryEngineeringTask(task: { status: string; execution?: { attempt: number; maxAttempts: number } }) {
  return task.status === "failed" && (task.execution?.attempt ?? 0) < (task.execution?.maxAttempts ?? 3);
}

export async function processEngineeringTask(taskId: string, options: RuntimeOptions = {}) {
  const workerId = options.workerId ?? `runtime-${process.pid}-${crypto.randomUUID().slice(0, 6)}`;
  const leaseMs = options.leaseMs ?? 5 * 60_000;
  const claimed = await claimEngineeringTask(taskId, workerId, leaseMs);
  if (!claimed || claimed.status !== "running" || claimed.execution.leaseOwner !== workerId) return claimed;
  const traceContext = createEngineeringTraceContext(taskId, claimed.execution.attempt);
  const heartbeat = setInterval(() => { void renewEngineeringTaskLease(taskId, workerId, leaseMs).catch(() => undefined); }, Math.max(1_000, Math.floor(leaseMs / 3)));
  heartbeat.unref();
  try {
    await runWithEngineeringTrace(traceContext, () => traceEngineeringOperation("runtime", "engineering-task-attempt", () => (options.runner ?? dispatch)(taskId), { workerId, attempt: claimed.execution.attempt }));
  } catch (error) {
    const current = await getEngineeringTask(taskId);
    if (current?.status !== "cancelled") await updateEngineeringTask(taskId, { status: "failed", error: error instanceof Error ? error.message : "执行器异常。", events: [...(current?.events ?? claimed.events), "执行器捕获未处理异常"] });
  } finally { clearInterval(heartbeat); }

  let final = await getEngineeringTask(taskId);
  if (final?.status === "running") final = await updateEngineeringTask(taskId, { status: "failed", error: "Agent 未写入终态。", events: [...final.events, "执行器检测到任务缺少终态"] });
  if (final && final.status !== "completed") {
    const runtimeSpan = traceContext.spans.findLast((span) => span.kind === "runtime");
    if (runtimeSpan) { runtimeSpan.status = "error"; runtimeSpan.error = final.error ?? `任务终态：${final.status}`; }
  }
  if (final) final = await appendEngineeringTrace(taskId, traceContext.spans);
  if (final && shouldRetryEngineeringTask(final)) {
    const delay = options.retryDelayMs ?? Math.min(30_000, 1_500 * 2 ** Math.max(0, final.execution.attempt - 1));
    return requeueEngineeringTask(taskId, delay, final.error ?? "未知执行错误");
  }
  if (final && ["completed", "failed", "cancelled"].includes(final.status)) final = await updateEngineeringTask(taskId, { execution: { ...final.execution, leaseOwner: undefined, leaseExpiresAt: undefined } });
  return final;
}

export function kickEngineeringTask(taskId: string, delayMs = 0) {
  if (process.env.AGENTOS_INLINE_WORKER === "false") return;
  if (activeTasks.has(taskId) || scheduledTasks.has(taskId)) return;
  const timer = setTimeout(async () => {
    scheduledTasks.delete(taskId);
    if (activeTasks.has(taskId)) return;
    activeTasks.add(taskId);
    let result: Awaited<ReturnType<typeof processEngineeringTask>> | undefined;
    try {
      result = await processEngineeringTask(taskId);
    } finally { activeTasks.delete(taskId); }
    if (result?.status === "queued" && result.execution.nextAttemptAt) kickEngineeringTask(taskId, Math.max(0, new Date(result.execution.nextAttemptAt).getTime() - Date.now()));
  }, Math.max(0, delayMs));
  scheduledTasks.set(taskId, timer);
}

export async function resumeEngineeringTask(taskId: string) {
  await recoverExpiredEngineeringTasks();
  const task = await getEngineeringTask(taskId);
  if (task?.status === "queued") kickEngineeringTask(taskId, Math.max(0, new Date(task.execution.nextAttemptAt ?? 0).getTime() - Date.now()));
  return task;
}

export async function recoverAndResumeEngineeringTasks() {
  await recoverExpiredEngineeringTasks();
  const tasks = await listEngineeringTasks();
  for (const task of tasks) if (task.status === "queued") kickEngineeringTask(task.id, Math.max(0, new Date(task.execution?.nextAttemptAt ?? 0).getTime() - Date.now()));
  return tasks;
}

export async function runEngineeringWorkerOnce(options: RuntimeOptions & { concurrency?: number } = {}) {
  await recoverExpiredEngineeringTasks();
  const now = Date.now();
  const tasks = (await listEngineeringTasks()).filter((task) => task.status === "queued" && new Date(task.execution?.nextAttemptAt ?? 0).getTime() <= now).slice(0, options.concurrency ?? 2);
  return Promise.all(tasks.map((task, index) => processEngineeringTask(task.id, { ...options, workerId: `${options.workerId ?? `worker-${process.pid}`}-${index}` })));
}
