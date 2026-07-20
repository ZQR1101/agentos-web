import assert from "node:assert/strict";
import test from "node:test";
import { assessBugEvidenceCoverage, extractBugEvidence, inferBugHypotheses, selectBugEvidenceFiles } from "../src/lib/bug-triage-planner";

test("bug planner ranks matching auth files and returns line evidence", () => {
  const files = ["src/lib/auth-token.ts", "src/components/Header.tsx", "src/app/login/route.ts"];
  const selected = selectBugEvidenceFiles(files, "Login token validation throws", 2);
  assert.equal(selected[0], "src/lib/auth-token.ts");
  const evidence = extractBugEvidence([{ path: selected[0], content: "const token = validateToken(input);\nreturn token;" }], "token validation throws");
  assert.equal(evidence[0].line, 1);
});

test("bug planner identifies an early branch exit that skips a later issue rule", () => {
  const findings = inferBugHypotheses([{ path: "from-json-schema.ts", content: `
if (schema.patternProperties) {
  zodSchema = buildPatternRecord();
  break;
}
if (schema.additionalProperties === false) {
  zodSchema = objectSchema.strict();
}` }], "patternProperties ignores additionalProperties false");
  assert.equal(findings.length, 1);
  assert.match(findings[0].text, /提前结束/);
  assert.equal(findings[0].skippedLine, 6);
});

test("bug planner expands a weak Chinese issue into repository concepts", () => {
  const selected = selectBugEvidenceFiles([
    "src/lib/github-webhook.ts",
    "src/components/EngineeringTaskList.tsx",
    "src/lib/postgres-engineering-task-store.ts",
    "src/app/api/engineering/tasks/route.ts",
    "src/app/chat/page.tsx",
    "tests/engineering-runtime.test.ts",
  ], "工程任务页面的任务列表加载失败，数据库暂时不可用", 4);

  assert.equal(selected.includes("src/app/api/engineering/tasks/route.ts"), true);
  assert.equal(selected.includes("src/components/EngineeringTaskList.tsx"), true);
  assert.equal(selected.includes("src/lib/postgres-engineering-task-store.ts"), true);
});

test("bug planner extracts reviewable evidence from bilingual concept aliases", () => {
  const evidence = extractBugEvidence([
    { path: "src/app/api/engineering/tasks/route.ts", content: "return NextResponse.json({ tasks: await listEngineeringTasks(organization.id) });" },
    { path: "src/lib/postgres-engineering-task-store.ts", content: "const result = await getPool().query('SELECT task FROM engineering_tasks');" },
  ], "工程任务列表加载失败，数据库暂时不可用");

  assert.equal(evidence.length, 2);
  assert.equal(evidence.some((item) => item.file.includes("route.ts") && item.matchedTerms.includes("list")), true);
  assert.equal(evidence.some((item) => item.file.includes("postgres") && item.matchedTerms.includes("query")), true);
  assert.equal(assessBugEvidenceCoverage("工程任务列表加载失败", evidence).status, "matched");
});

test("bug planner rejects generic task-store evidence when the engineering domain is absent", () => {
  const evidence = extractBugEvidence([
    { path: "src/app/api/tasks/route.ts", content: "return NextResponse.json({ tasks: await listTasks() });" },
    { path: "src/lib/postgres-task-store.ts", content: "const rows = await getPool().query('SELECT * FROM tasks');" },
  ], "工程任务列表加载失败，数据库暂时不可用");

  const coverage = assessBugEvidenceCoverage("工程任务列表加载失败，数据库暂时不可用", evidence);
  assert.equal(evidence.length >= 2, true);
  assert.equal(coverage.status, "context_mismatch");
  assert.deepEqual(coverage.requiredAnchors, ["engineering"]);
});
