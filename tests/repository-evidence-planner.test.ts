import assert from "node:assert/strict";
import test from "node:test";
import { selectImportExpansion, selectInitialEvidence } from "../src/lib/repository-evidence-planner";

test("planner starts with entry files and follows local imports within budget", () => {
  const repositoryFiles = ["src/app/page.tsx", "src/lib/service.ts", "src/lib/store.ts", "package.json"];
  assert.deepEqual(selectInitialEvidence(repositoryFiles, 2), ["src/app/page.tsx", "package.json"]);
  const expansion = selectImportExpansion(repositoryFiles, [{ path: "src/app/page.tsx", content: "import { run } from '@/lib/service';" }], 2);
  assert.deepEqual(expansion, ["src/lib/service.ts"]);
});
