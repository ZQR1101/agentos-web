import { NextResponse } from "next/server";
import { createTask, listTasks } from "@/lib/task-store";

export const runtime = "nodejs";
export async function GET() { return NextResponse.json({ tasks: await listTasks() }); }
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { topic?: unknown } | null;
  if (typeof body?.topic !== "string" || !body.topic.trim()) return NextResponse.json({ error: "请提供调研主题。" }, { status: 400 });
  if (body.topic.length > 2000) return NextResponse.json({ error: "调研主题不能超过 2000 个字符。" }, { status: 400 });
  return NextResponse.json({ task: await createTask(body.topic.trim()) }, { status: 201 });
}
