import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCodeAnalysis } from "../src/lib/code-analysis-evaluation";
test("evaluation flags insufficient evidence", () => { assert.equal(evaluateCodeAnalysis({ evidenceFileCount: 1, importEdgeCount: 0, treeTruncated: true, hasTests: false }).verdict, "needs_review"); });
test("evaluation accepts sufficient evidence", () => { assert.equal(evaluateCodeAnalysis({ evidenceFileCount: 5, importEdgeCount: 8, treeTruncated: false, hasTests: true }).score, 100); });
