import { Pool, type PoolClient } from "pg";
import type { EngineeringAnalysisTask } from "@/types/software-engineering";

let pool: Pool | undefined;
let schemaPromise: Promise<void> | undefined;

export function usingPostgresEngineeringStore() { return Boolean(process.env.DATABASE_URL); }

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 未配置，无法使用 PostgreSQL 工程任务存储。");
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.AGENTOS_DB_POOL_SIZE ?? 10), application_name: "agentos-runtime" });
  return pool;
}

export async function migratePostgresEngineeringStore() {
  const legacyOrganizationId = process.env.AGENTOS_LEGACY_ORGANIZATION_ID ?? process.env.AGENTOS_LOCAL_ORGANIZATION_ID ?? "local";
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS engineering_tasks (
      id TEXT PRIMARY KEY,
      organization_id TEXT,
      status TEXT NOT NULL,
      task JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE engineering_tasks ADD COLUMN IF NOT EXISTS organization_id TEXT;
    CREATE TABLE IF NOT EXISTS github_webhook_deliveries (
      delivery_id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      action TEXT,
      organization_id TEXT,
      installation_id BIGINT,
      payload_digest TEXT NOT NULL,
      status TEXT NOT NULL,
      task_id TEXT,
      detail TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await getPool().query("UPDATE engineering_tasks SET organization_id = COALESCE(organization_id, task->>'organizationId', $1), task = CASE WHEN task ? 'organizationId' THEN task ELSE jsonb_set(task, '{organizationId}', to_jsonb(COALESCE(organization_id, $1::text))) END WHERE organization_id IS NULL OR NOT (task ? 'organizationId')", [legacyOrganizationId]);
  await getPool().query(`ALTER TABLE engineering_tasks ALTER COLUMN organization_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS engineering_tasks_status_updated_idx ON engineering_tasks (status, updated_at);
    CREATE INDEX IF NOT EXISTS engineering_tasks_org_created_idx ON engineering_tasks (organization_id, ((task->>'createdAt')) DESC);`);
}

async function ensureSchema() {
  schemaPromise ??= migratePostgresEngineeringStore().catch((error) => { schemaPromise = undefined; throw error; });
  await schemaPromise;
}

function parseTask(value: unknown) { return value as EngineeringAnalysisTask; }

export async function createPostgresEngineeringTask(task: EngineeringAnalysisTask) {
  await ensureSchema();
  await getPool().query("INSERT INTO engineering_tasks (id, organization_id, status, task, updated_at) VALUES ($1, $2, $3, $4::jsonb, $5)", [task.id, task.organizationId, task.status, JSON.stringify(task), task.updatedAt]);
  return task;
}

export async function listPostgresEngineeringTasks(organizationId?: string) {
  await ensureSchema();
  const result = await getPool().query<{ task: unknown }>("SELECT task FROM engineering_tasks WHERE $1::text IS NULL OR organization_id = $1 ORDER BY (task->>'createdAt') DESC", [organizationId ?? null]);
  return result.rows.map((row) => parseTask(row.task));
}

export async function getPostgresEngineeringTask(id: string, organizationId?: string) {
  await ensureSchema();
  const result = await getPool().query<{ task: unknown }>("SELECT task FROM engineering_tasks WHERE id = $1 AND ($2::text IS NULL OR organization_id = $2)", [id, organizationId ?? null]);
  return result.rows[0] ? parseTask(result.rows[0].task) : undefined;
}

export async function mutatePostgresEngineeringTask(id: string, mutation: (current: EngineeringAnalysisTask, now: string) => EngineeringAnalysisTask, accept: (task: EngineeringAnalysisTask) => boolean = () => true) {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ task: unknown }>("SELECT task FROM engineering_tasks WHERE id = $1 FOR UPDATE", [id]);
    if (!result.rows[0]) { await client.query("ROLLBACK"); return undefined; }
    const current = parseTask(result.rows[0].task);
    const now = new Date().toISOString();
    const candidate = mutation(current, now);
    if (!accept(candidate) || candidate === current) { await client.query("COMMIT"); return candidate; }
    const updated: EngineeringAnalysisTask = { ...candidate, id: current.id, organizationId: current.organizationId, updatedAt: now };
    await client.query("UPDATE engineering_tasks SET status = $2, task = $3::jsonb, updated_at = $4 WHERE id = $1", [id, updated.status, JSON.stringify(updated), now]);
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await rollback(client);
    throw error;
  } finally { client.release(); }
}

export async function recoverExpiredPostgresEngineeringTasks(now = new Date()) {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ task: unknown }>("SELECT task FROM engineering_tasks WHERE status = 'running' FOR UPDATE SKIP LOCKED");
    const recovered: string[] = [];
    for (const row of result.rows) {
      const current = parseTask(row.task);
      const execution = current.execution ?? { attempt: 0, maxAttempts: 3 };
      if (!execution.leaseExpiresAt || new Date(execution.leaseExpiresAt) > now) continue;
      const updated: EngineeringAnalysisTask = { ...current, status: "queued", execution: { ...execution, nextAttemptAt: now.toISOString(), leaseOwner: undefined, leaseExpiresAt: undefined }, events: [...current.events, "检测到执行租约过期，任务已恢复到队列"], updatedAt: now.toISOString() };
      await client.query("UPDATE engineering_tasks SET status = $2, task = $3::jsonb, updated_at = $4 WHERE id = $1", [updated.id, updated.status, JSON.stringify(updated), updated.updatedAt]);
      recovered.push(updated.id);
    }
    await client.query("COMMIT");
    return recovered;
  } catch (error) {
    await rollback(client);
    throw error;
  } finally { client.release(); }
}

async function rollback(client: PoolClient) { try { await client.query("ROLLBACK"); } catch { /* preserve the original transaction error */ } }

export async function closePostgresEngineeringStore() { if (pool) await pool.end(); pool = undefined; schemaPromise = undefined; }

export async function beginPostgresWebhookDelivery(delivery: { deliveryId: string; event: string; action?: string; organizationId?: string; installationId?: number; payloadDigest: string }) {
  await ensureSchema();
  const inserted = await getPool().query("INSERT INTO github_webhook_deliveries (delivery_id, event, action, organization_id, installation_id, payload_digest, status) VALUES ($1,$2,$3,$4,$5,$6,'processing') ON CONFLICT DO NOTHING RETURNING delivery_id", [delivery.deliveryId, delivery.event, delivery.action ?? null, delivery.organizationId ?? null, delivery.installationId ?? null, delivery.payloadDigest]);
  const current = await getPool().query("SELECT delivery_id AS \"deliveryId\", payload_digest AS \"payloadDigest\", status, task_id AS \"taskId\", detail FROM github_webhook_deliveries WHERE delivery_id = $1", [delivery.deliveryId]);
  return { duplicate: inserted.rowCount === 0, delivery: current.rows[0] as { deliveryId: string; payloadDigest: string; status: string; taskId?: string; detail?: string } };
}

export async function finishPostgresWebhookDelivery(deliveryId: string, status: string, taskId?: string, detail?: string) {
  await ensureSchema();
  await getPool().query("UPDATE github_webhook_deliveries SET status=$2, task_id=$3, detail=$4, updated_at=NOW() WHERE delivery_id=$1", [deliveryId, status, taskId ?? null, detail ?? null]);
}
