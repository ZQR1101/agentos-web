import OpenAI from "openai";
import { createHarnessBudget, type HarnessActionKind } from "@/lib/harness-budget";
import { searchWithResearchMcp } from "@/lib/mcp/research-client";
import { researchReportSkill } from "@/lib/skills/research-report";
import { getTask, updateTask } from "@/lib/task-store";
import { authorizeToolCall, RESEARCH_SEARCH_TOOL_ID } from "@/lib/tool-policy";
import { analyzeEvidenceCoverage } from "@/lib/source-policy";
import { summarizeObservability } from "@/lib/model-observability";
import type { ModelInvocation, ResearchPlan, ResearchSource, ReviewResult } from "@/types/task";

type PlanOutput = { plan: ResearchPlan; invocation?: ModelInvocation };
type WriteOutput = Awaited<ReturnType<typeof researchReportSkill.write>>;

const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";

class TaskCancelledError extends Error {
  constructor() {
    super("任务已取消。");
    this.name = "TaskCancelledError";
  }
}

export interface ResearchWorkflowDependencies {
  createClient: () => OpenAI;
  plan: (client: OpenAI, modelName: string, topic: string) => Promise<PlanOutput>;
  write: (client: OpenAI, modelName: string, topic: string, plan: ResearchPlan, sources: ResearchSource[], revision?: string) => Promise<WriteOutput>;
  review: (client: OpenAI, modelName: string, topic: string, plan: ResearchPlan, report: string, sources: ResearchSource[]) => Promise<ReviewResult>;
  search: typeof searchWithResearchMcp;
}

const defaultDependencies: ResearchWorkflowDependencies = {
  createClient: () => new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: "https://api.deepseek.com", timeout: 45_000, maxRetries: 1 }),
  plan: researchReportSkill.plan,
  write: researchReportSkill.write,
  review: researchReportSkill.review,
  search: searchWithResearchMcp,
};

