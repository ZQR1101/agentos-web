import { RESEARCH_MCP_SERVER } from "@/lib/mcp/research-server";

export type ToolScope = "read" | "write";
export type ToolApproval = "required" | "automatic";

export interface ToolDefinition {
  id: string;
  type: "mcp";
  description: string;
  scope: ToolScope;
  approval: ToolApproval;
  risk: "low" | "medium" | "high";
  enabled: boolean;
}

export const RESEARCH_SEARCH_TOOL_ID = `${RESEARCH_MCP_SERVER.name}/${RESEARCH_MCP_SERVER.toolName}`;

export const toolRegistry: readonly ToolDefinition[] = [{
  id: RESEARCH_SEARCH_TOOL_ID,
  type: "mcp",
  description: "通过 Research MCP 检索公开网页；返回前执行来源安全筛选。",
  scope: "read",
  approval: "required",
  risk: "medium",
  enabled: true,
}];

export class ToolPolicyDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolPolicyDeniedError";
  }
}

export function authorizeToolCall(toolId: string, context: { approved: boolean; requestedScope: ToolScope }) {
  const tool = toolRegistry.find((candidate) => candidate.id === toolId);
  if (!tool) throw new ToolPolicyDeniedError(`工具未注册，默认拒绝：${toolId}`);
  if (!tool.enabled) throw new ToolPolicyDeniedError(`工具已禁用：${toolId}`);
  if (tool.scope !== context.requestedScope) throw new ToolPolicyDeniedError(`工具作用域不匹配：${toolId} 仅允许 ${tool.scope}。`);
  if (tool.approval === "required" && !context.approved) throw new ToolPolicyDeniedError(`工具需要用户批准：${toolId}`);
  return tool;
}
