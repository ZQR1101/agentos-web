import { Queue, Worker } from "bullmq";
import { runResearchWorkflow } from "@/lib/research-workflow";

export const RESEARCH_QUEUE_NAME = "agentos-research";
export type ResearchJob = { taskId: string; executionId: string };
type ResearchWorkflowRunner = (taskId: string, executionId: string) => Promise<void>;

const activeExecutions = new Map<string, string>();
let queue: Queue<ResearchJob, void, "research", ResearchJob, void, "research"> | undefined;
let workflowRunner: ResearchWorkflowRunner = runResearchWorkflow;

export function getQueueMode(environment: NodeJS.ProcessEnv = process.env) {
  return environment.REDIS_URL?.trim() ? "redis" as const : "in-memory" as const;
}

export function setResearchWorkflowRunnerForTests(runner?: ResearchWorkflowRunner) {
  workflowRunner = runner ?? runResearchWorkflow;
}

function assertRedisWorkerConfiguration() {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("Redis Worker 还需要 DATABASE_URL，确保 Web 与 Worker 共享任务状态。");
  }
}

function createRedisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL 未配置，无法创建 BullMQ 队列。" );
  return { url, maxRetriesPerRequest: null };
}

function getQueue() {
  queue ??= new Queue<ResearchJob, void, "research", ResearchJob, void, "research">(RESEARCH_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

export async function enqueueResearchTask(taskId: string, executionId: string) {
  if (getQueueMode() === "redis") {
    assertRedisWorkerConfiguration();
    await getQueue().add("research", { taskId, executionId }, { jobId: executionId, removeOnComplete: 100, removeOnFail: 100 });
    return true;
  }
  if (activeExecutions.has(taskId)) return false;
  activeExecutions.set(taskId, executionId);
  void Promise.resolve()
    .then(() => workflowRunner(taskId, executionId))
    .finally(() => activeExecutions.delete(taskId));
  return true;
}

export function isResearchTaskActive(taskId: string) {
  return activeExecutions.has(taskId);
}

export async function startRedisResearchWorker() {
  if (getQueueMode() !== "redis") throw new Error("REDIS_URL 未配置，无法启动 Redis Worker。" );
  assertRedisWorkerConfiguration();
  const worker = new Worker<ResearchJob>(RESEARCH_QUEUE_NAME, async (job) => {
    await workflowRunner(job.data.taskId, job.data.executionId);
  }, { connection: createRedisConnection(), concurrency: 4 });
  await worker.waitUntilReady();
  return worker;
}
