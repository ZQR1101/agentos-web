import assert from "node:assert/strict";
import test from "node:test";
import { getQueueMode } from "../src/lib/task-worker";
import { getTaskStoreMode } from "../src/lib/task-store";

test("Queue mode stays in-process without REDIS_URL and switches when configured", () => {
  assert.equal(getQueueMode({}), "in-memory");
  assert.equal(getQueueMode({ REDIS_URL: "redis://localhost:6379" }), "redis");
});

test("Task store uses JSON locally and PostgreSQL when DATABASE_URL is configured", () => {
  assert.equal(getTaskStoreMode({}), "json");
  assert.equal(getTaskStoreMode({ DATABASE_URL: "postgres://agentos:password@localhost:5432/agentos" }), "postgres");
});
