import ChatBox from "@/components/ChatBox";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ task?: string }> }) {
  const { task } = await searchParams;
  return <main className="mx-auto max-w-7xl p-6 lg:p-9"><div className="mb-7"><p className="text-sm font-medium text-indigo-600">TASK WORKBENCH</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">可控调研 Agent</h1><p className="mt-2 text-sm text-slate-500">每一次决策、工具调用、审批与复核都可追踪。</p></div><ChatBox initialTaskId={task} /></main>;
}