export async function runResearchWorkflow(taskId: string, executionId: string, dependencies: ResearchWorkflowDependencies = defaultDependencies) {
  const task = await getTask(taskId);
  if (!task || task.status !== "running" || task.executionId !== executionId) return;
  const events = [...(task.events ?? [])];
  const skill = { id: researchReportSkill.definition.id, version: researchReportSkill.definition.version };
  const budget = createHarnessBudget();
  const workflowStartedAt = new Date().toISOString();
  const modelCalls: ModelInvocation[] = [];
  const observability = (completedAt?: string) => summarizeObservability(workflowStartedAt, modelCalls, completedAt);
  const recordModelCall = (invocation: ModelInvocation | undefined) => {
    if (!invocation) return;
    modelCalls.push(invocation);
    events.push(`模型可观测：${invocation.agent} · ${invocation.latencyMs}ms · ${invocation.totalTokens ?? "Token 未返回"}${invocation.estimatedCostUsd === undefined ? " · 成本单价未配置" : ` · 估算 $${invocation.estimatedCostUsd}`}`);
  };
  const ensureActive = async () => {
    const current = await getTask(taskId);
    if (!current || current.status === "cancelled" || current.executionId !== executionId) throw new TaskCancelledError();
  };
  const authorize = async (kind: HarnessActionKind, label: string, currentStep: number) => {
    await ensureActive();
    const harnessBudget = budget.consume(kind, label);
    const { usage, limits } = harnessBudget;
    events.push(`Harness 授权：${label}（步骤 ${usage.steps}/${limits.maxSteps} · 模型 ${usage.modelCalls}/${limits.maxModelCalls} · 工具 ${usage.toolCalls}/${limits.maxToolCalls}）`);
    await updateTask(taskId, { currentStep, harnessBudget, events });
  };
  try {
    const client = dependencies.createClient();
    events.push(`Skill 已加载：${skill.id}@${skill.version}`);
    events.push("Harness 预算已启用：最大 8 步 · 模型 5 次 · 工具 3 次 · 总耗时 180 秒");
    await updateTask(taskId, { skill, harnessBudget: budget.snapshot(), observability: observability(), events });
    await authorize("model", "Planner 模型调用", 2);
    const planned = await dependencies.plan(client, model, task.topic);
    const plan = planned.plan;
    recordModelCall(planned.invocation);
    await ensureActive();
    budget.assertWithinDuration("Planner 完成");
    events.push(`Planner 完成：${plan.subquestions.length} 个子问题`);
    await updateTask(taskId, { plan, currentStep: 3, harnessBudget: budget.snapshot(), observability: observability(), events });
    const toolPolicy = authorizeToolCall(RESEARCH_SEARCH_TOOL_ID, { approved: true, requestedScope: "read" });
    events.push(`Tool Policy 通过：${toolPolicy.id} · ${toolPolicy.scope} · 用户已批准`);
    await authorize("tool", "Research MCP/search_web", 3);
    const mcpResult = await dependencies.search(plan.searchQuery);
    await ensureActive();
    budget.assertWithinDuration("Research MCP 完成");
    const sources = mcpResult.sources;
    events.push(`MCP Client 发现并调用 ${mcpResult.trace.serverName}/${mcpResult.trace.toolName}`);
    events.push(`MCP 搜索完成：共尝试 ${mcpResult.searchAttempts} 次`);
    if (!sources.length) throw new Error(`连续 ${mcpResult.searchAttempts} 次搜索均未找到可用网页来源。`);
    events.push(`Source Policy 完成：保留 ${sources.length} 个来源，安全隔离 ${mcpResult.rejectedCount} 个，去重 ${mcpResult.deduplicatedCount} 个，域名多样性未采用 ${mcpResult.diversityExcludedCount} 个，数量截断 ${mcpResult.truncatedCount} 个`);
    const sourceEvidenceCoverage = analyzeEvidenceCoverage(sources, plan.subquestions);
    events.push(`证据覆盖评估：${sourceEvidenceCoverage.score}/100 · ${sourceEvidenceCoverage.notes.slice(0, 4).join(" · ")}`);
    await updateTask(taskId, { sources, evidenceCoverage: sourceEvidenceCoverage, mcp: mcpResult.trace, currentStep: 4, harnessBudget: budget.snapshot(), observability: observability(), events });
    let attempts = 1;
    await authorize("model", "Executor 模型调用", 4);
    let written = await dependencies.write(client, model, task.topic, plan, sources);
    recordModelCall(written.invocation);
    await ensureActive();
    budget.assertWithinDuration("Executor 完成");
    events.push("Executor 完成第一版报告");
    if (written.rewrittenCitationCount || written.removedExternalLinkCount) events.push(`Citation Renderer：规范 ${written.rewrittenCitationCount} 个旧式引用，移除 ${written.removedExternalLinkCount} 个非白名单外链`);
    await updateTask(taskId, { currentStep: 5, harnessBudget: budget.snapshot(), observability: observability(), events });
    await authorize("model", "Reviewer 模型调用", 5);
    let review = await dependencies.review(client, model, task.topic, plan, written.report, sources);
    recordModelCall(review.invocation);
    await ensureActive();
    budget.assertWithinDuration("Reviewer 完成");
    events.push(`Reviewer 评分：${review.score}，${review.approved ? "通过" : "需要修订"}`);
    let evidenceCoverage = analyzeEvidenceCoverage(sources, plan.subquestions, review.citationCheck?.citationCount);
    events.push(`证据引用覆盖结算：${evidenceCoverage.score}/100 · ${evidenceCoverage.notes.at(-2)}`);
    await updateTask(taskId, { review, evidenceCoverage, attempts, harnessBudget: budget.snapshot(), observability: observability(), events });
    if (!review.approved) {
      attempts = 2;
      events.push("Harness 触发一次修订");
      await updateTask(taskId, { attempts, observability: observability(), events });
      await authorize("model", "Executor 修订调用", 4);
      written = await dependencies.write(client, model, task.topic, plan, sources, review.revisionInstructions);
      recordModelCall(written.invocation);
      await ensureActive();
      budget.assertWithinDuration("Executor 修订完成");
      events.push("Executor 完成修订版报告");
      if (written.rewrittenCitationCount || written.removedExternalLinkCount) events.push(`Citation Renderer：规范 ${written.rewrittenCitationCount} 个旧式引用，移除 ${written.removedExternalLinkCount} 个非白名单外链`);
      await updateTask(taskId, { harnessBudget: budget.snapshot(), observability: observability(), events });
      await authorize("model", "Reviewer 复核调用", 5);
      review = await dependencies.review(client, model, task.topic, plan, written.report, sources);
      recordModelCall(review.invocation);
      await ensureActive();
      budget.assertWithinDuration("Reviewer 复核完成");
      events.push(`Reviewer 复核评分：${review.score}，${review.approved ? "通过" : "未通过"}`);
      evidenceCoverage = analyzeEvidenceCoverage(sources, plan.subquestions, review.citationCheck?.citationCount);
      events.push(`证据引用覆盖复核：${evidenceCoverage.score}/100 · ${evidenceCoverage.notes.at(-2)}`);
      await updateTask(taskId, { review, evidenceCoverage, attempts, harnessBudget: budget.snapshot(), observability: observability(), events });
    }
    if (!review.approved) throw new Error(`Reviewer 未通过：${review.issues.join("；")}`);
    const harnessBudget = budget.snapshot();
    events.push(`Harness 预算结算：${harnessBudget.usage.steps}/${harnessBudget.limits.maxSteps} 步 · ${harnessBudget.usage.modelCalls}/${harnessBudget.limits.maxModelCalls} 次模型 · ${harnessBudget.usage.toolCalls}/${harnessBudget.limits.maxToolCalls} 次工具`);
    const completedAt = new Date().toISOString();
    await updateTask(taskId, { status: "completed", currentStep: 5, report: written.report, sources, plan, review, evidenceCoverage, mcp: mcpResult.trace, skill, harnessBudget, observability: observability(completedAt), attempts, events, model, responseId: written.responseId, completedAt });
  } catch (error) {
    if (error instanceof TaskCancelledError) {
      const current = await getTask(taskId);
      if (current && current.status !== "cancelled") { const cancelledAt = new Date().toISOString(); await updateTask(taskId, { status: "cancelled", cancelledAt, observability: observability(cancelledAt), events: [...(current.events ?? []), "后台 Worker 已停止后续步骤"] }); }
      return;
    }
    const message = error instanceof Error ? error.message : "Multi-Agent 执行失败。";
    events.push(message);
    const completedAt = new Date().toISOString();
    await updateTask(taskId, { status: "failed", error: message, skill, harnessBudget: budget.snapshot(), observability: observability(completedAt), events, completedAt });
  }
}
