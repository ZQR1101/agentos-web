export type RunStatus =
  | "running"
  | "completed"
  | "failed";


export interface RunStep {

  name:string;

  type:
    | "input"
    | "planner"
    | "tool"
    | "llm";

}


export interface AgentRun {

  id:string;

  status:RunStatus;

  duration:string;

  steps:RunStep[];

}