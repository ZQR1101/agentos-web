"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const menus = [
  { name: "工程任务", path: "/engineering", icon: "◆" },
  { name: "质量评估", path: "/evaluations", icon: "◎" },
  { name: "工作流", path: "/workflow", icon: "⌘" },
  { name: "Agents", path: "/agents", icon: "◌" },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <>
    <div className="sticky top-0 z-20 w-full border-b border-slate-200 bg-white lg:hidden">
      <div className="flex items-center gap-2 px-4 py-3"><span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-600 text-sm font-bold text-white">A</span><span className="font-semibold tracking-tight">AgentOS</span><span className="ml-auto text-xs text-slate-400">Control plane</span></div>
      <nav className="flex gap-1 overflow-x-auto px-2 pb-2">
        {menus.map((menu) => <Link key={menu.path} href={menu.path} className={`shrink-0 rounded-lg px-3 py-2 text-xs ${pathname === menu.path ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600"}`}>{menu.icon} {menu.name}</Link>)}
      </nav>
    </div>
    <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-6 lg:flex">
      <Link href="/engineering" className="mb-9 px-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-600 font-bold text-white">A</span>
          <div><span className="font-semibold tracking-tight">AgentOS</span><p className="text-[10px] uppercase tracking-[.18em] text-slate-400">control plane</p></div>
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-500">A controlled runtime for trustworthy software analysis.</p>
      </Link>
      <nav className="space-y-1">
        {menus.map((menu) => {
          const active = pathname === menu.path || pathname.startsWith(`${menu.path}/`);
          return <Link key={menu.path} href={menu.path} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${active ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600 hover:bg-slate-50"}`}>
            <span className="w-4 text-center">{menu.icon}</span>{menu.name}
          </Link>;
        })}
      </nav>
      <div className="mt-auto rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
        <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399]" /><p className="font-medium text-slate-700">受控执行模式</p></div>
        <p className="mt-2 leading-5">GitHub 工具调用需审批，V1 只授予仓库读取权限。</p>
      </div>
    </aside>
    </>
  );
}
