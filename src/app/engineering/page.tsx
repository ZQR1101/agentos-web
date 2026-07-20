import { createEngineeringPlan } from "@/lib/software-engineering-workflow";
import type { EngineeringStep } from "@/types/software-engineering";
import EngineeringTaskLauncher from "@/components/EngineeringTaskLauncher";
import EngineeringTaskList from "@/components/EngineeringTaskList";

const plan = createEngineeringPlan(
  { repository: { provider: "github", owner: "acme-labs", name: "checkout-service", defaultBranch: "main" }, useCase: "bug_triage", question: "用户登录失败，帮我分析", issue: { number: 184, title: "Prevent duplicate checkout on retry", url: "https://github.com/acme-labs/checkout-service/issues/184" } },
);

const agentTone: Record<EngineeringStep["agent"], string> = {
  Coordinator: "bg-slate-100 text-slate-600", Planner: "bg-indigo-50 text-indigo-700", Repository: "bg-blue-50 text-blue-700", "Bug Analyst": "bg-amber-50 text-amber-700", Security: "bg-red-50 text-red-700", "Code Review": "bg-violet-50 text-violet-700", Test: "bg-cyan-50 text-cyan-700", Reviewer: "bg-emerald-50 text-emerald-700",
};

export default function EngineeringPage() {
  return <main className="mx-auto max-w-7xl p-6 lg:p-9">
    <div className="flex flex-wrap items-end justify-between gap-5">
      <div><p className="text-sm font-medium text-indigo-600">SOFTWARE ENGINEERING AGENT</p><h1 className="mt-1 text-3xl font-semibold">代码分析控制台</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">将代码库理解、Bug 定位和 PR 审查变成带证据、可复核的多 Agent 流程。</p></div>
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-right"><p className="text-[11px] uppercase tracking-[.15em] text-slate-400">Runtime posture</p><p className="mt-1 text-sm font-medium text-emerald-700">只读 · 不修改代码</p></div>
    </div>

    <EngineeringTaskLauncher />
    <EngineeringTaskList />

    <section className="mt-6 grid gap-4 md:grid-cols-3">
      {[["01", "Task & Planner", "将仓库与分析目标转成受控、可追踪的只读检索计划。"], ["02", "GitHub MCP", "发现并调用仓库概览工具，读取目录、配置和代码证据。"], ["03", "Code Analyzer & Reviewer", "归纳模块与调用链，再检查结论的证据范围和潜在风险。"]].map(([number, title, detail]) => <article key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span className="font-mono text-xs text-indigo-600">{number}</span><h2 className="mt-5 font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{detail}</p></article>)}
    </section>

    <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-6 py-5"><div><p className="text-xs font-medium text-indigo-600">DEMO ANALYSIS PLAN</p><h2 className="mt-1 font-semibold">#{184} · {plan.question}</h2><p className="mt-1 text-sm text-slate-500">{plan.repository.owner}/{plan.repository.name} · {plan.repository.defaultBranch} · <code className="text-indigo-700">{plan.output}</code></p></div><span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">等待分析审批</span></header>
      <div className="grid gap-px bg-slate-100 lg:grid-cols-2">
        {plan.steps.map((step, index) => <article key={step.id} className="bg-white p-5"><div className="flex items-start justify-between gap-3"><div className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 font-mono text-xs text-slate-500">{String(index + 1).padStart(2, "0")}</span><div><h3 className="font-medium">{step.title}</h3><p className="mt-1 text-sm leading-6 text-slate-500">{step.description}</p></div></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${agentTone[step.agent]}`}>{step.agent}</span></div><div className="mt-4 flex flex-wrap gap-2 pl-10">{step.toolScopes.map((scope) => <span key={scope} className="rounded bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-500">{scope}</span>)}<span className="rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">只读执行</span></div></article>)}
      </div>
    </section>
  </main>;
}
