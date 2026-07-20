import { NextResponse } from "next/server";
import { approveEngineeringTask, cancelEngineeringTask, getEngineeringTask, recordEngineeringApprovalDenial, retryFailedEngineeringTask, reviewEngineeringTask } from "@/lib/engineering-task-store";
import { kickEngineeringTask, resumeEngineeringTask } from "@/lib/engineering-runtime";
import { evaluateApprovalPolicy, resolveApprovalActor, resolveOrganizationContext } from "@/lib/approval-policy";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const organization = resolveOrganizationContext(request.headers);
  if (!organization) return NextResponse.json({ error: "未识别可信组织上下文。" }, { status: 401 });
  const visible = await getEngineeringTask(id, organization.id);
  if (!visible) return NextResponse.json({ error: "工程任务不存在。" }, { status: 404 });
  await resumeEngineeringTask(id);
  const task = await getEngineeringTask(id, organization.id);
  return task ? NextResponse.json({ task }) : NextResponse.json({ error: "工程任务不存在。" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await request.json().catch(() => null) as { action?: unknown; verdict?: unknown; note?: unknown } | null;
  if (body?.action !== "approve" && body?.action !== "cancel" && body?.action !== "retry" && body?.action !== "review") return NextResponse.json({ error: "不支持的工程任务操作。" }, { status: 400 });
  const id = (await params).id;
  const organization = resolveOrganizationContext(request.headers);
  if (!organization) return NextResponse.json({ error: "未识别可信组织上下文。" }, { status: 401 });
  const current = await getEngineeringTask(id, organization.id);
  if (!current) return NextResponse.json({ error: "工程任务不存在。" }, { status: 404 });
  if (body.action === "review") {
    if (current.status !== "completed") return NextResponse.json({ error: "只有已完成任务可以人工复核。" }, { status: 409 });
    if (body.verdict !== "accepted" && body.verdict !== "needs_changes" && body.verdict !== "rejected") return NextResponse.json({ error: "复核结论无效。" }, { status: 400 });
    if (body.note !== undefined && (typeof body.note !== "string" || body.note.trim().length > 500)) return NextResponse.json({ error: "复核备注不能超过 500 个字符。" }, { status: 400 });
    return NextResponse.json({ task: await reviewEngineeringTask(id, body.verdict, typeof body.note === "string" ? body.note.trim() : undefined) });
  }
  if (body.action === "cancel") return NextResponse.json({ task: await cancelEngineeringTask(id) });
  if (body.action === "retry") {
    const task = await retryFailedEngineeringTask(id);
    if (task?.status === "queued") kickEngineeringTask(id);
    return NextResponse.json({ task, idempotent: task?.status !== "queued" });
  }
  if (current.status !== "waiting_approval") return NextResponse.json({ task: current, idempotent: true });
  const actor = resolveApprovalActor(request);
  if (!actor) return NextResponse.json({ error: "未识别可信审批身份；生产环境必须由认证网关注入身份请求头。" }, { status: 401 });
  const decision = evaluateApprovalPolicy(current.input.repository, actor, [...current.plan.toolScopes]);
  if (decision.decision === "denied") {
    await recordEngineeringApprovalDenial(id, decision);
    return NextResponse.json({ error: decision.reason, decision }, { status: 403 });
  }
  const task = await approveEngineeringTask(id, decision);
  if (task?.status === "queued") kickEngineeringTask(id);
  return task ? NextResponse.json({ task }) : NextResponse.json({ error: "工程任务不存在。" }, { status: 404 });
}
