import { inspectResearchMcp } from "@/lib/mcp/research-client";
import { getRuntimeHealth } from "@/lib/runtime-health";

export const dynamic = "force-dynamic";

export default async function MCPPage() {
  let inspection: Awaited<ReturnType<typeof inspectResearchMcp>> | null = null;
  let connectionError = "";
  try {
    inspection = await inspectResearchMcp();
  } catch (error) {
    connectionError = error instanceof Error ? error.message : "MCP 握手失败";
  }

  const runtime = getRuntimeHealth();
  return (
    <main className="mx-auto max-w-6xl p-6 lg:p-9">
      <p className="text-sm font-medium text-indigo-600">MODEL CONTEXT PROTOCOL</p>
      <h1 className="mt-1 text-3xl font-semibold">MCP 连接</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
        这里展示真实 MCP 初始化与工具发现结果。Harness 使用 InMemory Transport 调用；配置访问令牌后，也可通过 Streamable HTTP 连接外部 MCP Client。
      </p>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">{inspection?.server?.name ?? "agentos-research"}</h2>
              <span className={`rounded-full px-3 py-1 text-xs ${inspection ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                {inspection ? "握手成功" : "连接失败"}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-500">MCP SDK 1.29 · Server {inspection?.server?.version ?? "1.0.0"}</p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>内部：InMemory Transport</p>
            <p className="mt-1">远程：Streamable HTTP · {runtime.remoteMcpEnabled ? "已启用" : "未配置令牌"}</p>
            <p className="mt-1">Host Allowlist：{runtime.allowedMcpHostCount} 个主机</p>
          </div>
        </div>

        {connectionError && <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{connectionError}</p>}
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {(inspection?.tools ?? []).map((tool) => (
            <article key={tool.name} className="rounded-xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center justify-between gap-3">
                <code className="font-semibold text-indigo-700">{tool.name}</code>
                <span className="rounded bg-emerald-100 px-2 py-1 text-[11px] text-emerald-700">只读工具</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">{tool.description}</p>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
                <span className="rounded bg-white px-2 py-1 text-slate-600">readOnly: {String(tool.annotations?.readOnlyHint)}</span>
                <span className="rounded bg-white px-2 py-1 text-slate-600">openWorld: {String(tool.annotations?.openWorldHint)}</span>
                <span className="rounded bg-white px-2 py-1 text-slate-600">结构化输出</span>
              </div>
            </article>
          ))}
          <article className="rounded-xl border border-dashed border-slate-300 p-5">
            <h3 className="font-medium">远程连接</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">Endpoint：<code>/api/mcp/research</code></p>
            <p className="mt-1 text-sm leading-6 text-slate-500">认证：Bearer Token · Host Allowlist</p>
            <p className="mt-3 text-xs text-slate-400">未配置 MCP_ACCESS_TOKEN 时采用 fail-closed，远程端点返回 503。</p>
          </article>
        </div>

        {inspection?.instructions && (
          <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm leading-6 text-indigo-800">
            <span className="font-medium">Server Instructions：</span>{inspection.instructions}
          </div>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-semibold">调用链</h2>
        <div className="mt-4 grid gap-3 text-center text-sm md:grid-cols-5">
          {["Harness", "MCP Client", "tools/list", "search_web", "Source Policy"].map((item, index) => (
            <div key={item} className="rounded-xl border border-slate-200 px-3 py-4 text-slate-600">
              <span className="mr-2 text-xs text-indigo-500">{index + 1}</span>{item}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
