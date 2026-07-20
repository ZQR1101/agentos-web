import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createEngineeringPlan } from "@/lib/software-engineering-workflow";
import { createPostgresEngineeringTask, getPostgresEngineeringTask, listPostgresEngineeringTasks, mutatePostgresEngineeringTask, recoverExpiredPostgresEngineeringTasks, usingPostgresEngineeringStore } from "@/lib/postgres-engineering-task-store";
import type { ApprovalDecision, EngineeringAnalysisTask, EngineeringTaskInput } from "@/types/software-engineering";
import { mergeEngineeringTrace, type EngineeringTraceSpan } from "@/lib/engineering-trace";

let writeQueue: Promise<void> = Promise.resolve();
const productionDataFile = path.join(process.cwd(), ".data", "engineering-tasks.json");
const testDataFile = () => path.join(process.cwd(), ".data", `engineering-tasks${process.env.AGENTOS_TEST_STORE_SUFFIX ? `.${process.env.AGENTOS_TEST_STORE_SUFFIX.replace(/[^a-zA-Z0-9_-]/g, "")}` : ""}.test.json`);
const dataFile = () => process.env.AGENTOS_TEST_TASK_STORE === "1" ? testDataFile() : productionDataFile;

async function readTasks() {
  try { return JSON.parse(await readFile(dataFile(), "utf8")) as EngineeringAnalysisTask[]; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

async function saveTasks(tasks: EngineeringAnalysisTask[]) {
  await mkdir(path.dirname(dataFile()), { recursive: true });
  const temporaryFile = `${dataFile()}.${crypto.randomUUID()}.tmp`;
  try { await writeFile(temporaryFile, JSON.stringify(tasks, null, 2), "utf8"); await rename(temporaryFile, dataFile()); }
  finally { await rm(temporaryFile, { force: true }).catch(() => undefined); }
}

export async function createEngineeringTask(input: EngineeringTaskInput, organizationId: string, trigger?: EngineeringAnalysisTask["trigger"]) {
  const operation = writeQueue.then(async () => {
    const now = new Date().toISOString();
    const task: EngineeringAnalysisTask = { id: `eng_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`, organizationId, ...(trigger ? { trigger } : {}), status: "waiting_approval", input, plan: createEngineeringPlan(input), events: [`任务已创建并绑定组织：${organizationId}`, ...(trigger ? [`GitHub Webhook：${trigger.event}.${trigger.action} · delivery ${trigger.deliveryId}`] : []), "等待只读访问审批"], execution: { attempt: 0, maxAttempts: 3 }, createdAt: now, updatedAt: now };
    if (usingPostgresEngineeringStore()) return createPostgresEngineeringTask(task);
    const tasks = await readTasks(); tasks.push(task); await saveTasks(tasks); return task;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function listEngineeringTasks(organizationId?: string) { await writeQueue; return usingPostgresEngineeringStore() ? listPostgresEngineeringTasks(organizationId) : (await readTasks()).filter((task) => !organizationId || task.organizationId === organizationId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }

export async function updateEngineeringTask(id: string, patch: Partial<EngineeringAnalysisTask>) {
  return mutateTask(id, (current) => {
    if (current.status === "cancelled" && patch.status && patch.status !== "cancelled") return current;
    return { ...current, ...patch, execution: { ...(current.execution ?? { attempt: 0, maxAttempts: 3 }), ...(patch.execution ?? {}) }, id: current.id };
  });
}

export async function getEngineeringTask(id: string, organizationId?: string) { await writeQueue; return usingPostgresEngineeringStore() ? getPostgresEngineeringTask(id, organizationId) : (await readTasks()).find((task) => task.id === id && (!organizationId || task.organizationId === organizationId)); }

export async function approveEngineeringTask(id: string, decision: ApprovalDecision & { decision: "approved" }) {
  return mutateTask(id, (current, now) => current.status !== "waiting_approval" ? current : ({ ...current, status: "queued", approval: decision, approvalHistory: [...(current.approvalHistory ?? []), decision], error: undefined, execution: { ...(current.execution ?? { attempt: 0, maxAttempts: 3 }), nextAttemptAt: now, leaseOwner: undefined, leaseExpiresAt: undefined }, events: [...current.events, `审批通过：${decision.actor.displayName}（${decision.actor.id}）依据 ${decision.policyId} 授予 github:read`, "任务已进入持久化队列"] }));
}

export async function recordEngineeringApprovalDenial(id: string, decision: ApprovalDecision & { decision: "denied" }) {
  return mutateTask(id, (current) => ({ ...current, approvalHistory: [...(current.approvalHistory ?? []), decision], events: [...current.events, `审批拒绝：${decision.actor.displayName}（${decision.actor.id}）· ${decision.reason}`] }));
}

export async function claimEngineeringTask(id: string, workerId: string, leaseMs: number, now = new Date()) {
  return mutateTask(id, (current) => {
    const execution = current.execution ?? { attempt: 0, maxAttempts: 3 };
    if (current.status !== "queued" || (execution.nextAttemptAt && new Date(execution.nextAttemptAt) > now)) return current;
    return { ...current, status: "running", execution: { ...execution, attempt: execution.attempt + 1, leaseOwner: workerId, leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(), lastStartedAt: now.toISOString(), nextAttemptAt: undefined }, events: [...current.events, `执行器领取任务：第 ${execution.attempt + 1}/${execution.maxAttempts} 次尝试`] };
  }, (task) => task.status === "running" && task.execution?.leaseOwner === workerId);
}

export async function requeueEngineeringTask(id: string, delayMs: number, reason: string, now = new Date()) {
  return mutateTask(id, (current) => {
    if (current.status === "cancelled" || current.status === "completed") return current;
    return { ...current, status: "queued", error: reason, execution: { ...(current.execution ?? { attempt: 0, maxAttempts: 3 }), nextAttemptAt: new Date(now.getTime() + delayMs).toISOString(), leaseOwner: undefined, leaseExpiresAt: undefined }, events: [...current.events, `执行失败，将在 ${Math.ceil(delayMs / 1000)} 秒后重试：${reason}`] };
  });
}

export async function renewEngineeringTaskLease(id: string, workerId: string, leaseMs: number, now = new Date()) {
  return mutateTask(id, (current) => current.status === "running" && current.execution?.leaseOwner === workerId ? ({ ...current, execution: { ...current.execution, leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString() } }) : current);
}

export async function cancelEngineeringTask(id: string) {
  return mutateTask(id, (current, now) => ["completed", "failed", "cancelled"].includes(current.status) ? current : ({ ...current, status: "cancelled", completedAt: now, execution: { ...(current.execution ?? { attempt: 0, maxAttempts: 3 }), leaseOwner: undefined, leaseExpiresAt: undefined, nextAttemptAt: undefined }, events: [...current.events, "用户已取消任务；后续结果将被丢弃"] }));
}

export async function retryFailedEngineeringTask(id: string) {
  return mutateTask(id, (current, now) => current.status !== "failed" ? current : ({ ...current, status: "queued", error: undefined, completedAt: undefined, execution: { ...(current.execution ?? { attempt: 0, maxAttempts: 3 }), attempt: 0, nextAttemptAt: now, leaseOwner: undefined, leaseExpiresAt: undefined }, events: [...current.events, "用户发起手动重试，重试预算已重置"] }));
}

export async function reviewEngineeringTask(id: string, verdict: "accepted" | "needs_changes" | "rejected", note?: string) {
  return mutateTask(id, (current, now) => current.status !== "completed" ? current : ({ ...current, humanReview: { verdict, ...(note ? { note } : {}), reviewedAt: now }, events: [...current.events, `人工复核：${verdict}${note ? ` · ${note}` : ""}`] }));
}

export async function appendEngineeringTrace(id: string, spans: EngineeringTraceSpan[]) {
  return mutateTask(id, (current) => spans.length ? ({ ...current, trace: mergeEngineeringTrace(current.trace, spans) }) : current);
}

export async function recoverExpiredEngineeringTasks(now = new Date()) {
  if (usingPostgresEngineeringStore()) return recoverExpiredPostgresEngineeringTasks(now);
  const operation = writeQueue.then(async () => {
    const tasks = await readTasks();
    const recovered: string[] = [];
    for (let index = 0; index < tasks.length; index += 1) {
      const current = tasks[index];
      const execution = current.execution ?? { attempt: 0, maxAttempts: 3 };
      if (current.status === "running" && execution.leaseExpiresAt && new Date(execution.leaseExpiresAt) <= now) {
        tasks[index] = { ...current, status: "queued", execution: { ...execution, nextAttemptAt: now.toISOString(), leaseOwner: undefined, leaseExpiresAt: undefined }, events: [...current.events, "检测到执行租约过期，任务已恢复到队列"], updatedAt: now.toISOString() };
        recovered.push(current.id);
      }
    }
    if (recovered.length) await saveTasks(tasks);
    return recovered;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function mutateTask(id: string, mutation: (current: EngineeringAnalysisTask, now: string) => EngineeringAnalysisTask, accept: (task: EngineeringAnalysisTask) => boolean = () => true) {
  if (usingPostgresEngineeringStore()) return mutatePostgresEngineeringTask(id, mutation, accept);
  const operation = writeQueue.then(async () => {
    const tasks = await readTasks();
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) return undefined;
    const now = new Date().toISOString();
    const candidate = mutation(tasks[index], now);
    if (!accept(candidate) || candidate === tasks[index]) return candidate;
    const updated = { ...candidate, id: tasks[index].id, updatedAt: now };
    tasks[index] = updated;
    await saveTasks(tasks);
    return updated;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
