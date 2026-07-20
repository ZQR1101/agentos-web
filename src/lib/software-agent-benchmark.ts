import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { assessBugEvidenceCoverage, extractBugEvidence, inferBugHypotheses, selectBugEvidenceFiles } from "@/lib/bug-triage-planner";
import { reviewPullRequest } from "@/lib/pull-request-reviewer";
import { analyzeTypeScriptCallGraph } from "@/lib/typescript-call-graph";
import type { RepositoryPullRequest } from "@/lib/github-repository-tool";

const fileSchema = z.object({ path: z.string(), content: z.string().optional(), patch: z.string().optional() });
const sourceSchema = z.object({
  kind: z.enum(["github_pr", "github_issue"]), repository: z.string(), number: z.number().int().positive(), url: z.string().url(),
  baseSha: z.string().optional(), headSha: z.string().optional(), commitSha: z.string().optional(), disposition: z.enum(["merged", "closed_unmerged", "open"]).optional(), labelRationale: z.string().min(1),
});
const riskTypeSchema = z.enum(["security", "quality", "testing", "root_cause", "retrieval", "architecture", "clean_change"]);
const metadataSchema = { origin: z.enum(["synthetic", "real"]), language: z.string().min(1), riskTypes: z.array(riskTypeSchema).min(1), source: sourceSchema.optional() };
const benchmarkSchema = z.object({ version: z.string(), cases: z.array(z.discriminatedUnion("type", [
  z.object({ ...metadataSchema, id: z.string(), type: z.literal("pr_review"), files: z.array(fileSchema), expected: z.array(z.object({ category: z.enum(["security", "quality", "testing"]), severity: z.enum(["high", "medium", "low"]), title: z.string() })) }),
  z.object({ ...metadataSchema, id: z.string(), type: z.literal("bug_triage"), issueText: z.string(), files: z.array(fileSchema), expectedMinFindings: z.number().int().nonnegative(), expectedMaxFindings: z.number().int().nonnegative().optional(), expectedTerms: z.array(z.string()), expectedMinEvidence: z.number().int().nonnegative().optional(), expectedSelectedFiles: z.array(z.string()).optional(), expectedCoverage: z.enum(["matched", "context_mismatch", "no_evidence"]).optional() }),
  z.object({ ...metadataSchema, id: z.string(), type: z.literal("call_graph"), files: z.array(fileSchema), expectedEdges: z.array(z.object({ from: z.string(), to: z.string() })) }),
])) }).superRefine((dataset, context) => dataset.cases.forEach((benchmarkCase, index) => {
  if (benchmarkCase.origin === "real" && !benchmarkCase.source) context.addIssue({ code: "custom", path: ["cases", index, "source"], message: "真实样本必须包含可追溯来源" });
}));

export type SoftwareBenchmarkDataset = z.infer<typeof benchmarkSchema>;
export type SoftwareBenchmarkReport = ReturnType<typeof runSoftwareBenchmark>;

const findingKey = (finding: { category: string; severity: string; title: string }) => `${finding.category}:${finding.severity}:${finding.title}`;

