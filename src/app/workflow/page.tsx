const nodes = [
  ["01", "Task", "绑定 GitHub 仓库与分析目标", "等待审批"],
  ["02", "Planner", "选择入口文件并规划 import 递归预算", "结构化计划"],
  ["03", "GitHub MCP", "发现并调用只读仓库与文件工具", "github:read"],
  ["04", "Code Analyzer", "AST 提取函数、import 和跨文件调用边", "确定性分析"],
  ["05", "Reviewer", "评估证据覆盖、风险与报告可信度", "质量门禁"],
];
export default function WorkflowPage() { return <main className="mx-auto max-w-7xl p-6 lg:p-9"><p className="text-sm font-medium text-indigo-600">CODE UNDERSTANDING WORKFLOW</p><h1 className="mt-1 text-3xl font-semibold">只读代码理解工作流</h1><p className="mt-2 text-sm text-slate-500">每个结论都应回链到仓库文件、符号或调用边。</p><div className="mt-10 grid gap-3 lg:grid-cols-5">{nodes.map(([number, title, desc, status]) => <section key={title} className="rounded-2xl border border-slate-200 bg-white p-5"><span className="text-xs font-medium text-indigo-600">{number}</span><h2 className="mt-3 font-semibold">{title}</h2><p className="mt-2 min-h-16 text-sm leading-6 text-slate-500">{desc}</p><span className="mt-5 inline-block rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{status}</span></section>)}</div><section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-medium">V1 执行边界</h2><div className="mt-3 flex flex-wrap gap-2">{["仅公开或已授权仓库", "最多深读 10 个文件", "源码单文件最多 16KB", "只读 GitHub MCP", "不修改代码", "报告带质量评分"].map(item => <span key={item} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{item}</span>)}</div></section></main>; }
