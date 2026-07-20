import type { EngineeringAnalysisTask, SoftwareAgentUseCase } from "@/types/software-engineering";

const useCases: SoftwareAgentUseCase[] = ["repository_analysis", "bug_triage", "pull_request_review"];
export const useCaseLabels: Record<SoftwareAgentUseCase, string> = { repository_analysis: "代码库理解", bug_triage: "Bug 定位", pull_request_review: "PR 审查" };

function percent(value: number, total: number) { return total ? Math.round((value / total) * 100) : 0; }

export function aggregateEngineeringEvaluation(tasks: EngineeringAnalysisTask[]) {
  const completed = tasks.filter((task) => task.status === "completed");
  const scored = completed.filter((task) => task.evaluation);
  const reviewed = completed.filter((task) => task.humanReview);
  const accepted = reviewed.filter((task) => task.humanReview?.verdict === "accepted").length;
  const reliable = scored.filter((task) => task.evaluation?.verdict === "reliable").length;
  const retried = tasks.filter((task) => (task.execution?.attempt ?? 0) > 1).length;
  const evidenceFiles = scored.reduce((sum, task) => sum + (task.evaluation?.evidenceFileCount ?? 0), 0);
  const traced = tasks.filter((task) => task.trace);
  const summary = {
    total: tasks.length,
    completed: completed.length,
    failed: tasks.filter((task) => task.status === "failed").length,
    cancelled: tasks.filter((task) => task.status === "cancelled").length,
    reviewed: reviewed.length,
    accepted,
    needsChanges: reviewed.filter((task) => task.humanReview?.verdict === "needs_changes").length,
    rejected: reviewed.filter((task) => task.humanReview?.verdict === "rejected").length,
    acceptanceRate: percent(accepted, reviewed.length),
    reliableRate: percent(reliable, scored.length),
    completionRate: percent(completed.length, tasks.length),
    retryRate: percent(retried, tasks.length),
    averageScore: scored.length ? Math.round(scored.reduce((sum, task) => sum + (task.evaluation?.score ?? 0), 0) / scored.length) : 0,
    averageEvidenceFiles: scored.length ? Math.round((evidenceFiles / scored.length) * 10) / 10 : 0,
    averageRuntimeMs: traced.length ? Math.round(traced.reduce((sum, task) => sum + (task.trace?.summary.totalDurationMs ?? 0), 0) / traced.length) : 0,
    toolCalls: traced.reduce((sum, task) => sum + (task.trace?.summary.toolCalls ?? 0), 0),
    failedSpans: traced.reduce((sum, task) => sum + (task.trace?.summary.failedSpans ?? 0), 0),
  };
  const byUseCase = useCases.map((useCase) => {
    const matching = tasks.filter((task) => task.input.useCase === useCase);
    const matchingCompleted = matching.filter((task) => task.status === "completed");
    const matchingReviewed = matchingCompleted.filter((task) => task.humanReview);
    const matchingAccepted = matchingReviewed.filter((task) => task.humanReview?.verdict === "accepted").length;
    const matchingScored = matchingCompleted.filter((task) => task.evaluation);
    return { useCase, label: useCaseLabels[useCase], total: matching.length, completed: matchingCompleted.length, reviewed: matchingReviewed.length, acceptanceRate: percent(matchingAccepted, matchingReviewed.length), averageScore: matchingScored.length ? Math.round(matchingScored.reduce((sum, task) => sum + (task.evaluation?.score ?? 0), 0) / matchingScored.length) : 0 };
  });
  return { summary, byUseCase, recentReviews: reviewed.sort((a, b) => (b.humanReview?.reviewedAt ?? "").localeCompare(a.humanReview?.reviewedAt ?? "")).slice(0, 8) };
}
