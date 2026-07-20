"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Status = "waiting_approval" | "queued" | "running" | "completed" | "failed" | "cancelled";
type Verdict = "accepted" | "needs_changes" | "rejected";
const verdictLabels: Record<Verdict, string> = { accepted: "接受", needs_changes: "需要改进", rejected: "不可用" };

export default function EngineeringTaskControls({ taskId, status, humanReview }: { taskId: string; status: Status; humanReview?: { verdict: Verdict; note?: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState(humanReview?.note ?? "");
  const action = status === "waiting_approval" ? "approve" : status === "failed" ? "retry" : status === "queued" || status === "running" ? "cancel" : undefined;

  async function request(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/engineering/tasks/${taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "任务操作失败。");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "任务操作失败。"); }
    finally { setBusy(false); }
  }

  if (status === "completed") return <div className="mt-5 border-t border-slate-100 pt-4"><p className="text-xs font-medium text-slate-700">人工质量复核</p><p className="mt-1 text-[11px] leading-5 text-slate-400">你的结论将进入 Evaluation 看板。</p><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} className="mt-3 w-full resize-none rounded-lg border border-slate-200 p-2 text-xs text-slate-700" placeholder="可选：记录接受或退回原因" /><div className="mt-2 grid grid-cols-3 gap-1.5">{(["accepted", "needs_changes", "rejected"] as Verdict[]).map((verdict) => <button key={verdict} type="button" disabled={busy} onClick={() => request({ action: "review", verdict, note })} className={`rounded-lg border px-2 py-2 text-[11px] font-medium disabled:opacity-50 ${humanReview?.verdict === verdict ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600"}`}>{verdictLabels[verdict]}</button>)}</div>{error && <p className="mt-2 text-xs text-red-600">{error}</p>}</div>;
  if (!action) return null;
  const actionLabel = action === "approve" ? "批准只读执行" : action === "retry" ? "手动重试" : "取消任务";
  const actionStyle = action === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : action === "retry" ? "bg-indigo-600 hover:bg-indigo-700" : "bg-slate-600 hover:bg-slate-700";
  return <div className="mt-5 border-t border-slate-100 pt-4"><button type="button" onClick={() => request({ action })} disabled={busy} className={`w-full rounded-lg px-3 py-2 text-xs font-semibold text-white transition-colors disabled:bg-slate-300 ${actionStyle}`}>{busy ? "处理中…" : actionLabel}</button>{error && <p className="mt-2 text-xs text-red-600">{error}</p>}</div>;
}
