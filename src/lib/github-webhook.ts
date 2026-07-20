import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { EngineeringTaskInput } from "@/types/software-engineering";

const repositorySchema = z.object({ full_name: z.string(), html_url: z.string().url(), default_branch: z.string().default("main") });
const baseSchema = z.object({ action: z.string().optional(), installation: z.object({ id: z.number().int().positive() }).optional(), repository: repositorySchema.optional() }).passthrough();
const mappingSchema = z.record(z.string(), z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/));

export function verifyGitHubWebhookSignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  const left = Buffer.from(expected); const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function digestWebhookPayload(rawBody: string) { return createHash("sha256").update(rawBody, "utf8").digest("hex"); }
export function parseGitHubWebhookPayload(rawBody: string) { return baseSchema.parse(JSON.parse(rawBody)) as z.infer<typeof baseSchema> & Record<string, unknown>; }

export function resolveGitHubInstallationOrganization(installationId: number | undefined, value = process.env.GITHUB_INSTALLATION_ORGANIZATION_MAP) {
  if (!installationId || !value) return undefined;
  return mappingSchema.parse(JSON.parse(value))[String(installationId)];
}

export function githubWebhookTask(event: string, payload: ReturnType<typeof parseGitHubWebhookPayload>, bugLabel = process.env.GITHUB_WEBHOOK_BUG_LABEL ?? "agentos:triage"): { input?: EngineeringTaskInput; reason?: string } {
  if (!payload.repository) return { reason: "payload_missing_repository" };
  const [owner, name] = payload.repository.full_name.split("/");
  if (!owner || !name) return { reason: "invalid_repository" };
  const repository = { provider: "github" as const, owner, name, defaultBranch: payload.repository.default_branch };
  if (event === "pull_request" && ["opened", "reopened", "synchronize", "ready_for_review"].includes(payload.action ?? "")) {
    const pullRequest = z.object({ number: z.number().int().positive(), title: z.string(), html_url: z.string().url() }).parse(payload.pull_request);
    return { input: { repository, useCase: "pull_request_review", question: `审查 PR #${pullRequest.number}：${pullRequest.title}`, pullRequest: { number: pullRequest.number, title: pullRequest.title, url: pullRequest.html_url } } };
  }
  if (event === "issues" && payload.action === "labeled") {
    const label = z.object({ name: z.string() }).parse(payload.label);
    if (label.name !== bugLabel) return { reason: "label_not_configured_for_triage" };
    const issue = z.object({ number: z.number().int().positive(), title: z.string(), body: z.string().nullable().optional(), html_url: z.string().url() }).parse(payload.issue);
    return { input: { repository, useCase: "bug_triage", question: `分析 Issue #${issue.number}：${issue.title}`, issue: { number: issue.number, title: issue.title, ...(issue.body ? { body: issue.body } : {}), url: issue.html_url } } };
  }
  return { reason: "event_action_not_supported" };
}