export function runSoftwareBenchmark(dataset: SoftwareBenchmarkDataset) {
  let truePositive = 0; let falsePositive = 0; let falseNegative = 0;
  const results = dataset.cases.map((benchmarkCase) => {
    if (benchmarkCase.type === "pr_review") {
      const pullRequest: RepositoryPullRequest = { number: 1, title: benchmarkCase.id, body: "", state: "open", htmlUrl: "https://github.com/agentos/benchmark/pull/1", author: "benchmark", baseBranch: "main", headBranch: "case", baseSha: "base", headSha: "head", additions: benchmarkCase.files.length, deletions: 0, changedFiles: benchmarkCase.files.length, files: benchmarkCase.files.map((file) => ({ path: file.path, status: "modified", additions: 1, deletions: 0, changes: 1, patch: file.patch ?? "", blobUrl: `https://github.com/agentos/benchmark/blob/head/${file.path}` })) };
      const actual = reviewPullRequest(pullRequest).map(findingKey);
      const expected = benchmarkCase.expected.map(findingKey);
      const actualSet = new Set(actual); const expectedSet = new Set(expected);
      truePositive += expected.filter((item) => actualSet.has(item)).length;
      falsePositive += actual.filter((item) => !expectedSet.has(item)).length;
      falseNegative += expected.filter((item) => !actualSet.has(item)).length;
      return { id: benchmarkCase.id, type: benchmarkCase.type, origin: benchmarkCase.origin, language: benchmarkCase.language, riskTypes: benchmarkCase.riskTypes, source: benchmarkCase.source, passed: actual.length === expected.length && actual.every((item) => expectedSet.has(item)), expected, actual };
    }
    if (benchmarkCase.type === "bug_triage") {
      const selected = selectBugEvidenceFiles(benchmarkCase.files.map((file) => file.path), benchmarkCase.issueText);
      const selectedSet = new Set(selected);
      const selectedFiles = benchmarkCase.files.filter((file) => selectedSet.has(file.path)).map((file) => ({ path: file.path, content: file.content ?? "" }));
      const evidence = extractBugEvidence(selectedFiles, benchmarkCase.issueText);
      const coverage = assessBugEvidenceCoverage(benchmarkCase.issueText, evidence);
      const findings = inferBugHypotheses(selectedFiles, benchmarkCase.issueText);
      const joined = findings.map((finding) => finding.text).join("\n");
      const selectedFilesPresent = (benchmarkCase.expectedSelectedFiles ?? []).every((file) => selectedSet.has(file));
      const evidenceSufficient = evidence.length >= (benchmarkCase.expectedMinEvidence ?? 0);
      const coverageMatches = !benchmarkCase.expectedCoverage || coverage.status === benchmarkCase.expectedCoverage;
      const passed = findings.length >= benchmarkCase.expectedMinFindings && (benchmarkCase.expectedMaxFindings === undefined || findings.length <= benchmarkCase.expectedMaxFindings) && benchmarkCase.expectedTerms.every((term) => joined.includes(term)) && selectedFilesPresent && evidenceSufficient && coverageMatches;
      return { id: benchmarkCase.id, type: benchmarkCase.type, origin: benchmarkCase.origin, language: benchmarkCase.language, riskTypes: benchmarkCase.riskTypes, source: benchmarkCase.source, passed, expected: [`findings:${benchmarkCase.expectedMinFindings}-${benchmarkCase.expectedMaxFindings ?? "∞"}`, `evidence>=${benchmarkCase.expectedMinEvidence ?? 0}`, ...(benchmarkCase.expectedCoverage ? [`coverage:${benchmarkCase.expectedCoverage}`] : []), ...(benchmarkCase.expectedSelectedFiles ?? []).map((file) => `selected:${file}`), ...benchmarkCase.expectedTerms], actual: [`evidence:${evidence.length}`, `coverage:${coverage.status}`, ...selected.map((file) => `selected:${file}`), ...findings.map((finding) => finding.text)] };
    }
    const graph = analyzeTypeScriptCallGraph(benchmarkCase.files.map((file) => ({ path: file.path, content: file.content ?? "", truncated: false })));
    const actual = graph.edges.map((edge) => `${graph.nodes.find((node) => node.id === edge.from)?.symbol ?? edge.from}->${edge.to}`);
    const expected = benchmarkCase.expectedEdges.map((edge) => `${edge.from}->${edge.to}`);
    const passed = expected.every((edge) => actual.includes(edge));
    return { id: benchmarkCase.id, type: benchmarkCase.type, origin: benchmarkCase.origin, language: benchmarkCase.language, riskTypes: benchmarkCase.riskTypes, source: benchmarkCase.source, passed, expected, actual };
  });
  const precision = truePositive + falsePositive ? Math.round((truePositive / (truePositive + falsePositive)) * 100) : 100;
  const recall = truePositive + falseNegative ? Math.round((truePositive / (truePositive + falseNegative)) * 100) : 100;
  const passed = results.filter((result) => result.passed).length;
  const realResults = results.filter((result) => result.origin === "real");
  const realPassed = realResults.filter((result) => result.passed).length;
  const syntheticResults = results.filter((result) => result.origin === "synthetic");
  const syntheticPassed = syntheticResults.filter((result) => result.passed).length;
  const breakdown = {
    repositories: groupResults(realResults, (result) => [result.source?.repository ?? "unknown"]),
    languages: groupResults(realResults, (result) => [result.language]),
    riskTypes: groupResults(realResults, (result) => result.riskTypes),
  };
  return { version: dataset.version, generatedAt: new Date().toISOString(), summary: { total: results.length, passed, passRate: results.length ? Math.round((passed / results.length) * 100) : 0, realTotal: realResults.length, realPassed, realPassRate: realResults.length ? Math.round((realPassed / realResults.length) * 100) : 0, syntheticTotal: syntheticResults.length, syntheticPassed, syntheticPassRate: syntheticResults.length ? Math.round((syntheticPassed / syntheticResults.length) * 100) : 0, prPrecision: precision, prRecall: recall }, breakdown, results };
}

function groupResults<T extends { passed: boolean }>(results: T[], keys: (result: T) => string[]) {
  const groups = new Map<string, { total: number; passed: number }>();
  for (const result of results) for (const key of keys(result)) {
    const current = groups.get(key) ?? { total: 0, passed: 0 };
    current.total += 1; current.passed += result.passed ? 1 : 0; groups.set(key, current);
  }
  return [...groups.entries()].map(([key, value]) => ({ key, ...value, passRate: value.total ? Math.round((value.passed / value.total) * 100) : 0 })).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

export async function loadSoftwareBenchmarkDataset(filePath = path.join(process.cwd(), "evals", "software-agent-benchmark.json")) { return benchmarkSchema.parse(JSON.parse(await readFile(filePath, "utf8"))); }
export async function writeSoftwareBenchmarkReport(report: SoftwareBenchmarkReport, filePath = path.join(process.cwd(), ".data", "software-agent-benchmark-report.json")) { await mkdir(path.dirname(filePath), { recursive: true }); await writeFile(filePath, JSON.stringify(report, null, 2), "utf8"); return filePath; }
export async function readSoftwareBenchmarkReport(filePath = path.join(process.cwd(), ".data", "software-agent-benchmark-report.json")) { try { return JSON.parse(await readFile(filePath, "utf8")) as SoftwareBenchmarkReport; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
