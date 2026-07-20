import { inspectRepositoryWithGitHubMcp, readRepositoryFilesWithGitHubMcp } from "@/lib/mcp/github-client";
import { getEngineeringTask, updateEngineeringTask } from "@/lib/engineering-task-store";
import { evaluateCodeAnalysis } from "@/lib/code-analysis-evaluation";
import { analyzeTypeScriptCallGraph } from "@/lib/typescript-call-graph";
import { extractLocalImports, selectImportExpansion, selectInitialEvidence } from "@/lib/repository-evidence-planner";
import { traceEngineeringOperation } from "@/lib/engineering-trace";

function formatList(items: string[]) { return items.length ? items.map((item) => `- \`${item}\``).join("\n") : "- 未发现"; }

export async function runCodeUnderstandingTask(taskId: string) {
  const task = await getEngineeringTask(taskId);
  if (!task || task.status !== "running") return;
  const events = [...task.events, "Planner：已生成仓库检索计划", "GitHub MCP：发现只读仓库工具并读取元数据与递归目录树"];
  try {
    const repository = await inspectRepositoryWithGitHubMcp(task.input.repository);
    const topLevel = [...new Set(repository.files.map((file) => file.split("/")[0]))].slice(0, 18);
    const importantFiles = repository.files.filter((file) => /^(src\/(app|pages|components|lib)|app|pages|lib|server|api)\//.test(file)).slice(0, 24);
    const dependencies = Object.keys((repository.packageJson?.dependencies ?? {}) as Record<string, unknown>).slice(0, 12);
    const resolvedRepository = { ...task.input.repository, defaultBranch: repository.branch };
    const initialEvidence = await readRepositoryFilesWithGitHubMcp(resolvedRepository, selectInitialEvidence(repository.files));
    const expansionPaths = selectImportExpansion(repository.files, initialEvidence);
    const expandedEvidence = expansionPaths.length ? await readRepositoryFilesWithGitHubMcp(resolvedRepository, expansionPaths) : [];
    const evidenceFiles = [...initialEvidence, ...expandedEvidence];
    const importEdges = evidenceFiles.flatMap((file) => extractLocalImports(file.content).map((dependency) => `${file.path} → ${dependency}`)).slice(0, 20);
    const callGraph = analyzeTypeScriptCallGraph(evidenceFiles);
    const evaluation = await traceEngineeringOperation("reviewer", "code-evidence-reviewer", async () => evaluateCodeAnalysis({ evidenceFileCount: evidenceFiles.length, importEdgeCount: importEdges.length + callGraph.edges.length, treeTruncated: repository.truncated, hasTests: repository.files.some((file) => /(^|\/)(test|tests|__tests__)\//.test(file)) }));
    const risks = [
      repository.truncated ? "**中**：GitHub 返回的递归目录树被截断，报告只覆盖已获取的文件；应使用 GitHub App 继续分页读取。" : "**低**：目录树已完整获取；仍需结合关键源文件做逐符号验证。",
      !repository.files.some((file) => /(^|\/)(test|tests|__tests__)\//.test(file)) ? "**中**：未在目录树中发现常见测试目录，建议确认测试策略和 CI 覆盖。" : "**低**：发现测试目录，后续可在 PR 审查任务中读取测试证据。",
      !repository.files.some((file) => file.startsWith(".github/workflows/")) ? "**低**：未发现 GitHub Actions 工作流；部署或质量门禁可能位于外部平台。" : "**低**：发现 GitHub Actions 工作流，后续可进一步分析 CI 门禁。",
    ];
    const callChain = repository.files.some((file) => file.startsWith("src/app/"))
      ? "浏览器请求 → `src/app` Page / Route Handler → `src/components` UI 或 `src/lib` 服务 → 外部 API / 持久化层"
      : "入口文件 → 业务模块 → 服务 / 数据访问层 → 外部依赖";
    const astEdges = callGraph.edges.map((edge) => `${edge.file}:${edge.line} \`${callGraph.nodes.find((node) => node.id === edge.from)?.symbol ?? "<module>"}\` → \`${edge.targetFile ? `${edge.targetFile}:${edge.targetLine} ` : ""}${edge.to}\`（${edge.confidence}）`).slice(0, 16);
    const report = `# ${task.input.repository.owner}/${task.input.repository.name} 架构分析\n\n## 项目结构\n\n- 默认分支：\`${repository.branch}\`\n- 主语言：${repository.metadata.language ?? "未提供"}\n- 描述：${repository.metadata.description ?? "未提供"}\n- 顶层目录 / 文件：\n${formatList(topLevel)}\n\n## 核心模块\n\n${formatList(importantFiles)}\n\n${dependencies.length ? `主要依赖：${dependencies.map((name) => `\`${name}\``).join("、")}。` : "未找到 package.json 依赖信息。"}\n\n## 调用链\n\n${callChain}\n\n源码级 import 证据：\n${formatList(importEdges)}\n\nTypeScript AST 调用证据：\n${formatList(astEdges)}\n\n## 潜在风险\n\n${risks.map((risk) => `- ${risk}`).join("\n")}\n\n## 质量评估\n\n- 评分：**${evaluation.score}/100**\n- 结论：${evaluation.verdict === "reliable" ? "证据覆盖达到可用阈值" : "建议人工复核后再使用"}\n${formatList(evaluation.concerns)}\n\n## 可追溯证据\n\n- 仓库：${repository.metadata.html_url}\n- 已读取文件数：${repository.files.length}\n- 深读文件：${evidenceFiles.map((file) => `\`${file.path}\`${file.truncated ? "（已截断）" : ""}`).join("、") || "未找到入口文件"}\n- 工具权限：\`github:read\``;
    await updateEngineeringTask(taskId, { status: "completed", report, evaluation, callGraph, events: [...events, `GitHub MCP：${repository.trace.server}/${repository.trace.tool} + get_repository_files`, `Planner：沿 import 关系追加读取 ${expandedEvidence.length} 个依赖文件`, `Code Analyzer：已归纳 ${repository.files.length} 个文件、${importEdges.length} 条 import 与 ${callGraph.edges.length} 条 AST 调用证据`, `Reviewer：质量评分 ${evaluation.score}/100`, "报告已生成"], completedAt: new Date().toISOString() });
  } catch (error) {
    await updateEngineeringTask(taskId, { status: "failed", error: error instanceof Error ? error.message : "代码库分析失败。", events: [...events, "任务执行失败"] });
  }
}
