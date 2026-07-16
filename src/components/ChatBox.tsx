"use client";

import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type StepState = "done" | "active" | "waiting" | "queued" | "failed";
type Step = { title: string; detail: string; state: StepState; kind: string };
type Source = { title: string; url: string; content: string; domain?: string; qualityScore?: number; riskLevel?: "low" | "medium" | "high"; riskReasons?: string[]; sourceType?: string; credibility?: "high" | "medium" | "low"; freshness?: "current" | "recent" | "aging" | "unknown"; publishedDate?: string; qualityReasons?: string[] };
type Review = { approved: boolean; score: number; issues: string[]; revisionInstructions: string; citationCheck?: { valid: boolean; issues: string[]; citationCount: number } };
type HarnessBudget = { limits: { maxSteps: number; maxModelCalls: number; maxToolCalls: number; maxDurationMs: number }; usage: { steps: number; modelCalls: number; toolCalls: number; elapsedMs: number; lastAction?: string } };
type EvidenceCoverage = { score: number; sourceCount: number; targetSourceCount: number; sourceTypeDiversity: number; highCredibilitySourceCount: number; recentSourceCount: number; citedSourceCount?: number; notes: string[] };
type TaskObservability = { totalDurationMs: number; totalTokens: number; estimatedCostUsd?: number; modelCalls: Array<{ agent: string; latencyMs: number; totalTokens?: number; estimatedCostUsd?: number }> };
type RuntimeHealth = { ready: boolean; model: string; deepSeekConfigured: boolean; tavilyConfigured: boolean; remoteMcpEnabled: boolean; allowedMcpHostCount: number; taskStoreMode: "json" | "postgres"; queueMode: "in-memory" | "redis" };
type Stage = "idle" | "approval" | "paused" | "running" | "done" | "failed" | "cancelled";
type SavedTask = {
  id: string;
  topic: string;
  status: string;
  currentStep: number;
  report?: string;
  sources?: Source[];
  review?: Review;
  attempts?: number;
  events?: string[];
  error?: string;
  executionId?: string;
  startedAt?: string;
  completedAt?: string;
  harnessBudget?: HarnessBudget;
  evidenceCoverage?: EvidenceCoverage;
  observability?: TaskObservability;
};
type ResearchPayload = { task?: SavedTask; error?: string; message?: string };

const blueprint: Step[] = [
  { title: "理解目标", detail: "等待输入调研主题", state: "active", kind: "Planner" },
  { title: "生成调研计划", detail: "拆分问题与来源策略", state: "queued", kind: "Planner" },
  { title: "检索与提取来源", detail: "通过 MCP 调用网页搜索", state: "queued", kind: "MCP Tool" },
  { title: "整理报告草稿", detail: "生成带引用的 Markdown", state: "queued", kind: "Executor" },
  { title: "质量复核", detail: "检查来源与报告结构", state: "queued", kind: "Reviewer" },
];

const colors: Record<StepState, string> = {
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
  active: "border-indigo-200 bg-indigo-50 text-indigo-700",
  waiting: "border-amber-200 bg-amber-50 text-amber-700",
  queued: "border-slate-200 bg-white text-slate-400",
  failed: "border-red-200 bg-red-50 text-red-700",
};

function stageFromStatus(status: string): Stage {
  if (status === "waiting_approval") return "approval";
  if (status === "completed") return "done";
  if (status === "cancelled") return "cancelled";
  if (status === "paused" || status === "running" || status === "failed") return status;
  return "idle";
}

