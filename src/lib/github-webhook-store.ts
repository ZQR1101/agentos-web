import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { beginPostgresWebhookDelivery, finishPostgresWebhookDelivery, usingPostgresEngineeringStore } from "@/lib/postgres-engineering-task-store";

export type GitHubWebhookDelivery = { deliveryId: string; event: string; action?: string; organizationId?: string; installationId?: number; payloadDigest: string; status: string; taskId?: string; detail?: string; receivedAt: string; updatedAt: string };
let writeQueue: Promise<void> = Promise.resolve();
const dataFile = () => path.join(process.cwd(), ".data", process.env.AGENTOS_TEST_TASK_STORE === "1" ? `github-webhook-deliveries${process.env.AGENTOS_TEST_STORE_SUFFIX ? `.${process.env.AGENTOS_TEST_STORE_SUFFIX.replace(/[^a-zA-Z0-9_-]/g, "")}` : ""}.test.json` : "github-webhook-deliveries.json");

async function readDeliveries() { try { return JSON.parse(await readFile(dataFile(), "utf8")) as GitHubWebhookDelivery[]; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; } }
async function saveDeliveries(deliveries: GitHubWebhookDelivery[]) {
  await mkdir(path.dirname(dataFile()), { recursive: true }); const temporary = `${dataFile()}.${crypto.randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(deliveries, null, 2), "utf8"); await rename(temporary, dataFile()); } finally { await rm(temporary, { force: true }).catch(() => undefined); }
}

export async function beginGitHubWebhookDelivery(input: Omit<GitHubWebhookDelivery, "status" | "receivedAt" | "updatedAt">) {
  if (usingPostgresEngineeringStore()) return beginPostgresWebhookDelivery(input);
  let output!: { duplicate: boolean; delivery: GitHubWebhookDelivery };
  const operation = writeQueue.then(async () => {
    const deliveries = await readDeliveries(); const existing = deliveries.find((item) => item.deliveryId === input.deliveryId);
    if (existing) { output = { duplicate: true, delivery: existing }; return; }
    const now = new Date().toISOString(); const delivery: GitHubWebhookDelivery = { ...input, status: "processing", receivedAt: now, updatedAt: now };
    deliveries.push(delivery); await saveDeliveries(deliveries); output = { duplicate: false, delivery };
  });
  writeQueue = operation.then(() => undefined, () => undefined); await operation; return output;
}

export async function finishGitHubWebhookDelivery(deliveryId: string, status: string, taskId?: string, detail?: string) {
  if (usingPostgresEngineeringStore()) return finishPostgresWebhookDelivery(deliveryId, status, taskId, detail);
  const operation = writeQueue.then(async () => {
    const deliveries = await readDeliveries(); const index = deliveries.findIndex((item) => item.deliveryId === deliveryId); if (index < 0) return;
    deliveries[index] = { ...deliveries[index], status, ...(taskId ? { taskId } : {}), ...(detail ? { detail } : {}), updatedAt: new Date().toISOString() }; await saveDeliveries(deliveries);
  });
  writeQueue = operation.then(() => undefined, () => undefined); await operation;
}
