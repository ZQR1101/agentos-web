import { runResearchWorkflow } from "@/lib/research-workflow";

const activeExecutions = new Map<string, string>();

export function enqueueResearchTask(taskId: string, executionId: string) {
  if (activeExecutions.has(taskId)) return false;
  activeExecutions.set(taskId, executionId);
  void Promise.resolve()
    .then(() => runResearchWorkflow(taskId, executionId))
    .finally(() => activeExecutions.delete(taskId));
  return true;
}

export function isResearchTaskActive(taskId: string) {
  return activeExecutions.has(taskId);
}
