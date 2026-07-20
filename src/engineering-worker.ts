import { setTimeout as wait } from "node:timers/promises";
import { loadEnvConfig } from "@next/env";
import { runEngineeringWorkerOnce } from "@/lib/engineering-runtime";
import { closePostgresEngineeringStore, usingPostgresEngineeringStore } from "@/lib/postgres-engineering-task-store";

loadEnvConfig(process.cwd());

let stopping = false;
process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

async function main() {
  const intervalMs = Math.max(250, Number(process.env.AGENTOS_WORKER_POLL_MS ?? 1_000));
  const concurrency = Math.max(1, Number(process.env.AGENTOS_WORKER_CONCURRENCY ?? 2));
  console.log(`[AgentOS Worker] started storage=${usingPostgresEngineeringStore() ? "postgres" : "json"} concurrency=${concurrency}`);
  if (process.env.AGENTOS_WORKER_ONCE === "true") {
    const results = await runEngineeringWorkerOnce({ concurrency, workerId: `standalone-${process.pid}` });
    console.log(`[AgentOS Worker] once processed=${results.length}`);
    await closePostgresEngineeringStore();
    return;
  }
  while (!stopping) {
    try {
      const results = await runEngineeringWorkerOnce({ concurrency, workerId: `standalone-${process.pid}` });
      if (!results.length) await wait(intervalMs);
    } catch (error) {
      console.error("[AgentOS Worker] polling failed", error);
      await wait(intervalMs);
    }
  }
  await closePostgresEngineeringStore();
  console.log("[AgentOS Worker] stopped");
}

void main().catch((error) => { console.error("[AgentOS Worker] fatal", error); process.exitCode = 1; });
