import { skillRegistry } from "@/lib/skills/registry";

export default function SkillsPage() {
  return (
    <main className="mx-auto max-w-6xl p-6 lg:p-9">
      <p className="text-sm font-medium text-indigo-600">REUSABLE CAPABILITIES</p>
      <h1 className="mt-1 text-3xl font-semibold">Skills</h1>
      <p className="mt-2 text-sm text-slate-500">页面直接读取服务端 Skill Registry；版本、工具、步骤与执行代码共享同一个定义。</p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {skillRegistry.map((skill) => (
          <section key={skill.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{skill.name}</h2><span className="rounded-full bg-indigo-50 px-2 py-1 font-mono text-[11px] text-indigo-700">{skill.id}@{skill.version}</span></div>
            <p className="mt-3 text-sm leading-6 text-slate-600">{skill.description}</p>
            <div className="mt-6 space-y-3 border-t border-slate-100 pt-4 text-sm">
              <div><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Runtime</p><p className="mt-1 text-slate-700">{skill.runtime === "model" ? "Model-backed" : "Deterministic"}</p></div>
              <div><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Tools</p><p className="mt-1 font-mono text-xs text-slate-600">{skill.tools.length ? skill.tools.join(" · ") : "none"}</p></div>
              <div><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Workflow</p><p className="mt-1 text-slate-700">{skill.steps.join(" → ")}</p></div>
              <details className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><summary className="cursor-pointer font-medium">输入 / 输出契约</summary><p className="mt-2 font-mono">IN: {skill.inputContract}</p><p className="mt-1 font-mono">OUT: {skill.outputContract}</p></details>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
