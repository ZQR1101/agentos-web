export type RepositoryRef = {
  provider: "github";
  owner: string;
  name: string;
  defaultBranch: string;
};

export type SoftwareAgentUseCase = "repository_analysis" | "bug_triage" | "pull_request_review";

export type EngineeringTaskInput = {
  repository: RepositoryRef;
  useCase: SoftwareAgentUseCase;
  question: string;
  issue?: { number: number; title: string; body?: string; url: string };
  pullRequest?: { number: number; title: string; url: string };
};

export type EngineeringStep = {
  id: "intake" | "discover" | "analyze" | "specialist_review" | "quality_review" | "report";
  agent: "Coordinator" | "Planner" | "Repository" | "Bug Analyst" | "Security" | "Code Review" | "Test" | "Reviewer";
  title: string;
  description: string;
  toolScopes: readonly ["github:read"];
};

export type EngineeringPlan = {
  repository: RepositoryRef;
  useCase: SoftwareAgentUseCase;
  question: string;
  steps: readonly EngineeringStep[];
  toolScopes: readonly ["github:read"];
  successCriteria: readonly string[];
  output: "architecture_report" | "bug_analysis" | "review_report";
};

export type EngineeringAnalysisTask = {
  id: string;
  organizationId: string;
  trigger?: { provider: "github_webhook"; deliveryId: string; event: string; action: string; installationId?: number };
  status: "waiting_approval" | "queued" | "running" | "completed" | "failed" | "cancelled";
  input: EngineeringTaskInput;
  plan: EngineeringPlan;
  report?: string;
  evaluation?: { score: number; verdict: "reliable" | "needs_review"; evidenceFileCount: number; importEdgeCount: number; concerns: string[] };
  callGraph?: { nodes: Array<{ id: string; file: string; symbol: string; line: number }>; edges: Array<{ from: string; to: string; file: string; line: number; confidence: "high" | "medium"; targetId?: string; targetFile?: string; targetLine?: number }> };
  events: string[];
  approval?: ApprovalDecision & { decision: "approved" };
  approvalHistory?: ApprovalDecision[];
  trace?: {
    spans: Array<{
      id: string;
      attempt: number;
      kind: "runtime" | "agent" | "tool" | "reviewer" | "model";
      name: string;
      status: "ok" | "error";
      startedAt: string;
      endedAt: string;
      durationMs: number;
      error?: string;
      attributes?: Record<string, string | number | boolean>;
    }>;
    summary: {
      attempts: number;
      totalDurationMs: number;
      toolDurationMs: number;
      toolCalls: number;
      agentSteps: number;
      modelCalls: number;
      failedSpans: number;
      tokenUsage: "not_collected";
    };
  };
  error?: string;
  humanReview?: {
    verdict: "accepted" | "needs_changes" | "rejected";
    note?: string;
    reviewedAt: string;
  };
  execution: {
    attempt: number;
    maxAttempts: number;
    nextAttemptAt?: string;
    leaseOwner?: string;
    leaseExpiresAt?: string;
    lastStartedAt?: string;
  };
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalActor = {
  id: string;
  displayName: string;
  roles: string[];
  source: "trusted_header" | "local_development";
};

type ApprovalDecisionDetails = {
  actor: ApprovalActor;
  policyId: string;
  repository: string;
  requestedScopes: string[];
  reason: string;
  decidedAt: string;
};

export type ApprovalDecision = ApprovalDecisionDetails & ({ decision: "approved" } | { decision: "denied" });
