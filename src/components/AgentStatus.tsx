interface Props {
  status:
    | "idle"
    | "thinking"
    | "tool"
    | "completed";
}


export default function AgentStatus({
  status
}: Props) {


  const statusMap = {
    idle: "🟢 Ready",
    thinking: "🤔 Thinking...",
    tool: "🔧 Calling tool...",
    completed: "✅ Finished"
  };


  return (
    <div
      className="
      text-sm
      text-gray-500
      "
    >
      {statusMap[status]}
    </div>
  );
}