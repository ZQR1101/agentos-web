import assert from "node:assert/strict";
import cases from "./source-policy-cases.json";
import { screenSources, validateReportCitations } from "../src/lib/source-policy";

type Expected = "accepted_low" | "accepted_medium" | "rejected";

const predictions = cases.map((item) => {
  const result = screenSources([{ title: item.title, url: item.url, content: item.content }], 1);
  const predicted: Expected = result.sources.length === 0
    ? "rejected"
    : result.sources[0].riskLevel === "medium" ? "accepted_medium" : "accepted_low";
  return { id: item.id, expected: item.expected as Expected, predicted };
});

const exactMatches = predictions.filter((item) => item.expected === item.predicted).length;
const positives = predictions.filter((item) => item.expected === "rejected");
const truePositives = positives.filter((item) => item.predicted === "rejected").length;
const accepted = predictions.filter((item) => item.expected !== "rejected");
const falseRejections = accepted.filter((item) => item.predicted === "rejected").length;
const accuracy = exactMatches / predictions.length;
const rejectionRecall = truePositives / positives.length;
const benignRetention = (accepted.length - falseRejections) / accepted.length;

assert.ok(accuracy >= 0.9, `Source Policy exact accuracy below threshold: ${accuracy}`);
assert.equal(rejectionRecall, 1, "Source Policy must reject every labelled high-risk source");
assert.equal(benignRetention, 1, "Source Policy must not reject labelled usable sources");

const screened = screenSources([
  { title: "NIST source", url: "https://nist.gov/ai", content: "Trustworthy AI risk guidance ".repeat(20) },
  { title: "GitHub source", url: "https://github.com/example/agent", content: "Agent runtime engineering reference ".repeat(20) },
], 2).sources;
assert.equal(screened.length, 2);

const citationCases = [
  { name: "valid citations", report: `事实 A [来源 1](${screened[0].url})，事实 B [来源 2](${screened[1].url})。`, valid: true },
  { name: "too few citations", report: `只有一个引用 [来源 1](${screened[0].url})。`, valid: false },
  { name: "mismatched URL", report: `错误链接 [来源 1](${screened[1].url})，另一个 [来源 2](${screened[1].url})。`, valid: false },
  { name: "missing source index", report: `越界引用 [来源 3](https://example.com/missing)，以及 [来源 1](${screened[0].url})。`, valid: false },
  { name: "unauthorized external link", report: `引用 [来源 1](${screened[0].url}) 和 [来源 2](${screened[1].url})，另见 [外链](https://untrusted.example)。`, valid: false },
];

for (const item of citationCases) {
  assert.equal(validateReportCitations(item.report, screened).valid, item.valid, `Citation case failed: ${item.name}`);
}

const duplicateBatch = screenSources([
  { title: "Same source", url: "https://example.com/research", content: "Useful research content ".repeat(20) },
  { title: "Duplicate source", url: "https://example.com/research", content: "Duplicate content ".repeat(20) },
], 6);
assert.equal(duplicateBatch.sources.length, 1, "Duplicate URLs must be collapsed");

console.log("Source Policy evaluation passed");
console.table({
  cases: predictions.length,
  exactAccuracy: `${(accuracy * 100).toFixed(0)}%`,
  rejectionRecall: `${(rejectionRecall * 100).toFixed(0)}%`,
  benignRetention: `${(benignRetention * 100).toFixed(0)}%`,
  citationCases: citationCases.length,
});
