"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Task = { id: string; status: "waiting_approval" | "queued" | "running" | "completed" | "failed" | "cancelled"; input: { repository: { owner: string; name: string }; question: string }; createdAt: string };
const labels: Record<Task["status"], string> = { waiting_approval: "等待审批", queued: "排队/重试", running: "分析中", completed: "已完成", failed: "失败", cancelled: "已取消" };
const tones: Record<Task["status"], string> = { waiting_approval: "bg-amber-50 text-amber-700", queued: "bg-cyan-50 text-cyan-700", running: "bg-indigo-50 text-indigo-700", completed: "bg-emerald-50 text-emerald-700", failed: "bg-red-50 text-red-700", cancelled: "bg-slate-100 text-slate-500" };

export default function EngineeringTaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/engineering/tasks", { cache: "no-store" }).then(async (response) => { const payload = await response.json() as { tasks?: Task[]; error?: string }; if (!response.ok) throw new Error(payload.error ?? "任务读取失败。"); setTasks(payload.tasks ?? []); }).catch((caught) => setError(caught instanceof Error ? caught.message : "任务读取失败。")); }, []);
  return <section className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm"><header className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><div><p className="text-xs font-medium text-indigo-600">RECENT ANALYSIS TASKS</p><h2 className="mt-1 font-semibold">最近任务</h2></div><span className="text-xs text-slate-400">{tasks.length} 个</span></header>{error ? <p className="p-6 text-sm text-red-700">{error}</p> : tasks.length === 0 ? <p className="p-6 text-sm text-slate-500">还没有代码库分析任务。</p> : <div className="divide-y divide-slate-100">{tasks.slice(0, 6).map((task) => <Link key={task.id} href={`/engineering/tasks/${task.id}`} className="flex flex-wrap items-center gap-4 px-6 py-4 transition hover:bg-slate-50"><div className="min-w-0 flex-1"><p className="truncate font-medium text-slate-800">{task.input.question}</p><p className="mt-1 font-mono text-xs text-slate-400">{task.input.repository.owner}/{task.input.repository.name} · {task.id}</p></div><span className={`rounded-full px-2.5 py-1 text-xs ${tones[task.status]}`}>{labels[task.status]}</span><span className="text-xs text-slate-400">{new Date(task.createdAt).toLocaleString("zh-CN")}</span><span className="text-sm text-indigo-700">查看 →</span></Link>)}</div>}</section>;
}
