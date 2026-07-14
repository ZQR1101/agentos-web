import { NextResponse } from "next/server";
import { getTask, transitionTask } from "@/lib/task-store";

export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const task = await getTask((await params).id);
  return task ? NextResponse.json({ task }) : NextResponse.json({ error: "任务不存在。" }, { status: 404 });
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const body = await request.json().catch(() => null) as { action?: string } | null;
  const transition = body?.action === "pause"
    ? await transitionTask(id, ["waiting_approval"], { status: "paused" })
    : body?.action === "resume"
      ? await transitionTask(id, ["paused"], { status: "waiting_approval" })
      : body?.action === "cancel"
        ? await transitionTask(id, ["running"], (task) => ({ status: "cancelled", cancelledAt: new Date().toISOString(), events: [...(task.events ?? []), "用户请求取消任务，当前步骤结束后停止"] }))
        : body?.action === "retry"
        ? await transitionTask(id, ["failed", "cancelled"], (task) => ({
          status: "waiting_approval",
          currentStep: 1,
          error: undefined,
          executionId: undefined,
          startedAt: undefined,
          completedAt: undefined,
          cancelledAt: undefined,
          report: undefined,
          sources: undefined,
          plan: undefined,
          review: undefined,
          mcp: undefined,
          harnessBudget: undefined,
          evidenceCoverage: undefined,
          observability: undefined,
          skill: undefined,
          model: undefined,
          responseId: undefined,
          attempts: 0,
          events: [...(task.events ?? []), "失败任务已重置"],
        }))
        : null;
  if (!transition) return NextResponse.json({ error: "不支持的任务操作。" }, { status: 400 });
  if (transition.outcome === "not_found") return NextResponse.json({ error: "任务不存在。" }, { status: 404 });
  if (transition.outcome === "status_mismatch") return NextResponse.json({ error: "当前状态不支持此操作。", task: transition.task }, { status: 409 });
  return NextResponse.json({ task: transition.task });
}
