import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { GET } from "../src/app/api/tasks/[id]/events/route";
import { createTask, transitionTask } from "../src/lib/task-store";

test("Task events endpoint emits an SSE snapshot and closes for a terminal task", async () => {
  const originalDirectory = process.cwd();
  const root = path.join(originalDirectory, ".data", "tests");
  await mkdir(root, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(root, "events-"));
  process.chdir(temporaryDirectory);
  try {
    const task = await createTask("event stream test");
    await transitionTask(task.id, ["waiting_approval"], { status: "cancelled", cancelledAt: new Date().toISOString() });
    const response = await GET(new Request("http://localhost/api/tasks/test/events"), { params: Promise.resolve({ id: task.id }) });
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    const body = await response.text();
    assert.match(body, /event: snapshot/);
    assert.match(body, /"status":"cancelled"/);
  } finally {
    process.chdir(originalDirectory);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
