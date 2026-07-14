import { startRedisResearchWorker } from "@/lib/task-worker";

const worker = await startRedisResearchWorker();
console.log("AgentOS Redis Worker is ready.");

const stop = async () => {
  await worker.close();
  process.exit(0);
};
process.on("SIGINT", () => { void stop(); });
process.on("SIGTERM", () => { void stop(); });
