import assert from "node:assert/strict";
import test from "node:test";
import { createEngineeringTraceContext, mergeEngineeringTrace, runWithEngineeringTrace } from "../src/lib/engineering-trace";
import { inspectRepositoryWithGitHubMcp } from "../src/lib/mcp/github-client";

test("GitHub MCP records a structured tool span inside the task trace context", async () => {
  const context = createEngineeringTraceContext("trace-test", 2);
  await runWithEngineeringTrace(context, () => inspectRepositoryWithGitHubMcp(
    { provider: "github", owner: "acme", name: "web", defaultBranch: "main" },
    async () => ({ metadata: { full_name: "acme/web", default_branch: "main", html_url: "https://github.com/acme/web", description: null, language: "TypeScript", stargazers_count: 0, forks_count: 0, open_issues_count: 0 }, branch: "main", files: ["src/app.ts"], truncated: false, packageJson: {} }),
  ));
  assert.equal(context.spans.length, 1);
  assert.equal(context.spans[0].kind, "tool");
  assert.equal(context.spans[0].attempt, 2);
  assert.equal(context.spans[0].status, "ok");
  assert.equal(context.spans[0].attributes?.scope, "github:read");
  const trace = mergeEngineeringTrace(undefined, context.spans);
  assert.equal(trace.summary.toolCalls, 1);
  assert.equal(trace.summary.tokenUsage, "not_collected");
});
