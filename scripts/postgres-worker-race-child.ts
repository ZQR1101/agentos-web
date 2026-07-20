import { loadEnvConfig } from "@next/env";
import { claimEngineeringTask } from "../src/lib/engineering-task-store";
import { closePostgresEngineeringStore } from "../src/lib/postgres-engineering-task-store";

void (async () => {
  loadEnvConfig(process.cwd());
  const [taskId, workerId] = process.argv.slice(2);
  if (!taskId || !workerId) throw new Error("用法：postgres-worker-race-child <taskId> <workerId>");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 未配置。");

  if (process.send) {
    process.send({ type: "ready", workerId });
    await new Promise<void>((resolve) => process.once("message", (message) => {
      if ((message as { type?: string })?.type === "start") resolve();
    }));
  }

  const task = await claimEngineeringTask(taskId, workerId, 30_000);
  console.log(JSON.stringify({
    workerId,
    claimed: task?.status === "running" && task.execution.leaseOwner === workerId,
    observedStatus: task?.status,
    observedOwner: task?.execution.leaseOwner,
    attempt: task?.execution.attempt,
  }));
  await closePostgresEngineeringStore();
})().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await closePostgresEngineeringStore().catch(() => undefined);
  process.exitCode = 1;
});
