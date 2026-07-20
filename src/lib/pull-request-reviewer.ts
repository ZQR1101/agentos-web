import type { RepositoryPullRequest, RepositoryPullRequestFile } from "@/lib/github-repository-tool";

export type PullRequestFinding = {
  category: "security" | "quality" | "testing";
  severity: "high" | "medium" | "low";
  file: string;
  line?: number;
  title: string;
  evidence: string;
  recommendation: string;
};

type AddedLine = { line: number; text: string };

export function addedLines(file: RepositoryPullRequestFile): AddedLine[] {
  const output: AddedLine[] = [];
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
  const removedLines = new Set(file.patch.split(/\r?\n/).filter((line) => line.startsWith("-") && !line.startsWith("---")).map((line) => normalize(line.slice(1))));
  let newLine = 0;
  for (const raw of file.patch.split(/\r?\n/)) {
    const hunk = raw.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunk) { newLine = Number(hunk[1]); continue; }
    if (!newLine || raw.startsWith("---") || raw.startsWith("+++")) continue;
    if (raw.startsWith("+")) { if (!removedLines.has(normalize(raw.slice(1)))) output.push({ line: newLine, text: raw.slice(1) }); newLine += 1; }
    else if (!raw.startsWith("-")) newLine += 1;
  }
  return output;
}

export function summarizePullRequestDiff(pullRequest: RepositoryPullRequest, limit = 16) {
  return pullRequest.files.flatMap((file) => addedLines(file).filter((line) => line.text.trim() && !/^\s*(?:\/\/|\*|#)/.test(line.text)).map((line) => ({ file: file.path, line: line.line, text: line.text.trim().slice(0, 220), isTest: /(^|\/)(test|tests|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file.path) }))).slice(0, limit);
}

const rules: Array<{ category: "security" | "quality"; severity: "high" | "medium" | "low"; pattern: RegExp; title: string; recommendation: string }> = [
  { category: "security", severity: "high", pattern: /(?:eval|new\s+Function)\s*\(/, title: "动态代码执行", recommendation: "移除动态执行；如确有必要，使用固定映射并严格校验输入。" },
  { category: "security", severity: "high", pattern: /(?:innerHTML|dangerouslySetInnerHTML)\s*[:=]/, title: "未确认的 HTML 注入路径", recommendation: "对内容做可信来源约束和上下文转义，并增加恶意输入测试。" },
  { category: "security", severity: "high", pattern: /(?:password|secret(?:[_-]?key)?|api[_-]?key|token)\s*[:=]\s*["'][^"']{8,}["']/i, title: "疑似硬编码凭据", recommendation: "改用密钥管理或环境变量，并轮换已经暴露的值。" },
  { category: "security", severity: "high", pattern: /(?:query|execute)\s*\(\s*`[^`]*\$\{/i, title: "动态 SQL 拼接", recommendation: "改用参数化查询，并补充注入攻击回归测试。" },
  { category: "security", severity: "medium", pattern: /(?:exec|spawn)\s*\([^)]*(?:req\.|request\.|input|params)/i, title: "外部输入进入进程执行", recommendation: "使用参数数组和允许列表，禁止把外部输入交给 shell 解释。" },
  { category: "quality", severity: "medium", pattern: /catch\s*\([^)]*\)\s*\{\s*\}/, title: "异常被静默吞掉", recommendation: "记录可追踪但不含敏感信息的上下文，或显式转换并继续抛出异常。" },
  { category: "quality", severity: "low", pattern: /\b(?:TODO|FIXME)\b/, title: "变更中遗留待办", recommendation: "在合并前完成待办，或关联有负责人和期限的 Issue。" },
];

export function reviewPullRequest(pullRequest: RepositoryPullRequest) {
  const findings: PullRequestFinding[] = [];
  for (const file of pullRequest.files) {
    for (const added of addedLines(file)) {
      for (const rule of rules) if (rule.pattern.test(added.text)) findings.push({ category: rule.category, severity: rule.severity, file: file.path, line: added.line, title: rule.title, evidence: added.text.trim().slice(0, 240), recommendation: rule.recommendation });
    }
  }

  const productionFiles = pullRequest.files.filter((file) => /\.[cm]?[jt]sx?$/.test(file.path) && !/(^|\/)(test|tests|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file.path));
  const testFiles = pullRequest.files.filter((file) => /(^|\/)(test|tests|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file.path));
  if (productionFiles.length && !testFiles.length) findings.push({ category: "testing", severity: "medium", file: productionFiles[0].path, title: "生产代码变更缺少测试变更", evidence: `${productionFiles.length} 个生产代码文件发生变化，但 PR diff 中未包含测试文件。`, recommendation: "补充覆盖主要成功路径、失败路径和本次风险点的回归测试。" });

  const severityOrder = { high: 0, medium: 1, low: 2 } as const;
  const deduplicated = [...new Map(findings.map((finding) => [`${finding.category}:${finding.file}:${finding.line ?? 0}:${finding.title}`, finding])).values()];
  return deduplicated.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.file.localeCompare(b.file));
}

export function evaluatePullRequestReview(pullRequest: RepositoryPullRequest, findings: PullRequestFinding[]) {
  const patchFiles = pullRequest.files.filter((file) => file.patch.length > 0).length;
  const concerns: string[] = [];
  let score = 100;
  if (pullRequest.changedFiles > pullRequest.files.length) { score -= 25; concerns.push(`PR 共 ${pullRequest.changedFiles} 个变更文件，本次受限读取 ${pullRequest.files.length} 个。`); }
  if (patchFiles < pullRequest.files.length) { score -= 20; concerns.push(`${pullRequest.files.length - patchFiles} 个文件没有可分析的文本 patch，可能是二进制或 diff 过大。`); }
  if (!pullRequest.files.length) { score -= 50; concerns.push("PR 没有返回可审查文件。"); }
  return { score: Math.max(0, score), verdict: score >= 70 ? "reliable" as const : "needs_review" as const, evidenceFileCount: patchFiles, importEdgeCount: findings.length, concerns };
}
