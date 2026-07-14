import type { ResearchTask, TaskStatus } from "@/types/task";

export type TaskPatch = Partial<ResearchTask> | ((current: ResearchTask) => Partial<ResearchTask>);

export type TransitionResult =
  | { outcome: "updated"; task: ResearchTask }
  | { outcome: "not_found" }
  | { outcome: "status_mismatch"; task: ResearchTask };

export interface PersistentTaskStore {
  listTasks(): Promise<ResearchTask[]>;
  getTask(id: string): Promise<ResearchTask | undefined>;
  createTask(task: ResearchTask): Promise<ResearchTask>;
  updateTask(id: string, patch: TaskPatch): Promise<ResearchTask | undefined>;
  transitionTask(id: string, allowedStatuses: readonly TaskStatus[], patch: TaskPatch): Promise<TransitionResult>;
}
