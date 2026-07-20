import assert from "node:assert/strict";
import test from "node:test";
import { inspectRepositoryWithGitHubMcp, readRepositoryFilesWithGitHubMcp } from "../src/lib/mcp/github-client";

test("GitHub MCP discovers and calls a read-only repository tool", async () => {
  const output = await inspectRepositoryWithGitHubMcp({ provider: "github", owner: "acme", name: "web", defaultBranch: "main" }, async () => ({ metadata: { default_branch: "main", description: "demo", language: "TypeScript", html_url: "https://github.com/acme/web", extraGitHubField: "must be stripped" } as never, branch: "main", files: ["src/app/page.tsx", "package.json"], truncated: false, packageJson: { dependencies: { next: "16" } } }));
  assert.equal(output.trace.tool, "get_repository_overview");
  assert.deepEqual(output.files, ["src/app/page.tsx", "package.json"]);
  assert.equal("extraGitHubField" in output.metadata, false);
});

test("GitHub MCP reads a bounded set of repository files", async () => {
  const { readRepositoryFilesWithGitHubMcp } = await import("../src/lib/mcp/github-client");
  const files = await readRepositoryFilesWithGitHubMcp({ provider: "github", owner: "acme", name: "web", defaultBranch: "main" }, ["src/app/page.tsx"], async (_repository, paths) => paths.map((path) => ({ path, content: "import { run } from '@/lib/run';", truncated: false })));
  assert.equal(files[0].path, "src/app/page.tsx");
});

test("repository file reader keeps partial evidence when one GitHub file fails", async () => {
  const files = await readRepositoryFilesWithGitHubMcp({ provider: "github", owner: "acme", name: "web", defaultBranch: "main" }, ["src/good.ts", "src/missing.ts"], async (_input, paths) => paths.filter((path) => path !== "src/missing.ts").map((path) => ({ path, content: "export const ok = true;", truncated: false })));
  assert.deepEqual(files.map((file) => file.path), ["src/good.ts"]);
});

test("GitHub MCP reads an issue through a dedicated read-only tool", async () => {
  const { readIssueWithGitHubMcp } = await import("../src/lib/mcp/github-client");
  const issue = await readIssueWithGitHubMcp({ provider: "github", owner: "acme", name: "web", defaultBranch: "main" }, 42, async (_repository, number) => ({ number, title: "Login fails", body: "Token validation throws", state: "open", htmlUrl: "https://github.com/acme/web/issues/42", labels: ["bug"] }));
  assert.equal(issue.number, 42);
  assert.equal(issue.trace.tool, "get_issue");
});

test("GitHub MCP reads a bounded pull request diff", async () => {
  const { readPullRequestWithGitHubMcp } = await import("../src/lib/mcp/github-client");
  const pullRequest = await readPullRequestWithGitHubMcp({ provider: "github", owner: "acme", name: "web", defaultBranch: "main" }, 9, async (_repository, number) => ({ number, title: "Review me", body: "", state: "open", htmlUrl: "https://github.com/acme/web/pull/9", author: "dev", baseBranch: "main", headBranch: "feature", baseSha: "a", headSha: "b", additions: 1, deletions: 0, changedFiles: 1, files: [{ path: "src/app.ts", status: "modified", additions: 1, deletions: 0, changes: 1, patch: "@@ -1,0 +2 @@\n+eval(input);", blobUrl: "https://github.com/acme/web/blob/b/src/app.ts" }] }));
  assert.equal(pullRequest.number, 9);
  assert.equal(pullRequest.files[0].path, "src/app.ts");
  assert.equal(pullRequest.trace.tool, "get_pull_request");
});
