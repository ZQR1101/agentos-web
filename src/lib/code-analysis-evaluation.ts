export type CodeAnalysisEvaluation = { score: number; verdict: "reliable" | "needs_review"; evidenceFileCount: number; importEdgeCount: number; concerns: string[] };

export function evaluateCodeAnalysis(input: { evidenceFileCount: number; importEdgeCount: number; treeTruncated: boolean; hasTests: boolean }): CodeAnalysisEvaluation {
  const concerns: string[] = []; let score = 100;
  if (input.evidenceFileCount < 3) { score -= 25; concerns.push("深读源码文件不足 3 个，模块结论需要人工抽查。"); }
  if (input.importEdgeCount < 2) { score -= 20; concerns.push("可提取的内部 import 边较少，调用链主要依赖框架约定推断。"); }
  if (input.treeTruncated) { score -= 25; concerns.push("GitHub 目录树被截断，报告没有覆盖全部文件。"); }
  if (!input.hasTests) { score -= 10; concerns.push("未发现常见测试目录，测试覆盖情况无法确认。"); }
  return { score: Math.max(0, score), verdict: score >= 70 ? "reliable" : "needs_review", evidenceFileCount: input.evidenceFileCount, importEdgeCount: input.importEdgeCount, concerns };
}

export function evaluateBugTriage(input: { evidenceFileCount: number; directEvidenceCount: number; rootCauseFindingCount: number; treeTruncated: boolean; hasTests: boolean }): CodeAnalysisEvaluation {
  const concerns: string[] = [];
  let score = 100;
  if (input.evidenceFileCount < 3) { score -= 20; concerns.push("候选源码不足 3 个，检索覆盖面有限。"); }
  if (input.directEvidenceCount < 2) { score -= 30; concerns.push("与 Issue 直接匹配的代码证据不足 2 条。"); }
  if (input.rootCauseFindingCount === 0) { score -= 30; concerns.push("尚未发现可由控制流或数据流证据支持的具体根因，只能给出调查方向。"); }
  if (input.treeTruncated) { score -= 15; concerns.push("GitHub 目录树被截断，可能遗漏相关文件。"); }
  if (!input.hasTests) { score -= 5; concerns.push("未发现常见测试目录，无法给出相邻回归测试位置。"); }
  return { score: Math.max(0, score), verdict: score >= 70 && input.rootCauseFindingCount > 0 ? "reliable" : "needs_review", evidenceFileCount: input.evidenceFileCount, importEdgeCount: input.directEvidenceCount, concerns };
}
