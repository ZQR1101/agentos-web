import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { POST } from "../src/app/api/webhooks/github/route";
import { listEngineeringTasks } from "../src/lib/engineering-task-store";
import { verifyGitHubWebhookSignature } from "../src/lib/github-webhook";

process.env.AGENTOS_TEST_TASK_STORE = "1";
process.env.AGENTOS_TEST_STORE_SUFFIX = "webhook";
process.env.GITHUB_WEBHOOK_SECRET = "webhook-test-secret";
process.env.GITHUB_INSTALLATION_ORGANIZATION_MAP = JSON.stringify({ "123": "org-webhook" });

const taskFile = path.join(process.cwd(), ".data", "engineering-tasks.webhook.test.json");
const deliveryFile = path.join(process.cwd(), ".data", "github-webhook-deliveries.webhook.test.json");
after(async () => { delete process.env.AGENTOS_TEST_TASK_STORE; delete process.env.AGENTOS_TEST_STORE_SUFFIX; delete process.env.GITHUB_WEBHOOK_SECRET; delete process.env.GITHUB_INSTALLATION_ORGANIZATION_MAP; await Promise.all([rm(taskFile, { force: true }), rm(deliveryFile, { force: true })]); });

function webhookRequest(deliveryId: string, event: string, payload: unknown, valid = true) {
  const body = JSON.stringify(payload); const signature = `sha256=${createHmac("sha256", valid ? "webhook-test-secret" : "wrong-secret").update(body).digest("hex")}`;
  return new Request("https://agentos.test/api/webhooks/github", { method: "POST", headers: { "content-type": "application/json", "x-github-delivery": deliveryId, "x-github-event": event, "x-hub-signature-256": signature }, body });
}

const repository = { full_name: "acme/payments", html_url: "https://github.com/acme/payments", default_branch: "main" };

test("signature verifier matches GitHub's published HMAC-SHA256 test vector", () => {
  assert.equal(verifyGitHubWebhookSignature("Hello, World!", "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17", "It's a Secret to Everybody"), true);
});

test("invalid webhook signature is rejected before task creation", async () => {
  const response = await POST(webhookRequest("delivery-invalid", "pull_request", { action: "opened", installation: { id: 123 }, repository, pull_request: { number: 7, title: "Unsafe change", html_url: "https://github.com/acme/payments/pull/7" } }, false));
  assert.equal(response.status, 401); assert.equal((await listEngineeringTasks("org-webhook")).length, 0);
});

test("pull request webhook creates one waiting-approval task and deduplicates redelivery", async () => {
  const payload = { action: "opened", installation: { id: 123 }, repository, pull_request: { number: 7, title: "Unsafe change", html_url: "https://github.com/acme/payments/pull/7" } };
  const created = await POST(webhookRequest("delivery-pr-7", "pull_request", payload));
  assert.equal(created.status, 202);
  const createdBody = await created.json(); assert.equal(createdBody.task.organizationId, "org-webhook"); assert.equal(createdBody.task.status, "waiting_approval"); assert.equal(createdBody.task.trigger.deliveryId, "delivery-pr-7");
  const duplicate = await POST(webhookRequest("delivery-pr-7", "pull_request", payload));
  assert.equal(duplicate.status, 200); assert.equal((await duplicate.json()).duplicate, true);
  const conflicting = await POST(webhookRequest("delivery-pr-7", "pull_request", { ...payload, pull_request: { ...payload.pull_request, title: "Changed replay payload" } }));
  assert.equal(conflicting.status, 409);
  assert.equal((await listEngineeringTasks("org-webhook")).filter((task) => task.trigger?.deliveryId === "delivery-pr-7").length, 1);
});

test("configured issue label creates bug triage while unrelated labels are audited and ignored", async () => {
  const issue = { number: 42, title: "Login fails", body: "token expires early", html_url: "https://github.com/acme/payments/issues/42" };
  const created = await POST(webhookRequest("delivery-issue-42", "issues", { action: "labeled", installation: { id: 123 }, repository, issue, label: { name: "agentos:triage" } }));
  assert.equal(created.status, 202); assert.equal((await created.json()).task.input.useCase, "bug_triage");
  const ignored = await POST(webhookRequest("delivery-issue-ignore", "issues", { action: "labeled", installation: { id: 123 }, repository, issue, label: { name: "documentation" } }));
  assert.equal(ignored.status, 200); assert.equal((await ignored.json()).reason, "label_not_configured_for_triage");
});

test("unmapped installation cannot create a tenantless task", async () => {
  const response = await POST(webhookRequest("delivery-unmapped", "pull_request", { action: "opened", installation: { id: 999 }, repository, pull_request: { number: 8, title: "Unknown tenant", html_url: "https://github.com/acme/payments/pull/8" } }));
  assert.equal(response.status, 422);
  assert.equal((await listEngineeringTasks()).some((task) => task.trigger?.deliveryId === "delivery-unmapped"), false);
});
