import assert from "node:assert/strict";
import test from "node:test";
import { addedLines, evaluatePullRequestReview, reviewPullRequest, summarizePullRequestDiff } from "../src/lib/pull-request-reviewer";
import type { RepositoryPullRequest } from "../src/lib/github-repository-tool";

const pullRequest: RepositoryPullRequest = { number: 7, title: "unsafe change", body: "", state: "open", htmlUrl: "https://github.com/acme/web/pull/7", author: "dev", baseBranch: "main", headBranch: "feature", baseSha: "a", headSha: "b", additions: 2, deletions: 0, changedFiles: 1, files: [{ path: "src/api.ts", status: "modified", additions: 2, deletions: 0, changes: 2, blobUrl: "https://github.com/acme/web/blob/b/src/api.ts", patch: "@@ -10,0 +11,2 @@\n+const result = eval(input);\n+return result;" }] };

test("diff parser returns new-file line numbers", () => { assert.deepEqual(addedLines(pullRequest.files[0]).map((line) => line.line), [11, 12]); });
test("PR reviewer reports security and missing-test findings", () => {
  const findings = reviewPullRequest(pullRequest);
  assert.equal(findings[0].severity, "high");
  assert.equal(findings[0].line, 11);
  assert.ok(findings.some((finding) => finding.category === "testing"));
  assert.equal(evaluatePullRequestReview(pullRequest, findings).score, 100);
});
test("PR reviewer exposes reviewable diff evidence", () => { assert.deepEqual(summarizePullRequestDiff(pullRequest).map((item) => `${item.file}:${item.line}`), ["src/api.ts:11", "src/api.ts:12"]); });
test("PR reviewer ignores whitespace-only re-additions of an existing TODO", () => {
  const formatted: RepositoryPullRequest = { ...pullRequest, files: [{ ...pullRequest.files[0], additions: 1, deletions: 1, changes: 2, patch: "@@ -1 +1 @@\n-const value = 1; // TODO keep aligned\n+const value = 1;    // TODO keep aligned" }] };
  assert.deepEqual(reviewPullRequest(formatted).filter((finding) => finding.title === "变更中遗留待办"), []);
});
