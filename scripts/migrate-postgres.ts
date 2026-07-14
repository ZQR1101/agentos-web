import { ensurePostgresSchema } from "../src/lib/postgres-task-store";

await ensurePostgresSchema();
console.log("PostgreSQL schema is ready.");
