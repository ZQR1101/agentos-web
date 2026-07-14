import type { ResearchSource, SourceRiskLevel } from "@/types/task";

export type RawResearchSource = Pick<ResearchSource, "title" | "url" | "content">;

const injectionSignals = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /忽略.{0,12}(之前|以上|先前).{0,8}(指令|要求|提示)/i,
  /(system|developer)\s+prompt/i,
  /(系统|开发者)提示词/i,
  /(reveal|print|return|输出|泄露).{0,24}(api[-_ ]?key|secret|token|密钥|系统提示)/i,
  /you\s+are\s+now\s+(a|an|the)?/i,
  /现在你(是|扮演|必须)/i,
];

const authoritativeDomains = [
  "arxiv.org",
  "github.com",
  "nist.gov",
  "oecd.org",
  "who.int",
  "worldbank.org",
];

function domainMatches(domain: string, candidate: string) {
  return domain === candidate || domain.endsWith(`.${candidate}`);
}

function sanitizeContent(content: string) {
  return content
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/<\/?untrusted_source[^>]*>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1800);
}

function assessSource(source: RawResearchSource): ResearchSource | null {
  let parsed: URL;
  try {
    parsed = new URL(source.url);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;

  const domain = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const content = sanitizeContent(source.content);
  const riskReasons = injectionSignals
    .filter((pattern) => pattern.test(content))
    .map((_, index) => `命中提示注入特征 ${index + 1}`);
  const riskLevel: SourceRiskLevel = riskReasons.length >= 2 ? "high" : riskReasons.length === 1 ? "medium" : "low";

  let qualityScore = 50;
  if (parsed.protocol === "https:") qualityScore += 10;
  if (/\.(gov|edu)$/.test(domain)) qualityScore += 15;
  if (authoritativeDomains.some((candidate) => domainMatches(domain, candidate))) qualityScore += 15;
  if (content.length >= 300) qualityScore += 10;
  if (content.length >= 900) qualityScore += 5;
  qualityScore -= riskReasons.length * 25;

  return {
    title: sanitizeContent(source.title).slice(0, 240),
    url: parsed.toString(),
    content,
    domain,
    qualityScore: Math.max(0, Math.min(100, qualityScore)),
    riskLevel,
    riskReasons,
  };
}

export function screenSources(rawSources: RawResearchSource[], limit = 6) {
  const seen = new Set<string>();
  const assessed = rawSources.flatMap((source) => {
    const result = assessSource(source);
    if (!result || seen.has(result.url)) return [];
    seen.add(result.url);
    return [result];
  });
  const eligible = assessed.filter((source) => source.riskLevel !== "high" && source.qualityScore >= 35);
  const sources = eligible
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, Math.max(1, Math.min(10, limit)));
  return { sources, rejectedCount: rawSources.length - eligible.length };
}

export function validateReportCitations(report: string, sources: ResearchSource[]) {
  const issues: string[] = [];
  const citations = [...report.matchAll(/\[来源\s*(\d+)\]\((https?:\/\/[^)\s]+)\)/g)];
  const citedIndexes = new Set<number>();

  for (const citation of citations) {
    const index = Number(citation[1]) - 1;
    const expected = sources[index]?.url;
    if (!expected) {
      issues.push(`引用了不存在的来源 ${index + 1}`);
      continue;
    }
    citedIndexes.add(index);
    if (citation[2] !== expected) issues.push(`来源 ${index + 1} 的链接与检索结果不一致`);
  }

  const requiredCount = Math.min(2, sources.length);
  if (citedIndexes.size < requiredCount) issues.push(`有效引用不足：至少需要 ${requiredCount} 个不同来源`);

  const sourceUrls = new Set(sources.map((source) => source.url));
  const markdownUrls = [...report.matchAll(/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g)].map((match) => match[1]);
  if (markdownUrls.some((url) => !sourceUrls.has(url))) issues.push("报告包含未经过 Source Policy 的外部链接");

  return { valid: issues.length === 0, issues: [...new Set(issues)], citationCount: citedIndexes.size };
}
