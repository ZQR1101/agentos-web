import assert from "node:assert/strict";
import test from "node:test";
import { getRuntimeHealth } from "../src/lib/runtime-health";

test("Runtime health reports only configuration state and never secret values", () => {
  const health = getRuntimeHealth({
    DEEPSEEK_API_KEY: "deepseek-secret",
    TAVILY_API_KEY: "tavily-secret",
    DEEPSEEK_MODEL: "deepseek-chat",
    MCP_ACCESS_TOKEN: "mcp-secret",
    MCP_ALLOWED_HOSTS: "localhost:3000,example.test",
  });
  assert.deepEqual(health, {
    ready: true,
    model: "deepseek-chat",
    deepSeekConfigured: true,
    tavilyConfigured: true,
    remoteMcpEnabled: true,
    allowedMcpHostCount: 2,
  });
  assert.equal(JSON.stringify(health).includes("secret"), false);
});

test("Runtime health reports missing required providers and defaults", () => {
  const health = getRuntimeHealth({ MCP_ALLOWED_HOSTS: "" });
  assert.equal(health.ready, false);
  assert.equal(health.deepSeekConfigured, false);
  assert.equal(health.tavilyConfigured, false);
  assert.equal(health.remoteMcpEnabled, false);
  assert.equal(health.allowedMcpHostCount, 0);
  assert.equal(health.model, "deepseek-v4-flash");
});
