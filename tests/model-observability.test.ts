import assert from "node:assert/strict";
import test from "node:test";
import { createModelInvocation, summarizeObservability } from "../src/lib/model-observability";

test("Model observability records token usage, latency and configured cost estimate", () => {
  const call = createModelInvocation("Planner", "deepseek-test", Date.now() - 12, {
    id: "response-1",
    usage: { prompt_tokens: 1500, completion_tokens: 500, total_tokens: 2000 },
  }, { DEEPSEEK_INPUT_PRICE_PER_1M_USD: "2", DEEPSEEK_OUTPUT_PRICE_PER_1M_USD: "8" });
  assert.equal(call.responseId, "response-1");
  assert.equal(call.totalTokens, 2000);
  assert.equal(call.estimatedCostUsd, 0.007);
  assert.ok(call.latencyMs >= 0);
  const summary = summarizeObservability(new Date(Date.now() - 100).toISOString(), [call], new Date().toISOString());
  assert.equal(summary.totalTokens, 2000);
  assert.equal(summary.estimatedCostUsd, 0.007);
  assert.equal(summary.modelCalls.length, 1);
});

test("Model observability does not invent a cost when usage or prices are unavailable", () => {
  const call = createModelInvocation("Reviewer", "deepseek-test", Date.now(), { id: "response-2" }, {});
  assert.equal(call.totalTokens, undefined);
  assert.equal(call.estimatedCostUsd, undefined);
  const summary = summarizeObservability(new Date().toISOString(), [call]);
  assert.equal(summary.estimatedCostUsd, undefined);
});
