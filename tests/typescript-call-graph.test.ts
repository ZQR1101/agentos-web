import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTypeScriptCallGraph } from "../src/lib/typescript-call-graph";

test("TypeScript AST analyzer returns function call edges with lines", () => {
  const graph = analyzeTypeScriptCallGraph([{ path: "src/service.ts", content: "function fetchUser() { return loadUser(); }\nfunction loadUser() { return 1; }" }]);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges[0]?.to, "loadUser");
  assert.equal(graph.edges[0]?.line, 1);
});

test("TypeScript AST analyzer resolves named imports across files", () => {
  const graph = analyzeTypeScriptCallGraph([
    { path: "src/app/page.ts", content: "import { loadUser } from '../lib/users';\nexport function page() { return loadUser(); }" },
    { path: "src/lib/users.ts", content: "export function loadUser() { return 1; }" },
  ]);
  const edge = graph.edges.find((item) => item.to === "loadUser");
  assert.equal(edge?.targetFile, "src/lib/users.ts");
  assert.equal(edge?.targetLine, 1);
  assert.ok(edge?.targetId?.startsWith("src/lib/users.ts:loadUser"));
});
