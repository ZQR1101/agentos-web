const agents = [
  ["Planner", "选择入口和配置文件，沿 import 关系追加证据", "只生成计划，不直接访问 GitHub"],
  ["GitHub MCP", "读取仓库元数据、目录树和受限源码内容", "仅 github:read，最多 10 个文件"],
  ["Code Analyzer", "用 TypeScript AST 构建函数与跨文件调用图", "确定性本地分析，无外部写入"],
  ["Reviewer", "检查证据数量、目录完整性和测试覆盖信号", "不调用外部工具"],
];
export default function AgentsPage() { return <main className="mx-auto max-w-7xl p-6 lg:p-9"><p className="text-sm font-medium text-indigo-600">CONTROLLED COLLABORATION</p><h1 className="mt-1 text-3xl font-semibold">Code Understanding 角色</h1><p className="mt-2 text-sm text-slate-500">角色通过结构化任务、工具输出和质量评估交接。</p><div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">{agents.map(([name, duty, permission]) => <section key={name} className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">{name}</h2><p className="mt-4 text-sm leading-6 text-slate-600">{duty}</p><div className="mt-6 border-t border-slate-100 pt-4"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">权限边界</p><p className="mt-2 text-sm text-slate-700">{permission}</p></div></section>)}</div></main>; }
