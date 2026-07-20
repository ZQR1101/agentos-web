import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import * as store from "../src/lib/engineering-task-store";
import * as runtime from "../src/lib/engineering-runtime";
import { GET as getTaskRoute } from "../src/app/api/engineering/tasks/[id]/route";

const taskFile = path.join(process.cwd(), ".data", "engineering-tasks.test.json");
process.env.AGENTOS_TEST_TASK_STORE = "1";
const input = { repository: { provider: "github" as const, owner: "acme", name: "web", defaultBranch: "main" }, useCase: "repository_analysis" as const, question: "analyze" };
const approval = () => ({ decision: "approved" as const, actor: { id: "test-approver", displayName: "Test Approver", roles: ["approver"], source: "local_development" as const }, policyId: "test:readonly", repository: "acme/web", requestedScopes: ["github:read"], reason: "test approval", decidedAt: new Date().toISOString() });

after(async () => { delete process.env.AGENTOS_TEST_TASK_STORE; await rm(taskFile, { force: true }); });

test("runtime persists queue, retries a failed attempt and reaches completion", async () => {
  const created = await store.createEngineeringTask(input, "org-a");
  const approved = await store.approveEngineeringTask(created.id, approval());
  assert.equal(approved?.status, "queued");

  const retried = await runtime.processEngineeringTask(created.id, { workerId: "worker-a", retryDelayMs: 0, runner: async (id) => {
    const task = await store.getEngineeringTask(id);
    await store.updateEngineeringTask(id, { status: "failed", error: "transient", events: [...(task?.events ?? []), "simulated failure"] });
  } });
  assert.equal(retried?.status, "queued");
  assert.equal(retried?.execution.attempt, 1);

  const completed = await runtime.processEngineeringTask(created.id, { workerId: "worker-b", retryDelayMs: 0, runner: async (id) => {
    const task = await store.getEngineeringTask(id);
    await store.updateEngineeringTask(id, { status: "completed", report: "ok", completedAt: new Date().toISOString(), events: [...(task?.events ?? []), "simulated completion"] });
  } });
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.execution.attempt, 2);
  assert.equal(completed?.execution.leaseOwner, undefined);
  assert.equal(completed?.trace?.summary.attempts, 2);
  assert.equal(completed?.trace?.spans.filter((span) => span.kind === "runtime").length, 2);
  assert.equal(completed?.trace?.spans[0].status, "error");
  assert.equal(completed?.trace?.spans[1].status, "ok");
  assert.equal(completed?.trace?.summary.tokenUsage, "not_collected");
});

test("cancelled queued work cannot be claimed or overwritten", async () => {
  const created = await store.createEngineeringTask(input, "org-a");
  await store.approveEngineeringTask(created.id, approval());
  const cancelled = await store.cancelEngineeringTask(created.id);
  assert.equal(cancelled?.status, "cancelled");
  let ran = false;
  await runtime.processEngineeringTask(created.id, { workerId: "worker-c", runner: async () => { ran = true; } });
  assert.equal(ran, false);
  assert.equal((await store.getEngineeringTask(created.id))?.status, "cancelled");
});

test("denied approval remains waiting and is appended to the audit history", async () => {
  const created = await store.createEngineeringTask(input, "org-a");
  const denied = { ...approval(), decision: "denied" as const, reason: "approver is outside repository policy" };
  await store.recordEngineeringApprovalDenial(created.id, denied);
  const stored = await store.getEngineeringTask(created.id);
  assert.equal(stored?.status, "waiting_approval");
  assert.equal(stored?.approval, undefined);
  assert.equal(stored?.approvalHistory?.at(-1)?.decision, "denied");
  assert.equal(stored?.approvalHistory?.at(-1)?.actor.id, "test-approver");
});

test("expired running lease is recovered to the durable queue", async () => {
  const created = await store.createEngineeringTask(input, "org-a");
  await store.approveEngineeringTask(created.id, approval());
  const claimTime = new Date(Date.now() + 1_000);
  const claimed = await store.claimEngineeringTask(created.id, "dead-worker", 10, claimTime);
  assert.equal(claimed?.status, "running");
  const recovered = await store.recoverExpiredEngineeringTasks(new Date(claimTime.getTime() + 1_000));
  assert.deepEqual(recovered, [created.id]);
  assert.equal((await store.getEngineeringTask(created.id))?.status, "queued");
});

