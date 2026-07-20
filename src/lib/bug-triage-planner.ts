const stopWords = new Set(["this", "that", "with", "from", "when", "then", "have", "user", "issue", "please", "help", "unable", "cannot", "does", "not", "the", "and", "for"]);
const sourceFilePattern = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|cs)$/;
type SearchTerm = { value: string; weight: number; direct: boolean };
type BugEvidence = { file: string; line: number; text: string; matchedTerms: string[] };

const conceptAliases: Array<{ pattern: RegExp; terms: string[] }> = [
  { pattern: /工程任务|任务列表|engineering\s+tasks?|task\s+list/i, terms: ["engineering", "task", "tasks", "list"] },
  { pattern: /加载|读取|获取|load|fetch|read/i, terms: ["load", "fetch", "read", "get", "list"] },
  { pattern: /数据库|数据存储|database|postgres|pgsql/i, terms: ["database", "postgres", "store", "pool", "query"] },
  { pattern: /接口|请求|响应|api|request|response/i, terms: ["api", "route", "request", "response"] },
  { pattern: /失败|报错|异常|错误|fail|error|exception/i, terms: ["error", "fail", "failed", "throw", "catch"] },
  { pattern: /登录|认证|鉴权|login|auth/i, terms: ["login", "auth", "token", "session", "middleware"] },
  { pattern: /权限|审批|permission|approval/i, terms: ["permission", "approval", "policy", "scope"] },
  { pattern: /队列|任务执行|worker|queue/i, terms: ["worker", "queue", "claim", "lease", "runtime"] },
  { pattern: /webhook|回调/i, terms: ["webhook", "delivery", "signature"] },
  { pattern: /页面|界面|组件|page|component|ui/i, terms: ["page", "component", "client", "render"] },
];

function searchTerms(text: string) {
  const direct = (text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? [])
    .filter((term) => term.length >= 3 && !stopWords.has(term))
    .map((value): SearchTerm => ({ value, weight: value.length >= 6 ? 5 : 4, direct: true }));
  const aliases = conceptAliases
    .filter((concept) => concept.pattern.test(text))
    .flatMap((concept) => concept.terms.map((value): SearchTerm => ({ value, weight: 2, direct: false })));
  const merged = new Map<string, SearchTerm>();
  for (const term of [...direct, ...aliases]) {
    const current = merged.get(term.value);
    if (!current || term.weight > current.weight) merged.set(term.value, term);
  }
  return [...merged.values()].slice(0, 32);
}

export function extractBugTerms(text: string) {
  return searchTerms(text).map((term) => term.value).slice(0, 20);
}

export function selectBugEvidenceFiles(files: string[], issueText: string, limit = 10) {
  const terms = searchTerms(issueText);
  return files.filter((file) => sourceFilePattern.test(file)).map((file) => {
    const lower = file.toLowerCase();
    const termScore = terms.reduce((score, term) => score + (lower.includes(term.value) ? term.weight * 3 : 0), 0);
    const roleScore = /(^|\/)(api|routes?|services?|stores?|repositories|workers?|components?|pages?)(\/|\.|$)/.test(lower) ? 3 : 0;
    const sourceScore = /(^|\/)src\//.test(lower) ? 2 : 0;
    const testPenalty = /(^|\/)(test|tests|__tests__)(\/|\.)/.test(lower) ? 2 : 0;
    return { file, score: termScore + roleScore + sourceScore - testPenalty };
  }).sort((a, b) => b.score - a.score || a.file.split("/").length - b.file.split("/").length || a.file.localeCompare(b.file)).slice(0, limit).map((item) => item.file);
}

