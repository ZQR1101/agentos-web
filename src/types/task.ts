export type TaskStatus = "waiting_approval" | "paused" | "running" | "completed" | "failed";
export type SourceRiskLevel = "low" | "medium" | "high";
export type ResearchSource = { title: string; url: string; content: string; domain: string; qualityScore: number; riskLevel: SourceRiskLevel; riskReasons: string[] };
export type ResearchPlan = { searchQuery: string; subquestions: string[]; successCriteria: string[] };
export type CitationCheck = { valid: boolean; issues: string[]; citationCount: number };
export type ReviewResult = { approved: boolean; score: number; issues: string[]; revisionInstructions: string; citationCheck?: CitationCheck };

export interface ResearchTask {
  id: string;
  topic: string;
  status: TaskStatus;
  currentStep: number;
  report?: string;
  sources?: ResearchSource[];
  model?: string;
  responseId?: string;
  plan?: ResearchPlan;
  review?: ReviewResult;
  attempts?: number;
  events?: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}
