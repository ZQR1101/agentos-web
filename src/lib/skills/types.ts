export interface SkillDefinition {
  id: string;
  version: string;
  name: string;
  description: string;
  runtime: "model" | "deterministic";
  tools: readonly string[];
  steps: readonly string[];
  inputContract: string;
  outputContract: string;
}
