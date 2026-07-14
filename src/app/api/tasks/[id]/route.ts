import { NextResponse } from "next/server";
import { getTask, updateTask } from "@/lib/task-store";

export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const task = await getTask((await params).id);
  return task ? NextResponse.json({ task }) : NextResponse.json({ error: "任务不存在。" }, { status: 404 });
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const task = await getTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在。" }, { status: 404 });
  const body = await request.json().catch(() => null) as { action?: string } | null;
  if (body?.action === "pause" && task.status === "waiting_approval") return NextResponse.json({ task: await updateTask(id, { status: "paused" }) });
  if (body?.action === "resume" && task.status === "paused") return NextResponse.json({ task: await updateTask(id, { status: "waiting_approval" }) });
  if (body?.action === "retry" && task.status === "failed") return NextResponse.json({ task: await updateTask(id, { status: "waiting_approval", currentStep: 1, error: undefined, events: [...(task.events ?? []), "失败任务已重置"] }) });
  return NextResponse.json({ error: "当前状态不支持此操作。" }, { status: 409 });
}
