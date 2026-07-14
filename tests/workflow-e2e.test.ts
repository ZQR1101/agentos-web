import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type OpenAI from "openai";
import { POST as approveResearch } from "../src/app/api/research/route";
import { GET as getTaskRoute } from "../src/app/api/tasks/[id]/route";
import { GET as getTaskEvents } from "../src/app/api/tasks/[id]/events/route";
import { POST as createTaskRoute } from "../src/app/api/tasks/route";
import { runResearchWorkflow, type ResearchWorkflowDependencies } from "../src/lib/research-workflow";
import { getTask } from "../src/lib/task-store";
import { setResearchWorkflowRunnerForTests } from "../src/lib/task-worker";

const source = { title: "NIST guidance", url: "https://nist.gov/ai", content: "Trustworthy AI governance guidance ".repeat(20), domain: "nist.gov", qualityScore: 95, riskLevel: "low" as const, riskReasons: [] };

const dependencies: ResearchWorkflowDependencies = {
  createClient: () => ({}) as OpenAI,
  plan: async () => ({ searchQuery: "agent governance", subquestions: ["question one", "question two", "question three"], successCriteria: ["criterion one", "criterion two", "criterion three"] }),
  search: async () => ({ sources: [source], rejectedCount: 0, deduplicatedCount: 0, diversityExcludedCount: 0, truncatedCount: 0, searchAttempts: 1, trace: { serverName: "agentos-research", serverVersion: "1.0.0", toolName: "search_web", transport: "in-memory" as const, discoveredTools: ["search_web"] } }),
  write: async () => ({ report: `[来源 1](${source.url})`, responseId: "fake-e2e-response", rewrittenCitationCount: 0, removedExternalLinkCount: 0 }),
  review: async () => ({ approved: true, score: 92, issues: [], revisionInstructions: "", citationCheck: { valid: true, issues: [], citationCount: 1 } }),
};

async function waitForCompletion(taskId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const task = await getTask(taskId);
    if (task?.status === "completed") return task;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("端到端工作流没有在预期时间内完成。");
}

test("Task API to approval, Worker, persistence and SSE completes an approved workflow", async () => {
  const originalDirectory = process.cwd();
  const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;
  const originalTavilyKey = process.env.TAVILY_API_KEY;
  const root = path.join(originalDirectory, ".data", "tests");
  await mkdir(root, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(root, "workflow-e2e-"));
  process.chdir(temporaryDirectory);
  process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
  process.env.TAVILY_API_KEY = "test-tavily-key";
  setResearchWorkflowRunnerForTests((taskId, executionId) => runResearchWorkflow(taskId, executionId, dependencies));
  try {
    const createdResponse = await createTaskRoute(new Request("http://localhost/api/tasks", { method: "POST", body: JSON.stringify({ topic: "E2E workflow" }), headers: { "Content-Type": "application/json" } }));
    assert.equal(createdResponse.status, 201);
    const createdPayload = await createdResponse.json() as { task: { id: string; status: string } };
    assert.equal(createdPayload.task.status, "waiting_approval");

    const approvalResponse = await approveResearch(new Request("http://localhost/api/research", { method: "POST", body: JSON.stringify({ taskId: createdPayload.task.id, approval: { externalTools: true } }), headers: { "Content-Type": "application/json" } }));
    assert.equal(approvalResponse.status, 202);
    assert.equal((await approvalResponse.json() as { queued: boolean }).queued, true);

    const completed = await waitForCompletion(createdPayload.task.id);
    assert.equal(completed.report, `[来源 1](${source.url})`);
    assert.equal(completed.review?.score, 92);
    assert.ok(completed.events?.some((event) => event.startsWith("Harness 预算结算")));

    const taskResponse = await getTaskRoute(new Request("http://localhost/api/tasks/id"), { params: Promise.resolve({ id: createdPayload.task.id }) });
    assert.equal(taskResponse.status, 200);
    assert.equal((await taskResponse.json() as { task: { status: string } }).task.status, "completed");

    const eventsResponse = await getTaskEvents(new Request("http://localhost/api/tasks/id/events"), { params: Promise.resolve({ id: createdPayload.task.id }) });
    assert.equal(eventsResponse.headers.get("content-type"), "text/event-stream");
    const events = await eventsResponse.text();
    assert.match(events, /event: snapshot/);
    assert.match(events, /"status":"completed"/);
  } finally {
    setResearchWorkflowRunnerForTests();
    process.chdir(originalDirectory);
    if (originalDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalDeepSeekKey;
    if (originalTavilyKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = originalTavilyKey;
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
