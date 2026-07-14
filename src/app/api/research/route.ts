import { NextResponse } from "next/server";
import { getTask, transitionTask, updateTask } from "@/lib/task-store";
import { enqueueResearchTask } from "@/lib/task-worker";
import type { ResearchTask } from "@/types/task";

export const runtime = "nodejs";

function completedPayload(task: ResearchTask, idempotent = false) {
  return { task, report: task.report, sources: task.sources, plan: task.plan, review: task.review, mcp: task.mcp, attempts: task.attempts, events: task.events, model: task.model, responseId: task.responseId, idempotent };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { taskId?: unknown; approval?: { externalTools?: unknown } } | null;
  if (typeof body?.taskId !== "string") return NextResponse.json({ error: "请提供任务 ID。" }, { status: 400 });
  const requestedTask = await getTask(body.taskId);
  if (!requestedTask) return NextResponse.json({ error: "任务不存在。" }, { status: 404 });
  if (requestedTask.status === "completed") return NextResponse.json(completedPayload(requestedTask, true));
  if (requestedTask.status === "running") return NextResponse.json({ task: requestedTask, idempotent: true, message: "任务已经在后台执行中。" }, { status: 202 });
  if (requestedTask.status !== "waiting_approval" && requestedTask.status !== "failed" && requestedTask.status !== "cancelled") return NextResponse.json({ error: "当前任务状态不能执行。" }, { status: 409 });
  if (body.approval?.externalTools !== true) return NextResponse.json({ error: "需要明确批准外部工具与模型调用。" }, { status: 403 });
  if (!process.env.DEEPSEEK_API_KEY || !process.env.TAVILY_API_KEY) return NextResponse.json({ error: "服务端尚未完整配置 DeepSeek 与 Tavily Key。" }, { status: 503 });
  const executionId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const claim = await transitionTask(body.taskId, ["waiting_approval", "failed", "cancelled"], (current) => ({
    status: "running",
    currentStep: 2,
    executionId,
    startedAt,
    completedAt: undefined,
    cancelledAt: undefined,
    error: undefined,
    events: [...(current.events ?? []), `执行权已获取：${executionId}`, "审批通过，后台 Worker 已入队", "Planner 等待执行"],
  }));
  if (claim.outcome === "not_found") return NextResponse.json({ error: "任务不存在。" }, { status: 404 });
  if (claim.outcome === "status_mismatch") {
    if (claim.task.status === "completed") return NextResponse.json(completedPayload(claim.task, true));
    if (claim.task.status === "running") return NextResponse.json({ task: claim.task, idempotent: true, message: "任务已经在后台执行中。" }, { status: 202 });
    return NextResponse.json({ error: "任务状态已变化，当前不能执行。", task: claim.task }, { status: 409 });
  }
  let queued: boolean;
  try {
    queued = await enqueueResearchTask(claim.task.id, executionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "后台队列不可用。";
    const failed = await updateTask(claim.task.id, (current) => ({
      status: "failed",
      completedAt: new Date().toISOString(),
      error: `后台队列入队失败：${message}`,
      events: [...(current.events ?? []), `后台队列入队失败：${message}`],
    }));
    return NextResponse.json({ error: "后台队列入队失败。", task: failed }, { status: 503 });
  }
  return NextResponse.json({ task: claim.task, queued, message: queued ? "任务已进入后台 Worker。" : "任务已由后台 Worker 接管。" }, { status: 202 });
}