test("only the lease owner can renew a running task", async () => {
  const created = await store.createEngineeringTask(input, "org-a");
  await store.approveEngineeringTask(created.id, approval());
  const start = new Date(Date.now() + 1_000);
  const claimed = await store.claimEngineeringTask(created.id, "lease-owner", 1_000, start);
  const originalExpiry = claimed?.execution.leaseExpiresAt;
  const rejected = await store.renewEngineeringTaskLease(created.id, "other-worker", 5_000, new Date(start.getTime() + 100));
  assert.equal(rejected?.execution.leaseExpiresAt, originalExpiry);
  const renewed = await store.renewEngineeringTaskLease(created.id, "lease-owner", 5_000, new Date(start.getTime() + 100));
  assert.ok(new Date(renewed?.execution.leaseExpiresAt ?? 0) > new Date(originalExpiry ?? 0));
  await store.cancelEngineeringTask(created.id);
});

test("standalone worker poll drains durable queued tasks", async () => {
  const created = await store.createEngineeringTask(input, "org-a");
  await store.approveEngineeringTask(created.id, approval());
  const results = await runtime.runEngineeringWorkerOnce({ concurrency: 10, workerId: "standalone-test", runner: async (id) => {
    const task = await store.getEngineeringTask(id);
    await store.updateEngineeringTask(id, { status: "completed", report: "worker-ok", completedAt: new Date().toISOString(), events: [...(task?.events ?? []), "standalone worker completed"] });
  } });
  assert.ok(results.length >= 1);
  assert.equal((await store.getEngineeringTask(created.id))?.status, "completed");
});

test("tenant-scoped reads cannot observe another organization's tasks while workers retain a global view", async () => {
  const orgA = await store.createEngineeringTask(input, "org-a");
  const orgB = await store.createEngineeringTask(input, "org-b");
  const orgATasks = await store.listEngineeringTasks("org-a");
  assert.ok(orgATasks.some((task) => task.id === orgA.id));
  assert.ok(orgATasks.every((task) => task.organizationId === "org-a"));
  assert.ok(!orgATasks.some((task) => task.id === orgB.id));
  assert.equal(await store.getEngineeringTask(orgB.id, "org-a"), undefined);
  assert.equal((await store.getEngineeringTask(orgB.id, "org-b"))?.organizationId, "org-b");
  const globalIds = (await store.listEngineeringTasks()).map((task) => task.id);
  assert.ok(globalIds.includes(orgA.id) && globalIds.includes(orgB.id));
});

test("task detail API returns 404 across tenant boundaries", async () => {
  const task = await store.createEngineeringTask(input, "org-private");
  const previousTrust = process.env.AGENTOS_TRUST_IDENTITY_HEADERS; const previousSecret = process.env.AGENTOS_IDENTITY_HEADER_SECRET;
  process.env.AGENTOS_TRUST_IDENTITY_HEADERS = "true"; process.env.AGENTOS_IDENTITY_HEADER_SECRET = "tenant-test-secret";
  try {
    const requestFor = (organizationId: string) => new Request(`https://agentos.test/api/engineering/tasks/${task.id}`, { headers: { "x-agentos-organization-id": organizationId, "x-agentos-identity-secret": "tenant-test-secret" } });
    const hidden = await getTaskRoute(requestFor("org-other"), { params: Promise.resolve({ id: task.id }) });
    assert.equal(hidden.status, 404);
    const visible = await getTaskRoute(requestFor("org-private"), { params: Promise.resolve({ id: task.id }) });
    assert.equal(visible.status, 200);
    assert.equal((await visible.json()).task.organizationId, "org-private");
  } finally {
    if (previousTrust === undefined) delete process.env.AGENTOS_TRUST_IDENTITY_HEADERS; else process.env.AGENTOS_TRUST_IDENTITY_HEADERS = previousTrust;
    if (previousSecret === undefined) delete process.env.AGENTOS_IDENTITY_HEADER_SECRET; else process.env.AGENTOS_IDENTITY_HEADER_SECRET = previousSecret;
  }
});
