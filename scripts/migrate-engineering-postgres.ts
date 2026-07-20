import { loadEnvConfig } from "@next/env";
import { closePostgresEngineeringStore, migratePostgresEngineeringStore } from "../src/lib/postgres-engineering-task-store";

void (async () => {
  loadEnvConfig(process.cwd());
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 未配置。");
  await migratePostgresEngineeringStore();
  await closePostgresEngineeringStore();
  console.log("engineering_tasks migration complete");
})().catch((error) => { console.error(error); process.exitCode = 1; });
