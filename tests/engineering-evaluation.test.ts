import assert from "node:assert/strict";
import test from "node:test";
import { aggregateEngineeringEvaluation } from "../src/lib/engineering-evaluation";
import type { EngineeringAnalysisTask, SoftwareAgentUseCase } from "../src/types/software-engineering";

function task(id: string, useCase: SoftwareAgentUseCase, overrides: Partial<EngineeringAnalysisTask> = {}): EngineeringAnalysisTask {
  return { id, status: "completed", input: { repository: { provider: "github", owner: "acme", name: "web", defaultBranch: "main" }, useCase, question: id }, plan: { repository: { provider: "github", owner: "acme", name: "web", defaultBranch: "main" }, useCase, question: id, steps: [], toolScopes: ["github:read"], successCriteria: [], output: useCase === "repository_analysis" ? "architecture_report" : useCase === "bug_triage" ? "bug_analysis" : "review_report" }, evaluation: { score: 80, verdict: "reliable", evidenceFileCount: 4, importEdgeCount: 2, concerns: [] }, execution: { attempt: 1, maxAttempts: 3 }, events: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...overrides };
}

test("evaluation acceptance rate excludes completed but unreviewed tasks", () => {
  const result = aggregateEngineeringEvaluation([
    task("accepted", "repository_analysis", { humanReview: { verdict: "accepted", reviewedAt: "2026-01-03T00:00:00.000Z" } }),
    task("rejected", "repository_analysis", { humanReview: { verdict: "rejected", reviewedAt: "2026-01-02T00:00:00.000Z" } }),
    task("unreviewed", "bug_triage"),
  ]);
  assert.equal(result.summary.reviewed, 2);
  assert.equal(result.summary.acceptanceRate, 50);
  assert.equal(result.summary.reliableRate, 100);
  assert.equal(result.byUseCase.find((row) => row.useCase === "bug_triage")?.reviewed, 0);
});

test("evaluation exposes retry and evidence metrics", () => {
  const result = aggregateEngineeringEvaluation([task("retried", "pull_request_review", { execution: { attempt: 2, maxAttempts: 3 }, evaluation: { score: 60, verdict: "needs_review", evidenceFileCount: 2, importEdgeCount: 1, concerns: ["partial"] } })]);
  assert.equal(result.summary.retryRate, 100);
  assert.equal(result.summary.averageScore, 60);
  assert.equal(result.summary.averageEvidenceFiles, 2);
});
