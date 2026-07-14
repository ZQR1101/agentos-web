import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createTask, getTask, listTasks, transitionTask, updateTask } from "../src/lib/task-store";

test("Task Store serializes writes and grants a single execution claim", async () => {
  const originalDirectory = process.cwd();
  const testRoot = path.join(originalDirectory, ".data", "tests");
  await mkdir(testRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(testRoot, "task-store-"));
  process.chdir(temporaryDirectory);
  try {
    const created = await Promise.all(Array.from({ length: 24 }, (_, index) => createTask(`concurrent task ${index}`)));
    assert.equal((await listTasks()).length, 24);

    const target = created[0];
    const claims = await Promise.all(Array.from({ length: 20 }, (_, index) => transitionTask(
      target.id,
      ["waiting_approval"],
      { status: "running", executionId: `execution-${index}` },
    )));
    assert.equal(claims.filter((claim) => claim.outcome === "updated").length, 1);
    assert.equal(claims.filter((claim) => claim.outcome === "status_mismatch").length, 19);
    assert.equal((await getTask(target.id))?.status, "running");

    await Promise.all(Array.from({ length: 20 }, (_, index) => updateTask(target.id, (current) => ({
      events: [...(current.events ?? []), `event-${index}`],
    }))));
    const finalTask = await getTask(target.id);
    assert.equal(finalTask?.events?.filter((event) => event.startsWith("event-")).length, 20);
  } finally {
    process.chdir(originalDirectory);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
