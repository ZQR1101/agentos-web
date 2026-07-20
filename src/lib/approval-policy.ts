import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import type { ApprovalActor, ApprovalDecision, RepositoryRef } from "@/types/software-engineering";

const ruleSchema = z.object({
  id: z.string().min(1),
  repository: z.string().regex(/^[^/]+\/[^/]+$/),
  approverIds: z.array(z.string()).optional(),
  approverRoles: z.array(z.string()).optional(),
  allowedScopes: z.array(z.string()).min(1),
});
const policySchema = z.object({ version: z.string().min(1), rules: z.array(ruleSchema).min(1) });
export type ApprovalPolicy = z.infer<typeof policySchema>;
export type OrganizationContext = { id: string; source: "trusted_header" | "local_development" };

const defaultPolicy: ApprovalPolicy = { version: "local-v1", rules: [{ id: "local-readonly-approver", repository: "*/*", approverRoles: ["approver"], allowedScopes: ["github:read"] }] };

export function loadApprovalPolicy(value = process.env.AGENTOS_APPROVAL_POLICY_JSON): ApprovalPolicy {
  if (!value) return defaultPolicy;
  return policySchema.parse(JSON.parse(value));
}

export function resolveApprovalActor(request: Request): ApprovalActor | undefined {
  if (process.env.AGENTOS_TRUST_IDENTITY_HEADERS === "true") {
    const expected = process.env.AGENTOS_IDENTITY_HEADER_SECRET;
    const received = request.headers.get("x-agentos-identity-secret");
    if (!expected || !received || !safeEqual(expected, received)) return undefined;
    const id = request.headers.get("x-agentos-user-id")?.trim();
    if (!id) return undefined;
    return { id, displayName: request.headers.get("x-agentos-user-name")?.trim() || id, roles: splitRoles(request.headers.get("x-agentos-user-roles")), source: "trusted_header" };
  }
  if (process.env.NODE_ENV === "production") return undefined;
  const id = process.env.AGENTOS_LOCAL_APPROVER_ID?.trim() || "local-admin";
  return { id, displayName: process.env.AGENTOS_LOCAL_APPROVER_NAME?.trim() || "Local Administrator", roles: splitRoles(process.env.AGENTOS_LOCAL_APPROVER_ROLES ?? "approver"), source: "local_development" };
}

export function resolveOrganizationContext(headers: Headers): OrganizationContext | undefined {
  if (process.env.AGENTOS_TRUST_IDENTITY_HEADERS === "true") {
    const expected = process.env.AGENTOS_IDENTITY_HEADER_SECRET;
    const received = headers.get("x-agentos-identity-secret");
    const id = headers.get("x-agentos-organization-id")?.trim();
    if (!expected || !received || !safeEqual(expected, received) || !id || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) return undefined;
    return { id, source: "trusted_header" };
  }
  if (process.env.NODE_ENV === "production") return undefined;
  return { id: process.env.AGENTOS_LOCAL_ORGANIZATION_ID?.trim() || "local", source: "local_development" };
}

export function evaluateApprovalPolicy(repository: RepositoryRef, actor: ApprovalActor, requestedScopes: string[], policy = loadApprovalPolicy()): ApprovalDecision {
  const repositoryName = `${repository.owner}/${repository.name}`;
  const matching = policy.rules.filter((rule) => repositoryMatches(rule.repository, repositoryName)).sort((a, b) => specificity(b.repository) - specificity(a.repository));
  const rule = matching[0];
  let reason = "没有匹配该仓库的审批策略。";
  let approved = false;
  if (rule) {
    const identityAllowed = (!rule.approverIds?.length || rule.approverIds.includes(actor.id)) && (!rule.approverRoles?.length || rule.approverRoles.some((role) => actor.roles.includes(role)));
    const scopesAllowed = requestedScopes.every((scope) => rule.allowedScopes.includes(scope));
    approved = identityAllowed && scopesAllowed;
    reason = !identityAllowed ? "审批人不在该仓库策略允许的身份或角色中。" : !scopesAllowed ? "任务请求的工具权限超出仓库策略。" : "审批身份、仓库边界和工具权限均符合策略。";
  }
  return { decision: approved ? "approved" : "denied", actor, policyId: rule ? `${policy.version}:${rule.id}` : `${policy.version}:no-match`, repository: repositoryName, requestedScopes: [...requestedScopes], reason, decidedAt: new Date().toISOString() };
}

function repositoryMatches(pattern: string, repository: string) {
  const [patternOwner, patternName] = pattern.toLowerCase().split("/");
  const [owner, name] = repository.toLowerCase().split("/");
  return (patternOwner === "*" || patternOwner === owner) && (patternName === "*" || patternName === name);
}
function specificity(pattern: string) { return pattern.split("/").reduce((score, part) => score + (part === "*" ? 0 : 1), 0); }
function splitRoles(value: string | null) { return [...new Set((value ?? "").split(",").map((role) => role.trim()).filter(Boolean))]; }
function safeEqual(expected: string, received: string) {
  const left = Buffer.from(expected); const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}
