import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../src/app/api/mcp/research/route";

const endpoint = "http://mcp.test/api/mcp/research";
const token = "test-token-with-enough-entropy-for-contract-test";

function request(body: unknown, authorization = `Bearer ${token}`) {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: authorization,
      "Content-Type": "application/json",
      Host: "mcp.test",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify(body),
  });
}

test("Streamable HTTP MCP is fail-closed and completes initialization", async () => {
  const previousToken = process.env.MCP_ACCESS_TOKEN;
  const previousHosts = process.env.MCP_ALLOWED_HOSTS;
  process.env.MCP_ACCESS_TOKEN = token;
  process.env.MCP_ALLOWED_HOSTS = "mcp.test";
  try {
    const unauthorized = await POST(request({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, "Bearer wrong"));
    assert.equal(unauthorized.status, 401);

    const initialized = await POST(request({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "contract-test", version: "1.0.0" },
      },
    }));
    assert.equal(initialized.status, 200);
    const payload = await initialized.json() as { result?: { serverInfo?: { name?: string }; capabilities?: { tools?: unknown } } };
    assert.equal(payload.result?.serverInfo?.name, "agentos-research");
    assert.ok(payload.result?.capabilities?.tools);
  } finally {
    if (previousToken === undefined) delete process.env.MCP_ACCESS_TOKEN; else process.env.MCP_ACCESS_TOKEN = previousToken;
    if (previousHosts === undefined) delete process.env.MCP_ALLOWED_HOSTS; else process.env.MCP_ALLOWED_HOSTS = previousHosts;
  }
});
