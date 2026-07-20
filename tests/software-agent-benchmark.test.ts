import assert from "node:assert/strict";
import test from "node:test";
import { loadSoftwareBenchmarkDataset, runSoftwareBenchmark } from "../src/lib/software-agent-benchmark";

test("versioned software benchmark passes and exposes PR precision/recall", async () => {
  const report = runSoftwareBenchmark(await loadSoftwareBenchmarkDataset());
  assert.equal(report.summary.passed, report.summary.total);
  assert.equal(report.summary.prPrecision, 100);
  assert.equal(report.summary.prRecall, 100);
  assert.equal(report.summary.realTotal, 9);
  assert.equal(report.summary.realPassed, report.summary.realTotal);
  assert.equal(report.summary.syntheticTotal, 9);
  assert.equal(report.results.find((result) => result.id === "bug-chinese-weak-task-list-retrieval")?.passed, true);
  assert.equal(report.results.find((result) => result.id === "bug-engineering-domain-missing-on-branch")?.passed, true);
  assert.ok(report.results.filter((result) => result.origin === "real").every((result) => result.source?.url.startsWith("https://github.com/")));
  assert.ok(report.breakdown.repositories.length >= 4);
  assert.ok(report.breakdown.languages.some((group) => group.key === "Python"));
  assert.ok(report.breakdown.languages.some((group) => group.key === "Go"));
  assert.ok(report.breakdown.riskTypes.some((group) => group.key === "security"));
  assert.ok(report.breakdown.riskTypes.every((group) => group.passed === group.total));
});
