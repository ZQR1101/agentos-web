import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ResearchTask } from "@/types/task";

const dataDir = path.join(process.cwd(), ".data");
const dataFile = path.join(dataDir, "tasks.json");
let writeQueue = Promise.resolve();

async function readTasks(): Promise<ResearchTask[]> {
  try { return JSON.parse(await readFile(dataFile, "utf8")) as ResearchTask[]; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

async function saveTasks(tasks: ResearchTask[]) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dataFile, JSON.stringify(tasks, null, 2), "utf8");
}

export async function listTasks() { return (await readTasks()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export async function getTask(id: string) { return (await readTasks()).find((task) => task.id === id); }

export async function createTask(topic: string) {
  const now = new Date().toISOString();
  const task: ResearchTask = { id: `run_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`, topic, status: "waiting_approval", currentStep: 1, attempts: 0, events: ["任务已创建，等待执行审批"], createdAt: now, updatedAt: now };
  writeQueue = writeQueue.then(async () => { const tasks = await readTasks(); tasks.push(task); await saveTasks(tasks); });
  await writeQueue;
  return task;
}

export async function updateTask(id: string, patch: Partial<ResearchTask>) {
  let updated: ResearchTask | undefined;
  writeQueue = writeQueue.then(async () => {
    const tasks = await readTasks();
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) return;
    updated = { ...tasks[index], ...patch, id, updatedAt: new Date().toISOString() };
    tasks[index] = updated;
    await saveTasks(tasks);
  });
  await writeQueue;
  return updated;
}
