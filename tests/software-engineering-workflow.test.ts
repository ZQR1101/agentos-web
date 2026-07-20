import assert from "node:assert/strict";
import test from "node:test";
import { createEngineeringPlan } from "../src/lib/software-engineering-workflow";

test("engineering plan remains read-only and adds a bug specialist", () => {
  const plan = createEngineeringPlan({
    repository: { provider: "github", owner: "acme", name: "payments", defaultBranch: "main" },
    useCase: "bug_triage",
    question: "用户登录失败，帮我分析",
    issue: { number: 42, title: "Login failure", url: "https://github.com/acme/payments/issues/42" },
  });
  assert.equal(plan.output, "bug_analysis");
  assert.deepEqual(plan.toolScopes, ["github:read"]);
  assert.equal(plan.steps.some((step) => step.agent === "Bug Analyst"), true);
  assert.equal(plan.steps.every((step) => step.toolScopes.every((scope) => scope === "github:read")), true);
});
