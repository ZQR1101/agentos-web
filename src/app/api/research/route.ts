import OpenAI from "openai";
import { NextResponse } from "next/server";
import { getTask, updateTask } from "@/lib/task-store";
import type { ResearchPlan, ResearchSource, ReviewResult } from "@/types/task";

export const runtime = "nodejs";
const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";

async function searchWeb(query: string): Promise<ResearchSource[]> {
  const response = await fetch("https://api.tavily.com/search", { method: "POST", headers: { Authorization: `Bearer ${process.env.TAVILY_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, search_depth: "basic", max_results: 6, include_answer: false }) });
  if (!response.ok) throw new Error("网页搜索服务未能返回结果。");
  const payload = await response.json() as { results?: ResearchSource[] };
  return (payload.results ?? []).filter((source) => source.title && source.url && source.content).slice(0, 6);
}
function parseJson<T>(content: string | null): T { if (!content) throw new Error("Agent 未返回结构化结果。"); return JSON.parse(content.replace(/^```json\s*|\s*```$/g, "")) as T; }
async function runPlanner(client: OpenAI, topic: string) {
  const response = await client.chat.completions.create({ model, response_format: { type: "json_object" }, messages: [{ role: "system", content: "你是 Planner Agent。只输出 JSON：searchQuery 字符串、subquestions 字符串数组（3项）、successCriteria 字符串数组（3项）。搜索词要适合网页检索。" }, { role: "user", content: `为这个调研任务制定计划：${topic}` }] });
  return parseJson<ResearchPlan>(response.choices[0]?.message.content);
}
async function runWriter(client: OpenAI, topic: string, plan: ResearchPlan, sources: ResearchSource[], revision = "") {
  const context = sources.map((source, index) => `[${index + 1}] ${source.title}\nURL: ${source.url}\n摘要: ${source.content}`).join("\n\n");
  const response = await client.chat.completions.create({ model, messages: [{ role: "system", content: "你是 Executor Agent。只能使用提供的来源摘要。用中文 Markdown 输出执行摘要、关键发现、风险/局限、来源；每个关键事实使用 [来源 N](URL) 引用。不得伪造事实或链接。直接从报告标题开始，禁止问候、复述要求或说明自己的 Agent 身份。" }, { role: "user", content: `主题：${topic}\n子问题：${plan.subquestions.join("；")}\n成功标准：${plan.successCriteria.join("；")}\n${revision ? `Reviewer 修订要求：${revision}\n` : ""}\n来源：\n${context}` }] });
  const report = response.choices[0]?.message.content;
  if (!report) throw new Error("Executor 未返回报告。");
  return { report, responseId: response.id };
}
async function runReviewer(client: OpenAI, topic: string, plan: ResearchPlan, report: string) {
  const response = await client.chat.completions.create({ model, response_format: { type: "json_object" }, messages: [{ role: "system", content: "你是 Reviewer Agent。检查报告覆盖目标、引用和局限。只输出 JSON：approved 布尔值、score 0-100、issues 字符串数组、revisionInstructions 字符串。score>=75 且无严重引用问题才能批准。" }, { role: "user", content: `主题：${topic}\n成功标准：${plan.successCriteria.join("；")}\n报告：\n${report}` }] });
  return parseJson<ReviewResult>(response.choices[0]?.message.content);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { taskId?: unknown } | null;
  if (typeof body?.taskId !== "string") return NextResponse.json({ error: "请提供任务 ID。" }, { status: 400 });
  const task = await getTask(body.taskId);
  if (!task) return NextResponse.json({ error: "任务不存在。" }, { status: 404 });
  if (task.status !== "waiting_approval" && task.status !== "failed") return NextResponse.json({ error: "当前任务状态不能执行。" }, { status: 409 });
  if (!process.env.DEEPSEEK_API_KEY || !process.env.TAVILY_API_KEY) return NextResponse.json({ error: "服务端尚未完整配置 DeepSeek 与 Tavily Key。" }, { status: 503 });
  const events = [...(task.events ?? []), "审批通过，Multi-Agent Loop 启动"];
  try {
    const client = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: "https://api.deepseek.com" });
    await updateTask(task.id, { status: "running", currentStep: 2, events: [...events, "Planner 开始制定结构化计划"] });
    const plan = await runPlanner(client, task.topic);
    events.push(`Planner 完成：${plan.subquestions.length} 个子问题`);
    await updateTask(task.id, { plan, currentStep: 3, events });
    const sources = await searchWeb(plan.searchQuery);
    if (!sources.length) throw new Error("没有找到可用网页来源。");
    events.push(`Executor 检索完成：${sources.length} 个来源`);
    await updateTask(task.id, { sources, currentStep: 4, events });
    let attempts = 1;
    let written = await runWriter(client, task.topic, plan, sources);
    events.push("Executor 完成第一版报告");
    let review = await runReviewer(client, task.topic, plan, written.report);
    events.push(`Reviewer 评分：${review.score}，${review.approved ? "通过" : "需要修订"}`);
    if (!review.approved) { attempts = 2; written = await runWriter(client, task.topic, plan, sources, review.revisionInstructions); events.push("Harness 触发一次修订"); review = await runReviewer(client, task.topic, plan, written.report); events.push(`Reviewer 复核评分：${review.score}，${review.approved ? "通过" : "未通过"}`); }
    if (!review.approved) throw new Error(`Reviewer 未通过：${review.issues.join("；")}`);
    const completed = await updateTask(task.id, { status: "completed", currentStep: 5, report: written.report, sources, plan, review, attempts, events, model, responseId: written.responseId });
    return NextResponse.json({ task: completed, report: written.report, sources, plan, review, attempts, events, model, responseId: written.responseId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Multi-Agent 执行失败。";
    events.push(message);
    await updateTask(task.id, { status: "failed", error: message, events });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
