import type { EngineeringPlan, EngineeringStep, EngineeringTaskInput, SoftwareAgentUseCase } from "@/types/software-engineering";

const baseSteps: readonly EngineeringStep[] = [
  { id: "intake", agent: "Coordinator", title: "理解任务", description: "校验问题范围并绑定仓库、Issue 或 PR 上下文。", toolScopes: ["github:read"] },
  { id: "discover", agent: "Repository", title: "检索代码证据", description: "读取目录、搜索符号并获取相关文件与调用关系。", toolScopes: ["github:read"] },
  { id: "analyze", agent: "Planner", title: "形成分析链路", description: "从代码证据建立调用链、假设与待验证问题。", toolScopes: ["github:read"] },
];

const specializedStep: Record<SoftwareAgentUseCase, EngineeringStep> = {
  repository_analysis: { id: "specialist_review", agent: "Code Review", title: "架构复核", description: "确认入口、关键边界、依赖关系与潜在设计风险。", toolScopes: ["github:read"] },
  bug_triage: { id: "specialist_review", agent: "Bug Analyst", title: "定位故障原因", description: "比对 Issue、日志和代码路径，列出证据、根因与最小修复建议。", toolScopes: ["github:read"] },
  pull_request_review: { id: "specialist_review", agent: "Security", title: "安全与变更审查", description: "审查 PR diff 的安全影响、兼容性风险与缺失测试。", toolScopes: ["github:read"] },
};

const tailSteps: readonly EngineeringStep[] = [
  { id: "quality_review", agent: "Reviewer", title: "独立质量复核", description: "检查每项结论是否关联到明确文件、符号或 diff 证据。", toolScopes: ["github:read"] },
  { id: "report", agent: "Coordinator", title: "生成可复核报告", description: "输出调用链、风险等级、证据链接与建议；不写入仓库。", toolScopes: ["github:read"] },
];

export function createEngineeringPlan(input: EngineeringTaskInput): EngineeringPlan {
  const output = input.useCase === "repository_analysis" ? "architecture_report" : input.useCase === "bug_triage" ? "bug_analysis" : "review_report";
  return {
    repository: input.repository,
    useCase: input.useCase,
    question: input.question,
    steps: [...baseSteps, specializedStep[input.useCase], ...tailSteps],
    toolScopes: ["github:read"],
    successCriteria: ["每个结论都对应代码或 diff 证据", "风险含明确等级与理由", "建议仅作为建议，不写入仓库", "报告可由 Reviewer 独立复核"],
    output,
  };
}
