"use client";

import ReactFlow, { Background, Controls, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";

type Graph = { nodes: Array<{ id: string; file: string; symbol: string; line: number }>; edges: Array<{ from: string; to: string; confidence: "high" | "medium"; targetId?: string }> };

export default function CallGraph({ graph }: { graph: Graph }) {
  const visible = graph.nodes.slice(0, 24);
  const ids = new Set(visible.map((node) => node.id));
  const nodes: Node[] = visible.map((node, index) => ({ id: node.id, position: { x: (index % 3) * 245, y: Math.floor(index / 3) * 105 }, data: { label: <div><p className="font-medium text-slate-800">{node.symbol}</p><p className="mt-1 font-mono text-[10px] text-slate-500">{node.file}:{node.line}</p></div> }, style: { width: 205, borderRadius: 12, border: "1px solid rgba(71,230,194,.35)", background: "#10213a", color: "#edf4ff", padding: 10 } }));
  const edges: Edge[] = graph.edges.filter((edge) => ids.has(edge.from) && edge.targetId && ids.has(edge.targetId)).map((edge, index) => ({ id: `${edge.from}-${edge.targetId}-${index}`, source: edge.from, target: edge.targetId!, animated: edge.confidence === "high", style: { stroke: edge.confidence === "high" ? "#47e6c2" : "#6e829f" } }));
  if (!nodes.length) return <p className="mt-3 text-sm text-slate-500">未从已读取的文件中识别出可视化函数调用关系。</p>;
  return <div className="mt-5 h-[420px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50"><ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}><Background gap={18} size={1} color="#2b3e5b" /><Controls /></ReactFlow></div>;
}