function buildSteps(task: SavedTask): Step[] {
  const details = [
    "已识别调研目标",
    task.currentStep > 2 ? "Planner 已输出结构化计划" : "Planner 正在制定结构化计划",
    task.sources?.length ? `MCP Tool 返回 ${task.sources.length} 个安全来源` : "MCP Client 正在发现并调用工具",
    task.currentStep > 4 ? `Executor 已完成报告，共 ${task.attempts ?? 1} 轮` : "Executor 正在整理报告",
    task.review ? `Reviewer 评分 ${task.review.score}` : "Reviewer 正在执行质量门禁",
  ];

  return blueprint.map((step, index) => {
    const stepNumber = index + 1;
    if (task.status === "completed") return { ...step, detail: details[index], state: "done" };
    if (task.status === "waiting_approval" || task.status === "paused") {
      if (stepNumber === 1) return { ...step, detail: details[index], state: "done" };
      if (stepNumber === 2) return { ...step, detail: task.status === "paused" ? "任务已暂停，可从恢复点继续" : "等待用户审批", state: "waiting" };
      return { ...step, state: "queued" };
    }
    if (stepNumber < task.currentStep) return { ...step, detail: details[index], state: "done" };
    if (stepNumber === task.currentStep) return { ...step, detail: details[index], state: task.status === "failed" ? "failed" : "active" };
    return { ...step, state: "queued" };
  });
}

