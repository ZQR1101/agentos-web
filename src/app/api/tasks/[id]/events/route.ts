import { getTask } from "@/lib/task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  let interval: ReturnType<typeof setInterval> | undefined;
  let lastUpdatedAt = "";
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const publish = async () => {
        const task = await getTask(id);
        if (!task) {
          controller.enqueue(encoder.encode("event: error\ndata: {\"error\":\"任务不存在。\"}\n\n"));
          controller.close();
          closed = true;
          if (interval) clearInterval(interval);
          return;
        }
        if (task.updatedAt !== lastUpdatedAt) {
          lastUpdatedAt = task.updatedAt;
          controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify({ task })}\n\n`));
        }
        if (["completed", "failed", "cancelled"].includes(task.status)) {
          controller.close();
          closed = true;
          if (interval) clearInterval(interval);
        }
      };
      await publish();
      if (closed) return;
      interval = setInterval(() => { void publish(); }, 750);
    },
    cancel() {
      if (interval) clearInterval(interval);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
