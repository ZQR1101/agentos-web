import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { appendEngineeringTrace, approveEngineeringTask, cancelEngineeringTask, createEngineeringTask, getEngineeringTask } from "../src/lib/engineering-task-store";
import { closePostgresEngineeringStore, usingPostgresEngineeringStore } from "../src/lib/postgres-engineering-task-store";
import { evaluateApprovalPolicy } from "../src/lib/approval-policy";
import { beginGitHubWebhookDelivery, finishGitHubWebhookDelivery } from "../src/lib/github-webhook-store";

type RaceResult = { workerId: string; claimed: boolean; observedStatus?: string; observedOwner?: string; attempt?: number };

function prepareWorker(taskId: string, workerId: string) {
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/postgres-worker-race-child.ts", taskId, workerId], {
    cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const ready = new Promise<void>((resolve, reject) => {
    child.once("message", (message) => (message as { type?: string }).type === "ready" ? resolve() : reject(new Error(`${workerId} 返回了无效的 ready 消息。`)));
    child.once("error", reject);
  });
  const result = new Promise<RaceResult>((resolve, reject) => {
    let stdout = ""; let stderr = "";
    child.stdout?.setEncoding("utf8"); child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) return reject(new Error(`${workerId} 退出码 ${code}：${stderr.trim() || stdout.trim()}`));
      const line = stdout.trim().split(/\r?\n/).at(-1);
      if (!line) return reject(new Error(`${workerId} 没有输出领取结果。`));
      try { resolve(JSON.parse(line) as RaceResult); } catch { reject(new Error(`${workerId} 输出不是合法 JSON：${line}`)); }
    });
  });
  return { child, ready, result };
}

function releaseWorker(child: ChildProcess) { child.send?.({ type: "start" }); }

void (async () => {
  loadEnvConfig(process.cwd());
  if (!usingPostgresEngineeringStore()) throw new Error("本测试必须配置 DATABASE_URL，不能回退到 JSON 存储。");
  const originalDatabaseUrl = process.env.DATABASE_URL as string;
  const schema = `agentos_race_${process.pid}_${Date.now()}`;
  const administrationPool = new Pool({ connectionString: originalDatabaseUrl, max: 1, application_name: "agentos-race-test-admin" });
  await administrationPool.query(`CREATE SCHEMA "${schema}"`);
  const isolatedUrl = new URL(originalDatabaseUrl);
  isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);
  process.env.DATABASE_URL = isolatedUrl.toString();

  try {
    const task = await createEngineeringTask({
      repository: { provider: "github", owner: "fastify", name: "fastify", defaultBranch: "main" },
    useCase: "repository_analysis", question: "PostgreSQL 多 Worker 原子领取验收任务",
  }, "postgres-race-org");
    const decision = evaluateApprovalPolicy(task.input.repository, { id: "postgres-test-approver", displayName: "PostgreSQL Test Approver", roles: ["approver"], source: "local_development" }, ["github:read"]);
    assert.equal(decision.decision, "approved");
    const queued = await approveEngineeringTask(task.id, { ...decision, decision: "approved" });
    assert.equal(queued?.status, "queued");
    assert.equal((await getEngineeringTask(task.id))?.approval?.actor.id, "postgres-test-approver", "审批身份必须持久化到 PostgreSQL JSONB");
    assert.equal((await getEngineeringTask(task.id, "other-org")), undefined, "PostgreSQL 查询必须隔离其他组织");
    assert.equal((await getEngineeringTask(task.id, "postgres-race-org"))?.organizationId, "postgres-race-org");

    const workers = [prepareWorker(task.id, "race-worker-a"), prepareWorker(task.id, "race-worker-b")];
    await Promise.all(workers.map((worker) => worker.ready));
    workers.forEach((worker) => releaseWorker(worker.child));
    const results = await Promise.all(workers.map((worker) => worker.result));
    const winners = results.filter((result) => result.claimed);
    assert.equal(winners.length, 1, `必须恰好一个 Worker 领取成功，实际结果：${JSON.stringify(results)}`);

    const stored = await getEngineeringTask(task.id);
    assert.equal(stored?.status, "running");
    assert.equal(stored?.execution.attempt, 1, "竞争领取不能重复增加尝试次数");
    assert.equal(stored?.execution.leaseOwner, winners[0].workerId);
    assert.equal(stored?.events.filter((event) => event.startsWith("执行器领取任务")).length, 1);
    await appendEngineeringTrace(task.id, [{ id: crypto.randomUUID(), attempt: 1, kind: "runtime", name: "postgres-race-verification", status: "ok", startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMs: 1 }]);
    assert.equal((await getEngineeringTask(task.id))?.trace?.summary.attempts, 1, "结构化 Trace 必须持久化到 PostgreSQL JSONB");
    const webhookDelivery = { deliveryId: `postgres-delivery-${process.pid}`, event: "pull_request", action: "opened", organizationId: "postgres-race-org", installationId: 123, payloadDigest: "digest-a" };
    assert.equal((await beginGitHubWebhookDelivery(webhookDelivery)).duplicate, false);
    await finishGitHubWebhookDelivery(webhookDelivery.deliveryId, "created", task.id);
    const duplicateDelivery = await beginGitHubWebhookDelivery(webhookDelivery);
    assert.equal(duplicateDelivery.duplicate, true, "PostgreSQL delivery 主键必须阻止重复触发");
    assert.equal(duplicateDelivery.delivery.status, "created");
    assert.equal(duplicateDelivery.delivery.taskId, task.id);

    console.log(JSON.stringify({
      storage: "postgres", processCount: results.length, winner: winners[0].workerId,
      attempt: stored?.execution.attempt, duplicateClaims: winners.length - 1, taskId: task.id,
    }, null, 2));
    await cancelEngineeringTask(task.id);
  } finally {
    await closePostgresEngineeringStore();
    process.env.DATABASE_URL = originalDatabaseUrl;
    await administrationPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await administrationPool.end();
  }
})().catch(async (error) => {
  console.error(error);
  await closePostgresEngineeringStore().catch(() => undefined);
  process.exitCode = 1;
});
