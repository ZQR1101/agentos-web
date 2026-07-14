import assert from "node:assert/strict";
import test from "node:test";
import { RESEARCH_MCP_SERVER } from "../src/lib/mcp/research-server";
import { authorizeToolCall, RESEARCH_SEARCH_TOOL_ID, ToolPolicyDeniedError, toolRegistry } from "../src/lib/tool-policy";

test("Tool Registry contains only the real Research MCP tool", () => {
  assert.equal(RESEARCH_SEARCH_TOOL_ID, `${RESEARCH_MCP_SERVER.name}/${RESEARCH_MCP_SERVER.toolName}`);
  assert.deepEqual(toolRegistry.map((tool) => tool.id), ["agentos-research/search_web"]);
});

test("Tool Policy fails closed for unknown, unapproved and mismatched calls", () => {
  assert.throws(() => authorizeToolCall("unknown/tool", { approved: true, requestedScope: "read" }), ToolPolicyDeniedError);
  assert.throws(() => authorizeToolCall(RESEARCH_SEARCH_TOOL_ID, { approved: false, requestedScope: "read" }), /需要用户批准/);
  assert.throws(() => authorizeToolCall(RESEARCH_SEARCH_TOOL_ID, { approved: true, requestedScope: "write" }), /作用域不匹配/);
});

test("Tool Policy authorizes the approved read-only MCP call", () => {
  const tool = authorizeToolCall(RESEARCH_SEARCH_TOOL_ID, { approved: true, requestedScope: "read" });
  assert.equal(tool.enabled, true);
  assert.equal(tool.scope, "read");
});
