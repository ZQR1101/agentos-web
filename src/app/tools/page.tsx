import { toolRegistry } from "@/lib/tool-policy";

const approvalLabel = { required: "需要批准", automatic: "自动允许" } as const;

export default function ToolsPage() {
  return (
    <main className="mx-auto max-w-6xl p-6 lg:p-9">
      <p className="text-sm font-medium text-indigo-600">PERMISSION POLICY</p>
      <h1 className="mt-1 text-3xl font-semibold">工具与权限</h1>
      <p className="mt-2 text-sm text-slate-500">页面直接读取服务端 Tool Registry；未注册、禁用、越权或未审批的调用默认拒绝。</p>
      <div className="mt-8 space-y-3">
        {toolRegistry.map((tool) => (
          <section key={tool.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-5">
            <div className="min-w-60 flex-1"><p className="font-mono text-sm font-medium">{tool.id}</p><p className="mt-1 text-sm text-slate-500">{tool.description}</p></div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs uppercase text-slate-600">{tool.type}</span>
            <span className="text-sm text-slate-600">{tool.scope === "read" ? "只读" : "写入"}</span>
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-700">{approvalLabel[tool.approval]}</span>
            <span className={`rounded-full px-3 py-1 text-xs ${tool.enabled ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{tool.enabled ? "已启用" : "已禁用"}</span>
          </section>
        ))}
      </div>
    </main>
  );
}
