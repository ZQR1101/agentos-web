import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createHarnessBudget, type HarnessActionKind } from "@/lib/harness-budget";
import { searchWithResearchMcp } from "@/lib/mcp/research-client";
import { researchReportSkill } from "@/lib/skills/research-report";
import { getTask, transitionTask, updateTask } from "@/lib/task-store";
import { authorizeToolCall, RESEARCH_SEARCH_TOOL_ID } from "@/lib/tool-policy";
import type { ResearchTask } from "@/types/task";

export const runtime = "nodejs";
const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";

function completedPayload(task: ResearchTask, idempotent = false) {
  return {
    task,
    report: task.report,
    sources: task.sources,
    plan: task.plan,
    review: task.review,
    mcp: task.mcp,
    attempts: task.attempts,
    events: task.events,
    model: task.model,
    responseId: task.responseId,
    idempotent,
  };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { taskId?: unknown; approval?: { externalTools?: unknown } } | null;
  if (typeof body?.taskId !== "string") return NextResponse.json({ error: "请提供任务 ID。" }, { status: 400 });
  const requestedTask = await getTask(body.taskId);
  if (!requestedTask) return NextResponse.json({ error: "任务不存在。" }, { status: 404 });
  if (requestedTask.status === "completed") return NextResponse.json(completedPayload(requestedTask, true));
  if (requestedTask.status === "running") return NextResponse.json({ task: requestedTask, idempotent: true, message: "任务已经在执行中。" }, { status: 202 });
  if (requestedTask.status !== "waiting_approval" && requestedTask.status !== "failed") return NextResponse.json({ error: "当前任务状态不能执行。" }, { status: 409 });
  if (body.approval?.externalTools !== true) return NextResponse.json({ error: "需要明确批准外部工具与模型调用。" }, { status: 403 });
  if (!process.env.DEEPSEEK_API_KEY || !process.env.TAVILY_API_KEY) return NextResponse.json({ error: "服务端尚未完整配置 DeepSeek 与 Tavily Key。" }, { status: 503 });
  const executionId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const claim = await transitionTask(body.taskId, ["waiting_approval", "failed"], (current) => ({
    status: "running",
    currentStep: 2,
    executionId,
    startedAt,
    completedAt: undefined,
    error: undefined,
    events: [...(current.events ?? []), `执行权已获取：${executionId}`, "审批通过，Multi-Agent Loop 启动", "Planner 开始制定结构化计划"],
  }));
  if (claim.outcome === "not_found") return NextResponse.json({ error: "任务不存在。" }, { status: 404 });
  if (claim.outcome === "status_mismatch") {
    if (claim.task.status === "completed") return NextResponse.json(completedPayload(claim.task, true));
    if (claim.task.status === "running") return NextResponse.json({ task: claim.task, idempotent: true, message: "任务已经在执行中。" }, { status: 202 });
    return NextResponse.json({ error: "任务状态已变化，当前不能执行。", task: claim.task }, { status: 409 });
  }
  const task = claim.task;
  const events = [...(task.events ?? [])];
  const skill = { id: researchReportSkill.definition.id, version: researchReportSkill.definition.version };
  const budget = createHarnessBudget();
  const authorize = async (kind: HarnessActionKind, label: string, currentStep: number) => {
    const harnessBudget = budget.consume(kind, label);
    const { usage, limits } = harnessBudget;
    events.push(`Harness 授权：${label}（步骤 ${usage.steps}/${limits.maxSteps} · 模型 ${usage.modelCalls}/${limits.maxModelCalls} · 工具 ${usage.toolCalls}/${limits.maxToolCalls}）`);
    await updateTask(task.id, { currentStep, harnessBudget, events });
  };
  try {
    const client = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: "https://api.deepseek.com", timeout: 45_000, maxRetries: 1 });
    events.push(`Skill 已加载：${skill.id}@${skill.version}`);
    events.push("Harness 预算已启用：最大 8 步 · 模型 5 次 · 工具 3 次 · 总耗时 180 秒");
    await updateTask(task.id, { skill, harnessBudget: budget.snapshot(), events });
    await authorize("model", "Planner 模型调用", 2);
    const plan = await researchReportSkill.plan(client, model, task.topic);
    budget.assertWithinDuration("Planner 完成");
    events.push(`Planner 完成：${plan.subquestions.length} 个子问题`);
    await updateTask(task.id, { plan, currentStep: 3, harnessBudget: budget.snapshot(), events });
    const toolPolicy = authorizeToolCall(RESEARCH_SEARCH_TOOL_ID, { approved: true, requestedScope: "read" });
    events.push(`Tool Policy 通过：${toolPolicy.id} · ${toolPolicy.scope} · 用户已批准`);
    await authorize("tool", "Research MCP/search_web", 3);
    const mcpResult = await searchWithResearchMcp(plan.searchQuery);
    budget.assertWithinDuration("Research MCP 完成");
    const sources = mcpResult.sources;
    events.push(`MCP Client 发现并调用 ${mcpResult.trace.serverName}/${mcpResult.trace.toolName}`);
    events.push(`MCP 搜索完成：共尝试 ${mcpResult.searchAttempts} 次`);
    if (!sources.length) throw new Error(`连续 ${mcpResult.searchAttempts} 次搜索均未找到可用网页来源。`);
    events.push(`Source Policy 完成：保留 ${sources.length} 个来源，隔离 ${mcpResult.rejectedCount} 个`);
    await updateTask(task.id, { sources, mcp: mcpResult.trace, currentStep: 4, harnessBudget: budget.snapshot(), events });
    let attempts = 1;
    await authorize("model", "Executor 模型调用", 4);
    let written = await researchReportSkill.write(client, model, task.topic, plan, sources);
    budget.assertWithinDuration("Executor 完成");
    events.push("Executor 完成第一版报告");
    await updateTask(task.id, { currentStep: 5, harnessBudget: budget.snapshot(), events });
    await authorize("model", "Reviewer 模型调用", 5);
    let review = await researchReportSkill.review(client, model, task.topic, plan, written.report, sources);
    budget.assertWithinDuration("Reviewer 完成");
    events.push(`Reviewer 评分：${review.score}，${review.approved ? "通过" : "需要修订"}`);
    await updateTask(task.id, { review, attempts, harnessBudget: budget.snapshot(), events });
    if (!review.approved) {
      attempts = 2;
      events.push("Harness 触发一次修订");
      await updateTask(task.id, { attempts, events });
      await authorize("model", "Executor 修订调用", 4);
      written = await researchReportSkill.write(client, model, task.topic, plan, sources, review.revisionInstructions);
      budget.assertWithinDuration("Executor 修订完成");
      events.push("Executor 完成修订版报告");
      await updateTask(task.id, { harnessBudget: budget.snapshot(), events });
      await authorize("model", "Reviewer 复核调用", 5);
      review = await researchReportSkill.review(client, model, task.topic, plan, written.report, sources);
      budget.assertWithinDuration("Reviewer 复核完成");
      events.push(`Reviewer 复核评分：${review.score}，${review.approved ? "通过" : "未通过"}`);
      await updateTask(task.id, { review, attempts, harnessBudget: budget.snapshot(), events });
    }
    if (!review.approved) throw new Error(`Reviewer 未通过：${review.issues.join("；")}`);
    const harnessBudget = budget.snapshot();
    events.push(`Harness 预算结算：${harnessBudget.usage.steps}/${harnessBudget.limits.maxSteps} 步 · ${harnessBudget.usage.modelCalls}/${harnessBudget.limits.maxModelCalls} 次模型 · ${harnessBudget.usage.toolCalls}/${harnessBudget.limits.maxToolCalls} 次工具`);
    const completed = await updateTask(task.id, { status: "completed", currentStep: 5, report: written.report, sources, plan, review, mcp: mcpResult.trace, skill, harnessBudget, attempts, events, model, responseId: written.responseId, completedAt: new Date().toISOString() });
    if (!completed) throw new Error("任务在完成持久化时丢失。");
    return NextResponse.json(completedPayload(completed));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Multi-Agent 执行失败。";
    events.push(message);
    await updateTask(task.id, { status: "failed", error: message, skill, harnessBudget: budget.snapshot(), events });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
