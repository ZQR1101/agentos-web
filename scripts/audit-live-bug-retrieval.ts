import { loadEnvConfig } from "@next/env";
import { assessBugEvidenceCoverage, extractBugEvidence, extractBugTerms, selectBugEvidenceFiles } from "../src/lib/bug-triage-planner";
import { inspectPublicRepository, readPublicRepositoryFiles, readPublicRepositoryIssue } from "../src/lib/github-repository-tool";

loadEnvConfig(process.cwd());

void (async () => {
  const [repositoryName, issueValue, requestedRef] = process.argv.slice(2);
  const [owner, name] = (repositoryName ?? "").split("/");
  const issueNumber = Number(issueValue);
  if (!owner || !name || !Number.isInteger(issueNumber) || issueNumber <= 0) throw new Error("用法：npm run audit:issue -- owner/repository issue-number [ref]");

  const repository = { provider: "github" as const, owner, name, defaultBranch: "main" };
  const [issue, inspection] = await Promise.all([readPublicRepositoryIssue(repository, issueNumber), inspectPublicRepository(repository, requestedRef)]);
  const issueText = `${issue.title}\n${issue.body}`;
  const selected = selectBugEvidenceFiles(inspection.files, issueText);
  const files = await readPublicRepositoryFiles({ ...repository, defaultBranch: inspection.branch }, selected);
  const evidence = extractBugEvidence(files, issueText);
  const coverage = assessBugEvidenceCoverage(issueText, evidence);

  console.log(JSON.stringify({
    repository: `${owner}/${name}`,
    branch: inspection.branch,
    issue: issue.number,
    terms: extractBugTerms(issueText),
    selectedFiles: selected,
    filesRead: files.length,
    evidenceCount: evidence.length,
    evidence: evidence.slice(0, 10).map((item) => ({ file: item.file, line: item.line, matchedTerms: item.matchedTerms })),
    coverage,
  }, null, 2));
})().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
