import { getEngineeringTask, updateEngineeringTask } from "@/lib/engineering-task-store";
import { readPullRequestWithGitHubMcp } from "@/lib/mcp/github-client";
import { evaluatePullRequestReview, reviewPullRequest, summarizePullRequestDiff } from "@/lib/pull-request-reviewer";
import { traceEngineeringOperation } from "@/lib/engineering-trace";

function bullets(items: string[], empty: string) { return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`; }

export async function runPullRequestReviewTask(taskId: string) {
  const task = await getEngineeringTask(taskId);
  if (!task || task.status !== "running" || task.input.useCase !== "pull_request_review" || !task.input.pullRequest) return;
  const events = [...task.events, "PR Planner：读取变更范围与 diff"];
  try {
    const pullRequest = await readPullRequestWithGitHubMcp(task.input.repository, task.input.pullRequest.number);
    const { findings, diffEvidence, evaluation } = await traceEngineeringOperation("reviewer", "pull-request-reviewer", async () => {
      const reviewedFindings = reviewPullRequest(pullRequest);
      return { findings: reviewedFindings, diffEvidence: summarizePullRequestDiff(pullRequest), evaluation: evaluatePullRequestReview(pullRequest, reviewedFindings) };
    });
    const high = findings.filter((finding) => finding.severity === "high").length;
    const medium = findings.filter((finding) => finding.severity === "medium").length;
    const findingsMarkdown = findings.map((finding) => `### [${finding.severity.toUpperCase()}] ${finding.title}\n\n- 类别：${finding.category}\n- 位置：\`${finding.file}${finding.line ? `:${finding.line}` : ""}\`\n- 证据：\`${finding.evidence.replace(/`/g, "'")}\`\n- 建议：${finding.recommendation}`).join("\n\n");
    const report = `# PR #${pullRequest.number} 只读审查报告\n\n## 变更摘要\n\n- 标题：${pullRequest.title}\n- 作者：${pullRequest.author}\n- 分支：\`${pullRequest.headBranch}\` → \`${pullRequest.baseBranch}\`\n- 规模：${pullRequest.changedFiles} 个文件，+${pullRequest.additions} / -${pullRequest.deletions}\n- 审查范围：安全、代码质量、测试影响；不提交评论、不修改代码\n\n## Reviewer 结论\n\n- 结果：${high ? `发现 ${high} 项高风险，建议阻止合并并人工确认` : medium ? `未发现高风险，存在 ${medium} 项中风险需要确认` : "未发现规则可识别的阻断问题"}\n- 质量评分：**${evaluation.score}/100**\n- 可信状态：${evaluation.verdict === "reliable" ? "审查覆盖可接受" : "diff 覆盖不足，需要人工补充审查"}\n${bullets(evaluation.concerns, "无覆盖阻断项")}\n\n## Diff 证据摘要\n\n${bullets(diffEvidence.map((item) => `\`${item.file}:${item.line}\`${item.isTest ? "（测试）" : ""} — \`${item.text.replace(/`/g, "'")}\``), "没有可展示的新增文本行")}\n\n## 审查发现\n\n${findingsMarkdown || "- 未发现规则可识别的问题。注意：这不等同于证明代码没有缺陷。"}\n\n## 变更文件\n\n${bullets(pullRequest.files.map((file) => `\`${file.path}\`（${file.status}，+${file.additions}/-${file.deletions}）`), "未返回文件")}\n\n## 可追溯来源\n\n- PR：${pullRequest.htmlUrl}\n- Head SHA：\`${pullRequest.headSha}\`\n- Base SHA：\`${pullRequest.baseSha}\`\n- 权限：\`github:read\``;
    await updateEngineeringTask(taskId, { status: "completed", report, evaluation, completedAt: new Date().toISOString(), events: [...events, `GitHub MCP：读取 PR #${pullRequest.number} 与 ${pullRequest.files.length} 个文件 diff`, `Security Agent：发现 ${findings.filter((finding) => finding.category === "security").length} 项`, `Code Review Agent：发现 ${findings.filter((finding) => finding.category === "quality").length} 项`, `Test Agent：发现 ${findings.filter((finding) => finding.category === "testing").length} 项，采集 ${diffEvidence.filter((item) => item.isTest).length} 条测试证据`, `Reviewer：去重后 ${findings.length} 项，质量评分 ${evaluation.score}/100`, "PR 审查报告已生成"] });
  } catch (error) {
    await updateEngineeringTask(taskId, { status: "failed", error: error instanceof Error ? error.message : "PR 审查失败。", events: [...events, "PR Review 执行失败"] });
  }
}
