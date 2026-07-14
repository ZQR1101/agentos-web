export type ToolRisk =
  | "low"
  | "medium"
  | "high";


export type ToolType =
  | "builtin"
  | "mcp"
  | "skill";


export interface AgentTool {

  name:string;

  description:string;

  type:ToolType;

  risk:ToolRisk;

  enabled:boolean;

  requireApproval:boolean;

}