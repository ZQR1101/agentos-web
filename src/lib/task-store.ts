import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ResearchTask, TaskStatus } from "@/types/task";
import { getPostgresTaskStore } from "@/lib/postgres-task-store";
import type { TaskPatch, TransitionResult } from "@/lib/task-store-types";

export type { TaskPatch, TransitionResult } from "@/lib/task-store-types";

export function getTaskStoreMode(environment: NodeJS.ProcessEnv = process.env) {
  return environment.DATABASE_URL?.trim() ? "postgres" as const : "json" as const;
}

let writeQueue: Promise<void> = Promise.resolve();

function getDataFile() {
  return path.join(process.cwd(), ".data", "tasks.json");
}

async function readTasks(): Promise<ResearchTask[]> {
  try {
    return JSON.parse(await readFile(getDataFile(), "utf8")) as ResearchTask[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function saveTasks(tasks: ResearchTask[]) {
  const dataFile = getDataFile();
  await mkdir(path.dirname(dataFile), { recursive: true });
  const temporaryFile = `${dataFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporaryFile, JSON.stringify(tasks, null, 2), "utf8");
    await rename(temporaryFile, dataFile);
  } finally {
    await rm(temporaryFile, { force: true }).catch(() => undefined);
  }
}

function withWriteLock<T>(operation: () => Promise<T>) {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function readAfterPendingWrites() {
  await writeQueue;
  return readTasks();
}

export async function listTasks() {
  const postgres = getPostgresTaskStore();
  if (postgres) return postgres.listTasks();
  return (await readAfterPendingWrites()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getTask(id: string) {
  const postgres = getPostgresTaskStore();
  if (postgres) return postgres.getTask(id);
  return (await readAfterPendingWrites()).find((task) => task.id === id);
}

export async function createTask(topic: string) {
  const now = new Date().toISOString();
  const task: ResearchTask = {
    id: `run_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`,
    topic,
    status: "waiting_approval",
    currentStep: 1,
    attempts: 0,
    events: ["任务已创建，等待执行审批"],
    createdAt: now,
    updatedAt: now,
  };
  const postgres = getPostgresTaskStore();
  if (postgres) return postgres.createTask(task);
  return withWriteLock(async () => {
    const tasks = await readTasks();
    tasks.push(task);
    await saveTasks(tasks);
    return task;
  });
}

export async function updateTask(id: string, patch: TaskPatch) {
  const postgres = getPostgresTaskStore();
  if (postgres) return postgres.updateTask(id, patch);
  return withWriteLock(async () => {
    const tasks = await readTasks();
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) return undefined;
    const current = tasks[index];
    const resolvedPatch = typeof patch === "function" ? patch(current) : patch;
    const updated: ResearchTask = { ...current, ...resolvedPatch, id, updatedAt: new Date().toISOString() };
    tasks[index] = updated;
    await saveTasks(tasks);
    return updated;
  });
}

export async function transitionTask(id: string, allowedStatuses: readonly TaskStatus[], patch: TaskPatch): Promise<TransitionResult> {
  const postgres = getPostgresTaskStore();
  if (postgres) return postgres.transitionTask(id, allowedStatuses, patch);
  return withWriteLock(async () => {
    const tasks = await readTasks();
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) return { outcome: "not_found" };
    const current = tasks[index];
    if (!allowedStatuses.includes(current.status)) return { outcome: "status_mismatch", task: current };
    const resolvedPatch = typeof patch === "function" ? patch(current) : patch;
    const updated: ResearchTask = { ...current, ...resolvedPatch, id, updatedAt: new Date().toISOString() };
    tasks[index] = updated;
    await saveTasks(tasks);
    return { outcome: "updated", task: updated };
  });
}
