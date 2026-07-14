"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ResearchTask, TaskStatus } from "@/types/task";

const labels: Record<TaskStatus, string> = { waiting_approval: "等待审批", paused: "已暂停", running: "执行中", completed: "已完成", failed: "失败" };

function duration(task: ResearchTask, now: number) {
  if (!task.startedAt) return "--";
  const end = task.completedAt ? new Date(task.completedAt).getTime() : now;
  const seconds = Math.max(0, Math.floor((end - new Date(task.startedAt).getTime()) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function RunsList() {
  const [tasks, setTasks] = useState<ResearchTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/tasks", { cache: "no-store" });
        const data = await response.json() as { tasks?: ResearchTask[] };
        if (!cancelled) { setTasks(data.tasks ?? []); setNow(Date.now()); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const interval = window.setInterval(load, 3000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  if (loading) return <p className="mt-8 text-sm text-slate-500">正在读取任务记录…</p>;
  if (!tasks.length) return <div className="mt-8 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">还没有真实任务记录，请先在任务工作台创建一个任务。</div>;

  return (
    <div className="mt-8 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <div className="min-w-[820px]">
        <div className="grid grid-cols-[1.5fr_.7fr_.55fr_.7fr_.4fr] border-b border-slate-100 px-5 py-3 text-xs font-medium text-slate-500"><span>任务</span><span>状态</span><span>步骤 / 耗时</span><span>更新时间</span><span></span></div>
        {tasks.map((task) => (
          <div key={task.id} className="grid grid-cols-[1.5fr_.7fr_.55fr_.7fr_.4fr] items-center border-b border-slate-100 px-5 py-5 text-sm last:border-0">
            <div><p className="font-medium text-slate-800">{task.topic}</p><p className="mt-1 font-mono text-xs text-slate-400">{task.id}{task.executionId ? ` · ${task.executionId.slice(0, 8)}` : ""}</p>{task.skill && <p className="mt-1 font-mono text-[11px] text-indigo-500">{task.skill.id}@{task.skill.version}</p>}</div>
            <span className={`w-fit rounded-full px-2.5 py-1 text-xs ${task.status === "completed" ? "bg-emerald-50 text-emerald-700" : task.status === "failed" ? "bg-red-50 text-red-700" : task.status === "running" ? "bg-indigo-50 text-indigo-700" : task.status === "paused" ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700"}`}>{labels[task.status]}</span>
            <span className="text-slate-600">{task.currentStep} / 5 <small className="ml-1 text-slate-400">{duration(task, now)}</small>{task.harnessBudget && <small className="mt-1 block text-slate-400">Harness {task.harnessBudget.usage.steps}/{task.harnessBudget.limits.maxSteps}</small>}</span>
            <span className="text-xs text-slate-500">{new Date(task.updatedAt).toLocaleString("zh-CN")}</span>
            <Link href={`/chat?task=${task.id}`} className="text-xs font-medium text-indigo-700 hover:underline">打开任务</Link>
          </div>
        ))}
      </div>
    </div>
  );
}
