import { screenSources, validateReportCitations, type RawResearchSource } from "@/lib/source-policy";
import type { ResearchSource } from "@/types/task";
import type { SkillDefinition } from "@/lib/skills/types";

const definition: SkillDefinition = {
  id: "source-review",
  version: "1.0.0",
  name: "Source Review",
  description: "在外部内容进入模型前筛除高风险来源，并确定性校验报告引用。",
  runtime: "deterministic",
  tools: [],
  steps: ["Validate URL", "Sanitize", "Score risk", "Validate citations"],
  inputContract: "RawResearchSource[] | (report, ResearchSource[])",
  outputContract: "screened sources | CitationCheck",
};

export const sourceReviewSkill = {
  definition,
  reviewSources(rawSources: RawResearchSource[], limit = 6) {
    return screenSources(rawSources, limit);
  },
  reviewCitations(report: string, sources: ResearchSource[]) {
    return validateReportCitations(report, sources);
  },
};
