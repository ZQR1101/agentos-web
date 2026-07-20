import assert from "node:assert/strict";
import test from "node:test";
import { evaluateApprovalPolicy, resolveApprovalActor, resolveOrganizationContext, type ApprovalPolicy } from "../src/lib/approval-policy";

const repository = { provider: "github" as const, owner: "acme", name: "payments", defaultBranch: "main" };
const policy: ApprovalPolicy = { version: "corp-v3", rules: [
  { id: "global", repository: "*/*", approverRoles: ["global-approver"], allowedScopes: ["github:read"] },
  { id: "acme", repository: "acme/*", approverRoles: ["acme-approver"], allowedScopes: ["github:read"] },
  { id: "payments", repository: "acme/payments", approverIds: ["alice"], allowedScopes: ["github:read"] },
] };

test("approval policy uses the most specific repository rule", () => {
  const approved = evaluateApprovalPolicy(repository, { id: "alice", displayName: "Alice", roles: [], source: "trusted_header" }, ["github:read"], policy);
  assert.equal(approved.decision, "approved");
  assert.equal(approved.policyId, "corp-v3:payments");
});

test("approval policy denies a role that is only allowed by a broader rule", () => {
  const denied = evaluateApprovalPolicy(repository, { id: "bob", displayName: "Bob", roles: ["global-approver", "acme-approver"], source: "trusted_header" }, ["github:read"], policy);
  assert.equal(denied.decision, "denied");
  assert.match(denied.reason, /审批人/);
});

test("approval policy denies scopes outside the repository allowance", () => {
  const denied = evaluateApprovalPolicy(repository, { id: "alice", displayName: "Alice", roles: [], source: "trusted_header" }, ["github:read", "github:write"], policy);
  assert.equal(denied.decision, "denied");
  assert.match(denied.reason, /工具权限/);
});

test("trusted identity headers require the gateway verification secret", () => {
  const previousTrust = process.env.AGENTOS_TRUST_IDENTITY_HEADERS; const previousSecret = process.env.AGENTOS_IDENTITY_HEADER_SECRET;
  process.env.AGENTOS_TRUST_IDENTITY_HEADERS = "true"; process.env.AGENTOS_IDENTITY_HEADER_SECRET = "gateway-secret";
  try {
    assert.equal(resolveApprovalActor(new Request("https://agentos.test", { headers: { "x-agentos-user-id": "alice" } })), undefined);
    const actor = resolveApprovalActor(new Request("https://agentos.test", { headers: { "x-agentos-user-id": "alice", "x-agentos-user-name": "Alice", "x-agentos-user-roles": "approver,security", "x-agentos-identity-secret": "gateway-secret" } }));
    assert.equal(actor?.id, "alice"); assert.deepEqual(actor?.roles, ["approver", "security"]); assert.equal(actor?.source, "trusted_header");
    assert.equal(resolveOrganizationContext(new Headers({ "x-agentos-organization-id": "org-a", "x-agentos-identity-secret": "wrong" })), undefined);
    assert.equal(resolveOrganizationContext(new Headers({ "x-agentos-organization-id": "org-a", "x-agentos-identity-secret": "gateway-secret" }))?.id, "org-a");
  } finally {
    if (previousTrust === undefined) delete process.env.AGENTOS_TRUST_IDENTITY_HEADERS; else process.env.AGENTOS_TRUST_IDENTITY_HEADERS = previousTrust;
    if (previousSecret === undefined) delete process.env.AGENTOS_IDENTITY_HEADER_SECRET; else process.env.AGENTOS_IDENTITY_HEADER_SECRET = previousSecret;
  }
});
