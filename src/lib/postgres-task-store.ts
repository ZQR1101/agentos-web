import { Pool } from "pg";
import type { ResearchTask, TaskStatus } from "@/types/task";
import type { PersistentTaskStore, TaskPatch, TransitionResult } from "@/lib/task-store-types";

let pool: Pool | undefined;
let schemaReady: Promise<void> | undefined;

function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return undefined;
  pool ??= new Pool({ connectionString });
  return pool;
}

export async function ensurePostgresSchema() {
  const database = getPool();
  if (!database) throw new Error("DATABASE_URL 未配置，无法初始化 PostgreSQL。" );
  schemaReady ??= database.query(`
    CREATE TABLE IF NOT EXISTS research_tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      execution_id TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS research_tasks_status_updated_idx ON research_tasks(status, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS research_tasks_execution_id_idx ON research_tasks(execution_id) WHERE execution_id IS NOT NULL;
  `).then(() => undefined);
  return schemaReady;
}

function resolvePatch(task: ResearchTask, patch: TaskPatch) {
  const resolved = typeof patch === "function" ? patch(task) : patch;
  return { ...task, ...resolved, id: task.id, updatedAt: new Date().toISOString() } satisfies ResearchTask;
}

export class PostgresTaskStore implements PersistentTaskStore {
  async listTasks() {
    await ensurePostgresSchema();
    const result = await getPool()!.query<{ payload: ResearchTask }>("SELECT payload FROM research_tasks ORDER BY created_at DESC");
    return result.rows.map((row) => row.payload);
  }

  async getTask(id: string) {
    await ensurePostgresSchema();
    const result = await getPool()!.query<{ payload: ResearchTask }>("SELECT payload FROM research_tasks WHERE id = $1", [id]);
    return result.rows[0]?.payload;
  }

  async createTask(task: ResearchTask) {
    await ensurePostgresSchema();
    await getPool()!.query(
      "INSERT INTO research_tasks (id, status, execution_id, created_at, updated_at, payload) VALUES ($1, $2, $3, $4, $5, $6::jsonb)",
      [task.id, task.status, task.executionId ?? null, task.createdAt, task.updatedAt, JSON.stringify(task)],
    );
    return task;
  }

  async updateTask(id: string, patch: TaskPatch) {
    const result = await this.withTaskLock(id, undefined, patch);
    return result && !("outcome" in result) ? result : undefined;
  }

  async transitionTask(id: string, allowedStatuses: readonly TaskStatus[], patch: TaskPatch): Promise<TransitionResult> {
    const result = await this.withTaskLock(id, allowedStatuses, patch);
    if (!result) return { outcome: "not_found" };
    if ("outcome" in result) return result;
    return { outcome: "updated", task: result };
  }

  private async withTaskLock(id: string, allowedStatuses: readonly TaskStatus[] | undefined, patch: TaskPatch): Promise<ResearchTask | TransitionResult | undefined> {
    await ensurePostgresSchema();
    const client = await getPool()!.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<{ payload: ResearchTask }>("SELECT payload FROM research_tasks WHERE id = $1 FOR UPDATE", [id]);
      const current = selected.rows[0]?.payload;
      if (!current) {
        await client.query("COMMIT");
        return undefined;
      }
      if (allowedStatuses && !allowedStatuses.includes(current.status)) {
        await client.query("COMMIT");
        return { outcome: "status_mismatch", task: current };
      }
      const updated = resolvePatch(current, patch);
      await client.query(
        "UPDATE research_tasks SET status = $2, execution_id = $3, updated_at = $4, payload = $5::jsonb WHERE id = $1",
        [updated.id, updated.status, updated.executionId ?? null, updated.updatedAt, JSON.stringify(updated)],
      );
      await client.query("COMMIT");
      return updated;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

let postgresStore: PostgresTaskStore | undefined;

export function getPostgresTaskStore() {
  if (!process.env.DATABASE_URL) return undefined;
  postgresStore ??= new PostgresTaskStore();
  return postgresStore;
}