export function extractBugEvidence(files: Array<{ path: string; content: string }>, issueText: string, limit = 24) {
  const terms = searchTerms(issueText);
  const evidence: Array<{ file: string; line: number; text: string; matchedTerms: string[]; score: number }> = [];
  for (const file of files) file.content.split(/\r?\n/).forEach((line, index) => {
    const lower = line.toLowerCase();
    const matched = terms.filter((term) => lower.includes(term.value));
    const meaningfulMatch = matched.some((term) => term.direct || term.weight >= 3) || matched.length >= 2;
    if (!meaningfulMatch || !line.trim()) return;
    const signalScore = /\b(await|throw|catch|fetch|query|request|response)\b|\.status\s*\(/.test(lower) ? 3 : 0;
    evidence.push({ file: file.path, line: index + 1, text: line.trim().slice(0, 220), matchedTerms: matched.map((term) => term.value), score: matched.reduce((sum, term) => sum + term.weight, 0) + signalScore });
  });
  return evidence.sort((a, b) => b.score - a.score || b.matchedTerms.length - a.matchedTerms.length || a.file.localeCompare(b.file) || a.line - b.line).slice(0, limit).map((item) => ({ file: item.file, line: item.line, text: item.text, matchedTerms: item.matchedTerms }));
}

export function assessBugEvidenceCoverage(issueText: string, evidence: BugEvidence[]) {
  const anchorGroups = [
    { pattern: /工程任务|engineering\s+tasks?/i, terms: ["engineering"] },
    { pattern: /登录|认证|鉴权|login|authentication/i, terms: ["login", "auth", "authentication"] },
    { pattern: /权限|审批|permission|approval/i, terms: ["permission", "approval"] },
    { pattern: /队列|worker|queue/i, terms: ["worker", "queue"] },
  ];
  const requiredAnchors = anchorGroups.find((group) => group.pattern.test(issueText))?.terms ?? [];
  const matched = new Set(evidence.flatMap((item) => item.matchedTerms));
  const matchedAnchors = requiredAnchors.filter((term) => matched.has(term));
  const status = !evidence.length ? "no_evidence" : requiredAnchors.length && !matchedAnchors.length ? "context_mismatch" : "matched";
  return { status, requiredAnchors, matchedAnchors } as const;
}

export function inferBugHypotheses(files: Array<{ path: string; content: string }>, issueText: string) {
  const terms = searchTerms(issueText).filter((term) => term.direct).map((term) => term.value);
  const findings: Array<{ file: string; line: number; terminatorLine: number; skippedLine: number; text: string; score: number }> = [];

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const condition = lines[index].match(/^\s*(?:else\s+)?if\s*\((.+)\)\s*\{?\s*$/);
      if (!condition) continue;
      const conditionTerms = terms.filter((term) => condition[1].toLowerCase().includes(term));
      if (!conditionTerms.length) continue;

      const terminatorOffset = lines.slice(index + 1, index + 51).findIndex((line) => /^\s*(?:break|return(?:\s+[^;]+)?)\s*;/.test(line));
      if (terminatorOffset < 0) continue;
      const terminatorIndex = index + 1 + terminatorOffset;
      const laterConditionOffset = lines.slice(terminatorIndex + 1, terminatorIndex + 31).findIndex((line) => {
        const lower = line.toLowerCase();
        return /^\s*(?:else\s+)?if\s*\(/.test(line) && terms.some((term) => !conditionTerms.includes(term) && lower.includes(term));
      });
      if (laterConditionOffset < 0) continue;

      const laterIndex = terminatorIndex + 1 + laterConditionOffset;
      const laterExpression = lines[laterIndex].match(/^\s*(?:else\s+)?if\s*\((.+)\)\s*\{?\s*$/)?.[1].trim() ?? lines[laterIndex].trim();
      const laterTerms = terms.filter((term) => laterExpression.toLowerCase().includes(term) && !conditionTerms.includes(term));
      findings.push({
        file: file.path,
        line: index + 1,
        terminatorLine: terminatorIndex + 1,
        skippedLine: laterIndex + 1,
        text: `\`${file.path}:${index + 1}\` 的 \`${condition[1].trim()}\` 分支在第 ${terminatorIndex + 1} 行提前结束，因此同一输入还需要命中第 ${laterIndex + 1} 行的 \`${laterExpression}\` 时，后续规则不会执行。`,
        score: [...conditionTerms, ...laterTerms].reduce((sum, term) => sum + term.length, 0),
      });
    }
  }

  const ranked = findings.sort((a, b) => b.score - a.score);
  const threshold = (ranked[0]?.score ?? 0) * 0.7;
  return ranked.filter((finding) => finding.score >= threshold).slice(0, 3).map((finding) => ({ file: finding.file, line: finding.line, terminatorLine: finding.terminatorLine, skippedLine: finding.skippedLine, text: finding.text }));
}
