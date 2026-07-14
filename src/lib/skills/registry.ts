import { researchReportSkill } from "@/lib/skills/research-report";
import { sourceReviewSkill } from "@/lib/skills/source-review";
import type { SkillDefinition } from "@/lib/skills/types";

export const skillRegistry: readonly SkillDefinition[] = [
  researchReportSkill.definition,
  sourceReviewSkill.definition,
];

export function getSkillDefinition(id: string) {
  return skillRegistry.find((skill) => skill.id === id);
}
