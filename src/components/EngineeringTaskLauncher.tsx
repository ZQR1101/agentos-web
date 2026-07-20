"use client";

import { FormEvent, useState } from "react";
import ReactMarkdown from "react-markdown";
import Link from "next/link";

export default function EngineeringTaskLauncher() {
  const [useCase, setUseCase] = useState<"repository_analysis" | "bug_triage" | "pull_request_review">("repository_analysis");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [issueUrl, setIssueUrl] = useState("");
  const [pullRequestUrl, setPullRequestUrl] = useState("");
  const [question, setQuestion] = useState("分析这个 GitHub 项目架构");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [status, setStatus] = useState<"" | "waiting_approval" | "queued" | "running" | "completed" | "failed" | "cancelled">("");
  const [report, setReport] = useState("");
  const [approving, setApproving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setCreating(true); setError(""); setTaskId(""); setStatus(""); setReport("");
    try {
      const response = await fetch("/api/engineering/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repositoryUrl, question, useCase, issueUrl, pullRequestUrl }) });
      const payload = await response.json() as { task?: { id: string }; error?: string };
      if (!response.ok || !payload.task) throw new Error(payload.error ?? "任务创建失败。");
      setTaskId(payload.task.id); setStatus("waiting_approval");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "任务创建失败。"); }
    finally { setCreating(false); }
  }

  function poll(id: string) {
    window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/engineering/tasks/${id}`, { cache: "no-store" });
        const payload = await response.json() as { task?: { status: "queued" | "running" | "completed" | "failed" | "cancelled"; report?: string; error?: string } };
        if (!response.ok || !payload.task) throw new Error("任务状态读取失败。");
        setStatus(payload.task.status); setReport(payload.task.report ?? "");
        if (payload.task.status === "queued" || payload.task.status === "running") poll(id);
        if (payload.task.status === "failed") setError(payload.task.error ?? "代码库分析失败。");
      } catch (caught) { setError(caught instanceof Error ? caught.message : "任务状态读取失败。"); }
    }, 700);
  }

  async function approve() {
    if (!taskId) return; setApproving(true); setError("");
    try {
      const response = await fetch(`/api/engineering/tasks/${taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve" }) });
      const payload = await response.json() as { task?: { status: "queued" | "running" | "completed" | "failed" | "cancelled"; report?: string }; error?: string };
      if (!response.ok || !payload.task) throw new Error(payload.error ?? "审批失败。");
      setStatus(payload.task.status); setReport(payload.task.report ?? "");
      if (payload.task.status === "queued" || payload.task.status === "running") poll(taskId);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "审批失败。"); }
    finally { setApproving(false); }
  }

  async function cancel() {
    if (!taskId) return;
    const response = await fetch(`/api/engineering/tasks/${taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
    const payload = await response.json() as { task?: { status: "cancelled" }; error?: string };
    if (!response.ok || !payload.task) { setError(payload.error ?? "取消失败。"); return; }
    setStatus("cancelled");
  }

  async function retry() {
    if (!taskId) return;
    const response = await fetch(`/api/engineering/tasks/${taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "retry" }) });
    const payload = await response.json() as { task?: { status: "queued" }; error?: string };
    if (!response.ok || !payload.task) { setError(payload.error ?? "重试失败。"); return; }
    setError(""); setStatus("queued"); poll(taskId);
  }

  return <section className="mt-8 rounded-2xl border border-indigo-200 bg-white p-6 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-medium text-indigo-600">NEW SOFTWARE TASK</p><h2 className="mt-1 text-xl font-semibold">开始一次只读工程分析</h2><p className="mt-2 text-sm text-slate-500">选择架构理解、Bug 定位或 PR 审查；任务创建后进入权限审批。</p></div><span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">github:read</span></div>
    <div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={() => { setUseCase("repository_analysis"); setQuestion("分析这个 GitHub 项目架构"); }} className={`rounded-lg border px-3 py-2 text-xs ${useCase === "repository_analysis" ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500"}`}>代码库架构分析</button><button type="button" onClick={() => { setUseCase("bug_triage"); setQuestion("分析这个 Issue 的可能根因"); }} className={`rounded-lg border px-3 py-2 text-xs ${useCase === "bug_triage" ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500"}`}>Bug 定位</button><button type="button" onClick={() => { setUseCase("pull_request_review"); setQuestion("审查这个 PR 的安全、质量和测试风险"); }} className={`rounded-lg border px-3 py-2 text-xs ${useCase === "pull_request_review" ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500"}`}>PR 审查</button></div>
    <form onSubmit={submit} className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.15fr_auto] lg:items-end">
      <label className="block text-sm font-medium">GitHub 仓库地址<input required value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="https://github.com/vercel/next.js" /></label>
      <label className="block text-sm font-medium">{useCase === "bug_triage" ? "GitHub Issue 地址" : useCase === "pull_request_review" ? "GitHub Pull Request 地址" : "分析目标"}<input required value={useCase === "bug_triage" ? issueUrl : useCase === "pull_request_review" ? pullRequestUrl : question} onChange={(event) => useCase === "bug_triage" ? setIssueUrl(event.target.value) : useCase === "pull_request_review" ? setPullRequestUrl(event.target.value) : setQuestion(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder={useCase === "bug_triage" ? "https://github.com/owner/repo/issues/42" : useCase === "pull_request_review" ? "https://github.com/owner/repo/pull/42" : "分析这个 GitHub 项目架构"} /></label>
      <button disabled={creating} className="h-[46px] rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300">{creating ? "创建中…" : "创建分析任务 →"}</button>
    </form>
    {useCase !== "repository_analysis" && <label className="mt-4 block text-sm font-medium">补充分析目标<input required value={question} onChange={(event) => setQuestion(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder={useCase === "bug_triage" ? "例如：重点检查 token 过期处理" : "例如：重点检查鉴权边界和缺失测试"} /></label>}
    {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    {taskId && <div className={`mt-4 rounded-xl border p-4 text-sm ${status === "completed" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : status === "failed" ? "border-red-200 bg-red-50 text-red-800" : status === "cancelled" ? "border-slate-200 bg-slate-50 text-slate-600" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
      {status === "waiting_approval" && <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="font-medium">等待你的审批</p><p className="mt-1 text-xs leading-5">本次任务将使用 <code>github:read</code> 读取公开仓库信息，不会修改代码、创建分支或创建 PR。</p><p className="mt-1 font-mono text-[11px] opacity-70">{taskId}</p></div><button onClick={approve} disabled={approving} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white disabled:bg-slate-300">{approving ? "审批中…" : "批准并开始分析"}</button></div>}
      {(status === "queued" || status === "running") && <div className="flex items-center justify-between gap-4"><div><p className="font-medium">{status === "queued" ? "任务已进入持久化队列" : `${useCase === "bug_triage" ? "Bug Triage Agent" : useCase === "pull_request_review" ? "PR Review Agent" : "Code Understanding Agent"} 分析中`}</p><p className="mt-1 text-xs leading-5">{status === "queued" ? "执行器将领取任务；失败时会在重试预算内自动退避重试。" : "GitHub MCP 正在读取只读证据，随后进入 Analyzer 与 Reviewer。"}</p></div><button type="button" onClick={cancel} className="rounded-lg border border-current px-3 py-2 text-xs font-medium">取消任务</button></div>}
      {status === "completed" && <><div className="flex items-center justify-between gap-4"><p className="font-medium">分析完成</p><Link href={`/engineering/tasks/${taskId}`} className="text-xs font-medium text-indigo-700">打开完整报告 →</Link></div><article className="report-markdown mt-4 rounded-xl border border-emerald-200 bg-white p-5 text-sm text-slate-700"><ReactMarkdown>{report}</ReactMarkdown></article></>}
      {status === "failed" && <div className="flex items-center justify-between gap-4"><p className="font-medium">分析失败：{error || "请检查仓库是否公开可访问。"}</p><button type="button" onClick={retry} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white">手动重试</button></div>}
      {status === "cancelled" && <p className="font-medium">任务已取消，后续 Agent 结果不会写回。</p>}
    </div>}
  </section>;
}
