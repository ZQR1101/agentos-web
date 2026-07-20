import { evaluateBugTriage } from "@/lib/code-analysis-evaluation";
import { assessBugEvidenceCoverage, extractBugEvidence, extractBugTerms, inferBugHypotheses, selectBugEvidenceFiles } from "@/lib/bug-triage-planner";
import { getEngineeringTask, updateEngineeringTask } from "@/lib/engineering-task-store";
import { inspectRepositoryWithGitHubMcp, readIssueWithGitHubMcp, readRepositoryFilesWithGitHubMcp } from "@/lib/mcp/github-client";
import { analyzeTypeScriptCallGraph } from "@/lib/typescript-call-graph";
import { traceEngineeringOperation } from "@/lib/engineering-trace";

function bullet(items: string[], empty = "未找到直接证据") { return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`; }

export async function runBugTriageTask(taskId: string) {
  const task = await getEngineeringTask(taskId);
  if (!task || task.status !== "running" || task.input.useCase !== "bug_triage" || !task.input.issue) return;
  const events = [...task.events, "Bug Planner：读取 Issue 并提取故障线索"];
  try {
    const issue = await readIssueWithGitHubMcp(task.input.repository, task.input.issue.number);
    const repository = await inspectRepositoryWithGitHubMcp(task.input.repository);
    const issueText = `${issue.title}\n${issue.body}`;
    const paths = selectBugEvidenceFiles(repository.files, issueText);
    const resolvedRepository = { ...task.input.repository, defaultBranch: repository.branch };
    const files = paths.length ? await readRepositoryFilesWithGitHubMcp(resolvedRepository, paths) : [];
    const evidence = extractBugEvidence(files, issueText);
    const coverage = assessBugEvidenceCoverage(issueText, evidence);
    const graph = analyzeTypeScriptCallGraph(files);
    const rootCauseFindings = inferBugHypotheses(files, issueText);
    const evaluation = await traceEngineeringOperation("reviewer", "bug-evidence-reviewer", async () => evaluateBugTriage({ evidenceFileCount: files.length, directEvidenceCount: coverage.status === "matched" ? evidence.length : 0, rootCauseFindingCount: rootCauseFindings.length, treeTruncated: repository.truncated, hasTests: repository.files.some((file) => /(^|\/)(test|tests|__tests__)\//.test(file)) }));
    const terms = extractBugTerms(issueText);
    const hypotheses = rootCauseFindings.length
      ? rootCauseFindings.map((finding) => finding.text)
      : coverage.status === "matched" && evidence.length
      ? [`最相关代码集中在 ${[...new Set(evidence.slice(0, 8).map((item) => `\`${item.file}\``))].join("、")}，但尚未发现能解释故障的明确控制流证据。`]
      : coverage.status === "context_mismatch"
      ? ["候选文件只匹配到通用任务、接口或存储概念，没有命中 Issue 的业务域锚点；在确认正确分支或提交前，不生成代码根因假设。"]
      : ["已读取候选源码，但没有找到与 Issue 文本或业务概念匹配的行；目标实现可能尚未进入当前分支，或 Issue 缺少可检索的符号、错误码和日志。"];
    const coverageConclusion = coverage.status === "matched"
      ? `在默认分支 \`${repository.branch}\` 的 ${files.length} 个候选文件中找到 ${evidence.length} 条上下文一致的可复核代码证据。`
      : coverage.status === "context_mismatch"
      ? `找到 ${evidence.length} 条通用代码线索，但没有命中业务域锚点 ${coverage.requiredAnchors.map((term) => `\`${term}\``).join("、")}。当前分支可能只有旧任务系统或相邻模块；这些线索不能作为该 Issue 的直接证据。`
      : `默认分支 \`${repository.branch}\` 未提供可复核的匹配行。请先确认 Issue 对应的提交已推送到 GitHub，并核对目标分支或 commit SHA；在版本一致前不应推断代码根因。`;
    const report = `# Issue #${issue.number} Bug 定位报告\n\n## 问题摘要\n\n- 标题：${issue.title}\n- 状态：${issue.state}\n- 标签：${issue.labels.join("、") || "无"}\n- 线索词：${terms.map((term) => `\`${term}\``).join("、") || "无"}\n\n## 仓库版本与检索覆盖\n\n- 分析分支：\`${repository.branch}\`\n- 候选文件：${files.length} 个\n- 结论：${coverageConclusion}\n\n## 相关代码\n\n${bullet(paths.map((path) => `\`${path}\``))}\n\n## 代码证据\n\n${bullet(evidence.map((item) => `\`${item.file}:${item.line}\` — ${item.text || "<空行>"}`))}\n\n## 根因假设\n\n${bullet(hypotheses)}\n\n## 建议的验证步骤\n\n1. 确认 Issue 对应代码已推送，并记录目标分支或 commit SHA。\n2. 使用 Issue 中相同输入复现，并保留完整错误栈和请求 ID。\n3. 在最高相关代码路径的条件分支前后记录只含非敏感字段的诊断信息。\n4. 针对确认的失败分支补充最小回归测试；本 Agent 不修改代码。\n\n## Reviewer 结论\n\n- 质量评分：**${evaluation.score}/100**\n- 状态：${evaluation.verdict === "reliable" ? "证据足以支持进一步人工定位" : "证据不足，需要补充日志、复现信息或正确代码版本"}\n${bullet(evaluation.concerns, "无阻断性疑点")}\n\n## 可追溯来源\n\n- Issue：${issue.htmlUrl}\n- 仓库：${repository.metadata.html_url}\n- 分支：\`${repository.branch}\`\n- 权限：\`github:read\``;
    await updateEngineeringTask(taskId, { status: "completed", report, evaluation, callGraph: graph, completedAt: new Date().toISOString(), events: [...events, `GitHub MCP：读取 Issue #${issue.number}、目录树和 ${files.length} 个候选文件`, `版本覆盖诊断：分支 ${repository.branch}，状态 ${coverage.status}${coverage.requiredAnchors.length ? `，域锚点 ${coverage.requiredAnchors.join(",")}` : ""}`, `Bug Analyst：提取 ${evidence.length} 条候选证据与 ${rootCauseFindings.length} 个控制流根因`, `Reviewer：质量评分 ${evaluation.score}/100`, "Bug 定位报告已生成"] });
  } catch (error) {
    await updateEngineeringTask(taskId, { status: "failed", error: error instanceof Error ? error.message : "Bug 定位失败。", events: [...events, "Bug Triage 执行失败"] });
  }
}
