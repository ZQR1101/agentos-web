"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const menus = [
  { name: "任务工作台", path: "/chat", icon: "◉" },
  { name: "运行记录", path: "/runs", icon: "▤" },
  { name: "工作流", path: "/workflow", icon: "⌘" },
  { name: "Agents", path: "/agents", icon: "◌" },
  { name: "Skills", path: "/skills", icon: "✦" },
  { name: "工具权限", path: "/tools", icon: "⊞" },
  { name: "MCP 连接", path: "/mcp", icon: "↗" },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <>
    <div className="sticky top-0 z-20 w-full border-b border-slate-200 bg-white lg:hidden">
      <div className="flex items-center gap-2 px-4 py-3"><span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-600 text-sm font-bold text-white">A</span><span className="font-semibold tracking-tight">AgentOS</span><span className="ml-auto text-xs text-slate-400">Controlled runtime</span></div>
      <nav className="flex gap-1 overflow-x-auto px-2 pb-2">
        {menus.map((menu) => <Link key={menu.path} href={menu.path} className={`shrink-0 rounded-lg px-3 py-2 text-xs ${pathname === menu.path ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600"}`}>{menu.icon} {menu.name}</Link>)}
      </nav>
    </div>
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-5 lg:flex">
      <Link href="/chat" className="mb-9 px-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 font-bold text-white">A</span>
          <span className="font-semibold tracking-tight">AgentOS</span>
        </div>
        <p className="mt-2 text-xs text-slate-500">Controlled agent runtime</p>
      </Link>
      <nav className="space-y-1">
        {menus.map((menu) => {
          const active = pathname === menu.path;
          return <Link key={menu.path} href={menu.path} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${active ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600 hover:bg-slate-50"}`}>
            <span className="w-4 text-center">{menu.icon}</span>{menu.name}
          </Link>;
        })}
      </nav>
      <div className="mt-auto rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
        <p className="font-medium text-slate-700">受控执行模式</p>
        <p className="mt-1 leading-5">外部模型与工具调用需审批，密钥仅在服务端使用。</p>
      </div>
    </aside>
    </>
  );
}
