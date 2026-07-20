import { NextResponse } from "next/server";
import { createEngineeringTask } from "@/lib/engineering-task-store";
import { beginGitHubWebhookDelivery, finishGitHubWebhookDelivery } from "@/lib/github-webhook-store";
import { digestWebhookPayload, githubWebhookTask, parseGitHubWebhookPayload, resolveGitHubInstallationOrganization, verifyGitHubWebhookSignature } from "@/lib/github-webhook";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "GITHUB_WEBHOOK_SECRET 未配置。" }, { status: 503 });
  const rawBody = await request.text();
  if (!verifyGitHubWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), secret)) return NextResponse.json({ error: "Webhook 签名无效。" }, { status: 401 });
  const deliveryId = request.headers.get("x-github-delivery")?.trim(); const event = request.headers.get("x-github-event")?.trim();
  if (!deliveryId || deliveryId.length > 128 || !event || event.length > 64) return NextResponse.json({ error: "缺少合法的 GitHub delivery 或 event 标识。" }, { status: 400 });

  let payload: ReturnType<typeof parseGitHubWebhookPayload>;
  try { payload = parseGitHubWebhookPayload(rawBody); } catch { return NextResponse.json({ error: "Webhook payload 不是支持的 JSON 结构。" }, { status: 400 }); }
  const installationId = payload.installation?.id; let organizationId: string | undefined;
  try { organizationId = resolveGitHubInstallationOrganization(installationId); } catch { return NextResponse.json({ error: "installation 到组织的映射配置无效。" }, { status: 500 }); }
  const payloadDigest = digestWebhookPayload(rawBody);
  const started = await beginGitHubWebhookDelivery({ deliveryId, event, action: payload.action, organizationId, installationId, payloadDigest });
  if (started.duplicate && started.delivery.payloadDigest !== payloadDigest) return NextResponse.json({ error: "相同 delivery ID 对应了不同 payload。" }, { status: 409 });
  if (started.duplicate) return NextResponse.json({ accepted: true, duplicate: true, status: started.delivery.status, taskId: started.delivery.taskId });

  try {
    const candidate = githubWebhookTask(event, payload);
    if (!candidate.input) { await finishGitHubWebhookDelivery(deliveryId, "ignored", undefined, candidate.reason); return NextResponse.json({ accepted: true, ignored: true, reason: candidate.reason }); }
    if (!organizationId) { await finishGitHubWebhookDelivery(deliveryId, "unmapped", undefined, "installation_not_mapped"); return NextResponse.json({ error: "GitHub App installation 尚未映射到 AgentOS 组织。" }, { status: 422 }); }
    const task = await createEngineeringTask(candidate.input, organizationId, { provider: "github_webhook", deliveryId, event, action: payload.action ?? "unknown", ...(installationId ? { installationId } : {}) });
    await finishGitHubWebhookDelivery(deliveryId, "created", task.id);
    return NextResponse.json({ accepted: true, duplicate: false, task }, { status: 202 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Webhook 处理失败。";
    await finishGitHubWebhookDelivery(deliveryId, "failed", undefined, detail).catch(() => undefined);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
