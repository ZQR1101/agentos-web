import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type OpenAI from "openai";
import { runResearchWorkflow, type ResearchWorkflowDependencies } from "../src/lib/research-workflow";
import { createTask, getTask, transitionTask } from "../src/lib/task-store";

const source = { title: "NIST guidance", url: "https://nist.gov/ai", content: "Trustworthy AI governance guidance ".repeat(20), domain: "nist.gov", qualityScore: 95, riskLevel: "low" as const, riskReasons: [] };

function dependencies(overrides: Partial<ResearchWorkflowDependencies> = {}): ResearchWorkflowDependencies {
  return {
    createClient: () => ({}) as OpenAI,
    plan: async () => ({ searchQuery: "agent governance", subquestions: ["question one", "question two", "question three"], successCriteria: ["criterion one", "criterion two", "criterion three"] }),
    search: async () => ({ sources: [source], rejectedCount: 0, deduplicatedCount: 0, diversityExcludedCount: 0, truncatedCount: 0, searchAttempts: 1, trace: { serverName: "agentos-research", serverVersion: "1.0.0", toolName: "search_web", transport: "in-memory" as const, discoveredTools: ["search_web"] } }),
    write: async () => ({ report: `[来源 1](${source.url})`, responseId: "fake-response", rewrittenCitationCount: 0, removedExternalLinkCount: 0 }),
    review: async () => ({ approved: true, score: 90, issues: [], revisionInstructions: "", citationCheck: { valid: true, issues: [], citationCount: 1 } }),
    ...overrides,
  };
}

async function inTemporaryStore<T>(work: () => Promise<T>) {
  const originalDirectory = process.cwd();
  const root = path.join(originalDirectory, ".data", "tests");
  await mkdir(root, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(root, "workflow-"));
  process.chdir(temporaryDirectory);
  try {
    return await work();
  } finally {
    process.chdir(originalDirectory);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

test("Background workflow completes with injected model and MCP dependencies", async () => {
  await inTemporaryStore(async () => {
    const task = await createTask("test workflow");
    const executionId = "workflow-complete";
    await transitionTask(task.id, ["waiting_approval"], { status: "running", executionId, events: ["claimed"] });
    await runResearchWorkflow(task.id, executionId, dependencies());
    const completed = await getTask(task.id);
    assert.equal(completed?.status, "completed");
    assert.equal(completed?.report, `[来源 1](${source.url})`);
    assert.ok(completed?.events?.some((event) => event.startsWith("Planner 完成")));
    assert.ok(completed?.events?.some((event) => event.startsWith("Harness 预算结算")));
  });
});

test("Cancelled workflow stops after the in-flight stage and does not call search", async () => {
  await inTemporaryStore(async () => {
    const task = await createTask("cancel workflow");
    const executionId = "workflow-cancel";
    await transitionTask(task.id, ["waiting_approval"], { status: "running", executionId, events: ["claimed"] });
    let releasePlan: (() => void) | undefined;
    let searchCalls = 0;
    const run = runResearchWorkflow(task.id, executionId, dependencies({
      plan: async () => new Promise((resolve) => { releasePlan = () => resolve({ searchQuery: "agent governance", subquestions: ["question one", "question two", "question three"], successCriteria: ["criterion one", "criterion two", "criterion three"] }); }),
      search: async () => { searchCalls += 1; throw new Error("search should not run"); },
    }));
    while (!releasePlan) await new Promise((resolve) => setTimeout(resolve, 1));
    await transitionTask(task.id, ["running"], (current) => ({ status: "cancelled", events: [...(current.events ?? []), "cancelled"] }));
    releasePlan();
    await run;
    assert.equal((await getTask(task.id))?.status, "cancelled");
    assert.equal(searchCalls, 0);
  });
});