function durationLabel(startedAt: string, completedAt: string, now: number) {
  if (!startedAt) return "--";
  const end = completedAt ? new Date(completedAt).getTime() : now;
  const seconds = Math.max(0, Math.floor((end - new Date(startedAt).getTime()) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function ChatBox({ initialTaskId = "" }: { initialTaskId?: string }) {
  const [prompt, setPrompt] = useState("");
  const [task, setTask] = useState("");
  const [taskId, setTaskId] = useState("");
  const [steps, setSteps] = useState(blueprint);
  const [stage, setStage] = useState<Stage>("idle");
  const [report, setReport] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState("");
  const [events, setEvents] = useState(["Harness 就绪：唯一执行权 · 工具预算 3 次 · 写操作需审批"]);
  const [executionId, setExecutionId] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [completedAt, setCompletedAt] = useState("");
  const [harnessBudget, setHarnessBudget] = useState<HarnessBudget | null>(null);
  const [evidenceCoverage, setEvidenceCoverage] = useState<EvidenceCoverage | null>(null);
  const [observability, setObservability] = useState<TaskObservability | null>(null);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealth | null>(null);
  const [now, setNow] = useState(0);

  const hydrateTask = useCallback((saved: SavedTask, loaded = false) => {
    setTaskId(saved.id);
    setTask(saved.topic);
    setReport(saved.report ?? "");
    setSources(saved.sources ?? []);
    setReview(saved.review ?? null);
    setAttempts(saved.attempts ?? 0);
    setExecutionId(saved.executionId ?? "");
    setStartedAt(saved.startedAt ?? "");
    setCompletedAt(saved.completedAt ?? "");
    setHarnessBudget(saved.harnessBudget ?? null);
    setEvidenceCoverage(saved.evidenceCoverage ?? null);
    setObservability(saved.observability ?? null);
    setStage(stageFromStatus(saved.status));
    setSteps(buildSteps(saved));
    setEvents(loaded ? [...(saved.events ?? []), `已从持久化记录加载：${saved.id}`] : (saved.events ?? []));
    setError(saved.status === "failed" ? saved.error ?? "任务执行失败。" : "");
  }, []);

  useEffect(() => {
    if (!initialTaskId) return;
    let cancelled = false;
    fetch(`/api/tasks/${initialTaskId}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as ResearchPayload;
        if (!response.ok || !payload.task) throw new Error(payload.error ?? "任务加载失败。");
        if (!cancelled) hydrateTask(payload.task, true);
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "任务加载失败。"); });
    return () => { cancelled = true; };
  }, [hydrateTask, initialTaskId]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { runtime?: RuntimeHealth };
        if (!response.ok || !payload.runtime) throw new Error("运行环境状态读取失败。");
        if (!cancelled) setRuntimeHealth(payload.runtime);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (stage !== "running" || !taskId) return;
    const stream = new EventSource(`/api/tasks/${taskId}/events`);
    let receivedTerminalSnapshot = false;
    const receive = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as ResearchPayload;
      if (payload.task) {
        receivedTerminalSnapshot = payload.task.status !== "running";
        if (receivedTerminalSnapshot) stream.close();
        hydrateTask(payload.task);
      }
    };
    stream.addEventListener("snapshot", receive);
    stream.onerror = () => {
      if (!receivedTerminalSnapshot && stream.readyState !== EventSource.CLOSED) setError("实时事件连接暂时中断，浏览器将自动重连。");
    };
    return () => stream.close();
  }, [hydrateTask, stage, taskId]);

  useEffect(() => {
    if (!startedAt || completedAt) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [completedAt, startedAt]);

  async function createTask() {
    const value = prompt.trim();
    if (!value || stage === "running") return;
    setError("");
    const response = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic: value }) });
    const payload = await response.json() as ResearchPayload;
    if (!response.ok || !payload.task) { setError(payload.error ?? "任务创建失败。"); return; }
    setPrompt("");
    hydrateTask(payload.task);
    setEvents([...(payload.task.events ?? []), "权限检查：Multi-Agent 工作流需要用户确认"]);
  }

  async function taskAction(action: "pause" | "resume" | "retry" | "cancel") {
    const response = await fetch(`/api/tasks/${taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const payload = await response.json() as ResearchPayload;
    if (!response.ok || !payload.task) { setError(payload.error ?? "操作失败。"); return; }
    hydrateTask(payload.task);
  }

  async function approve() {
    setStage("running");
    setError("");
    setEvents((previous) => [...previous, "审批通过：正在竞争唯一执行权"]);
    try {
      const response = await fetch("/api/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId, approval: { externalTools: true } }) });
      const payload = await response.json() as ResearchPayload;
      if (!response.ok) throw new Error(payload.error ?? "任务执行请求失败。");
      if (!payload.task) throw new Error("未获得有效任务结果。");
      if (response.status === 202) setEvents((previous) => [...previous, payload.message ?? "任务已进入后台执行队列"]);
      hydrateTask(payload.task);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "任务执行失败。";
      setError(message);
      setStage("failed");
      setEvents((previous) => [...previous, `执行失败：${message}`]);
    }
  }

  const elapsed = durationLabel(startedAt, completedAt, now);
  const canExecute = runtimeHealth?.ready !== false;
  const stageLabel: Record<Stage, string> = { idle: "等待任务", approval: "等待审批", paused: "已暂停", running: "执行中", done: "已完成", failed: "执行失败", cancelled: "已取消" };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_380px]">
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-5">
          <div><p className="text-sm font-medium">调研报告任务</p><p className="mt-1 text-sm text-slate-500">{taskId || "由 Planner、Executor 与 Reviewer 协同完成"}</p></div>
          <div className="flex items-center gap-2"><span className="text-xs text-slate-400">{elapsed}</span><span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">{stageLabel[stage]}</span></div>
        </header>

        <div className="min-h-80 space-y-5 px-6 py-6">
          {task ? <div className="ml-auto max-w-xl rounded-2xl rounded-tr-sm bg-indigo-600 px-4 py-3 text-sm text-white">{task}</div> : <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">试试输入：“调研 AI Agent 在企业知识管理中的应用与风险”</div>}
          {runtimeHealth && <div className={`rounded-xl border p-4 text-sm ${runtimeHealth.ready ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">运行环境 {runtimeHealth.ready ? "已就绪" : "未就绪"}</span><span className="font-mono text-xs">{runtimeHealth.model}</span></div><p className="mt-1 text-xs leading-5">DeepSeek：{runtimeHealth.deepSeekConfigured ? "已配置" : "缺少 Key"} · Tavily：{runtimeHealth.tavilyConfigured ? "已配置" : "缺少 Key"} · 远程 MCP：{runtimeHealth.remoteMcpEnabled ? "已启用" : "未启用（可选）"}</p><p className="mt-1 text-xs leading-5">持久化：{runtimeHealth.taskStoreMode === "postgres" ? "PostgreSQL" : "本地 JSON"} · 队列：{runtimeHealth.queueMode === "redis" ? "Redis / BullMQ" : "进程内 Worker"}</p></div>}
          {stage === "approval" && <div className="rounded-xl border border-amber-200 bg-amber-50 p-5"><p className="font-medium text-amber-900">需要你的批准</p><p className="mt-1 text-sm leading-6 text-amber-800">Planner、Executor 与 Reviewer 将分别调用模型。系统会先获取唯一执行权，避免重复请求产生费用。</p>{!canExecute && <p className="mt-3 text-sm text-red-700">请先在 .env.local 配置缺失的 DeepSeek 或 Tavily Key，然后重启开发服务器。</p>}<div className="mt-4 flex gap-3"><button onClick={approve} disabled={!canExecute} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-300">批准并继续</button><button onClick={() => taskAction("pause")} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm">暂停任务</button></div></div>}
          {stage === "paused" && <div className="rounded-xl border border-slate-200 bg-slate-50 p-5"><p className="font-medium">任务已暂停</p><p className="mt-1 text-sm text-slate-600">恢复点已持久化，可以继续当前任务。</p><button onClick={() => taskAction("resume")} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white">恢复任务</button></div>}
          {(stage === "failed" || stage === "cancelled") && <button onClick={() => taskAction("retry")} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white">重置并重试</button>}
          {stage === "running" && <div className="rounded-xl bg-indigo-50 p-5 text-sm text-indigo-800"><div className="flex items-center justify-between"><span>后台 Worker 执行中，SSE 实时推送步骤</span><span className="font-mono text-xs">{elapsed}</span></div>{executionId && <p className="mt-2 truncate font-mono text-xs text-indigo-500">execution: {executionId}</p>}<button onClick={() => taskAction("cancel")} className="mt-3 rounded-lg border border-indigo-300 bg-white px-3 py-2 text-xs text-indigo-700">取消任务</button></div>}
          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">{error}</div>}
          {review && <div className={`flex items-center justify-between rounded-xl border p-4 text-sm ${review.approved ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}><span>Reviewer {review.approved ? "已通过" : "要求修订"} · {attempts} 轮执行{review.citationCheck ? ` · ${review.citationCheck.citationCount} 个有效引用` : ""}</span><strong className="text-lg">{review.score}/100</strong></div>}

          {report && <><article className="report-markdown rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}>{report}</ReactMarkdown></article>{evidenceCoverage && <section className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4"><div className="flex items-center justify-between"><h2 className="text-sm font-medium text-indigo-950">证据覆盖度</h2><strong className="text-lg text-indigo-700">{evidenceCoverage.score}/100</strong></div><p className="mt-1 text-xs text-indigo-700">来源 {evidenceCoverage.sourceCount}/{evidenceCoverage.targetSourceCount} · 类型 {evidenceCoverage.sourceTypeDiversity} 类 · 高可信 {evidenceCoverage.highCredibilitySourceCount} · 近期 {evidenceCoverage.recentSourceCount}{evidenceCoverage.citedSourceCount !== undefined ? ` · 有效引用 ${evidenceCoverage.citedSourceCount}` : ""}</p><p className="mt-2 text-[11px] leading-5 text-slate-500">{evidenceCoverage.notes.at(-1)}</p></section>}<section className="rounded-xl border border-slate-200 p-5"><div className="flex items-center justify-between"><h2 className="font-medium">检索来源</h2><span className="text-xs text-slate-400">已通过 Source Policy</span></div><div className="mt-3 space-y-2">{sources.map((source, index) => <details key={source.url} className="rounded-lg border border-slate-200 px-3 py-2"><summary className="cursor-pointer text-sm font-medium text-indigo-700">[{index +1}] {source.title}</summary><div className="mt-2 flex flex-wrap gap-2 text-[11px]"><span className="rounded bg-slate-100 px-2 py-1 text-slate-600">{source.domain ?? new URL(source.url).hostname}</span>{source.qualityScore !== undefined && <span className="rounded bg-indigo-50 px-2 py-1 text-indigo-700">质量 {source.qualityScore}/100</span>}<span className="rounded bg-violet-50 px-2 py-1 text-violet-700">{source.sourceType ?? "其他"}</span><span className={`rounded px-2 py-1 ${source.credibility === "high" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>可信度 {source.credibility === "high" ? "高" : source.credibility === "medium" ? "中" : "待核"}</span><span className="rounded bg-slate-100 px-2 py-1 text-slate-600">时效 {source.freshness === "current" ? "近期" : source.freshness === "recent" ? "近两年" : source.freshness === "aging" ? "较早" : "未提供"}</span><span className={`rounded px-2 py-1 ${source.riskLevel === "medium" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{source.riskLevel === "medium" ? "需谨慎" : "低风险"}</span></div>{source.publishedDate && <p className="mt-2 text-[11px] text-slate-500">发布时间：{source.publishedDate}</p>}<p className="mt-2 text-xs leading-5 text-slate-500">{source.content}</p><a className="mt-2 inline-block text-xs text-indigo-700 hover:underline" href={source.url} target="_blank" rel="noreferrer">打开原始网页 ↗</a></details>)}</div></section></>}
        </div>

        <form onSubmit={(event) => { event.preventDefault(); void createTask(); }} className="border-t border-slate-100 p-4"><div className="flex gap-3"><input value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={stage === "running"} className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm disabled:bg-slate-100" placeholder={stage === "running" ? "当前任务执行完成后可创建新任务" : "描述你想调研的主题…"} /><button disabled={stage === "running"} className="rounded-xl bg-indigo-600 px-5 text-sm font-medium text-white disabled:bg-slate-300">创建任务</button></div></form>
      </section>

      <aside className="space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex justify-between"><h2 className="font-medium">执行工作流</h2><span className="text-xs text-slate-400">5 steps</span></div><div className="space-y-3">{steps.map((step, index) => <div key={step.title} className={`rounded-xl border p-3 ${colors[step.state]}`}><div className="flex justify-between gap-2 text-sm font-medium"><span>{index + 1}. {step.title}</span><span className="text-[11px]">{step.kind}</span></div><p className="mt-1 text-xs opacity-80">{step.detail}</p></div>)}</div></section>
        {observability && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="font-medium">模型可观测性</h2><span className="text-xs text-slate-400">live</span></div><div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]"><span className="rounded-lg bg-slate-50 px-2 py-2 text-slate-600">调用 {observability.modelCalls.length}</span><span className="rounded-lg bg-slate-50 px-2 py-2 text-slate-600">Token {observability.totalTokens || "--"}</span><span className="rounded-lg bg-slate-50 px-2 py-2 text-slate-600">估算 {observability.estimatedCostUsd === undefined ? "未配置单价" : `$${observability.estimatedCostUsd.toFixed(4)}`}</span></div><p className="mt-2 text-xs text-slate-500">总耗时 {(observability.totalDurationMs / 1000).toFixed(1)}s；成本仅使用服务端配置的每百万 Token 单价估算。</p><div className="mt-3 space-y-2">{observability.modelCalls.map((call, index) => <div key={`${call.agent}-${index}`} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"><span>{call.agent}</span><span>{call.latencyMs}ms · {call.totalTokens ?? "Token 未返回"}{call.estimatedCostUsd === undefined ? "" : ` · $${call.estimatedCostUsd.toFixed(4)}`}</span></div>)}</div></section>}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="font-medium">Harness 事件</h2><span className="text-xs text-slate-400">live</span></div>{harnessBudget && <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]"><span className="rounded-lg bg-slate-50 px-2 py-2 text-slate-600">步骤 {harnessBudget.usage.steps}/{harnessBudget.limits.maxSteps}</span><span className="rounded-lg bg-slate-50 px-2 py-2 text-slate-600">模型 {harnessBudget.usage.modelCalls}/{harnessBudget.limits.maxModelCalls}</span><span className="rounded-lg bg-slate-50 px-2 py-2 text-slate-600">工具 {harnessBudget.usage.toolCalls}/{harnessBudget.limits.maxToolCalls}</span></div>}<ol className="mt-3 space-y-3 border-l border-slate-200 pl-4">{events.map((event, index) => <li key={`${event}-${index}`} className="text-xs leading-5 text-slate-600">{event}</li>)}</ol></section>
      </aside>
    </div>
  );
}
