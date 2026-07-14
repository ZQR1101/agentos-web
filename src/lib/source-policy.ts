import type { EvidenceCoverage, ResearchSource, SourceCredibility, SourceFreshness, SourceRiskLevel, SourceType } from "@/types/task";

export type RawResearchSource = Pick<ResearchSource, "title" | "url" | "content"> & { publishedDate?: string };

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

const standardsDomains = ["iso.org", "ieee.org", "w3.org", "ietf.org", "cisa.gov"];
const researchDomains = ["arxiv.org", "acm.org", "nature.com", "science.org", "springer.com", "openreview.net"];
const newsDomains = ["reuters.com", "apnews.com", "bbc.com", "nytimes.com", "ft.com", "theverge.com"];
const communityDomains = ["github.com", "stackoverflow.com", "reddit.com", "medium.com"];

export const MAX_SOURCES_PER_DOMAIN = 2;

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

function classifySource(domain: string): SourceType {
  if (/\.(gov|edu)$/.test(domain)) return "government";
  if (standardsDomains.some((candidate) => domainMatches(domain, candidate))) return "standards";
  if (researchDomains.some((candidate) => domainMatches(domain, candidate))) return "research";
  if (newsDomains.some((candidate) => domainMatches(domain, candidate))) return "news";
  if (communityDomains.some((candidate) => domainMatches(domain, candidate))) return "community";
  if (authoritativeDomains.some((candidate) => domainMatches(domain, candidate))) return "government";
  if (/\b(aws|azure|cloud|openai|anthropic|microsoft|google|ibm|oracle|salesforce)\b/.test(domain)) return "vendor";
  return "other";
}

function parsePublishedDate(source: RawResearchSource) {
  const candidate = source.publishedDate ?? `${source.url} ${source.content}`.match(/\b(20\d{2})[-\/.](0?[1-9]|1[0-2])[-\/.]([0-2]?\d|3[01])\b/)?.[0];
  if (!candidate) return undefined;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function assessFreshness(publishedDate: string | undefined): SourceFreshness {
  if (!publishedDate) return "unknown";
  const ageDays = Math.floor((Date.now() - new Date(publishedDate).getTime()) / 86_400_000);
  if (ageDays < 0 || ageDays <= 180) return "current";
  if (ageDays <= 730) return "recent";
  return "aging";
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
  const sourceType = classifySource(domain);
  const publishedDate = parsePublishedDate(source);
  const freshness = assessFreshness(publishedDate);
  const qualityReasons: string[] = [];

  let qualityScore = 50;
  if (parsed.protocol === "https:") { qualityScore += 10; qualityReasons.push("HTTPS 传输"); }
  if (/\.(gov|edu)$/.test(domain)) { qualityScore += 15; qualityReasons.push("政府或教育域名"); }
  if (authoritativeDomains.some((candidate) => domainMatches(domain, candidate))) { qualityScore += 15; qualityReasons.push("权威机构域名"); }
  if (sourceType === "standards" || sourceType === "research") { qualityScore += 10; qualityReasons.push(`${sourceType === "standards" ? "标准组织" : "研究出版物"}来源`); }
  if (content.length >= 300) { qualityScore += 10; qualityReasons.push("摘要信息充足"); }
  if (content.length >= 900) { qualityScore += 5; qualityReasons.push("摘要信息详细"); }
  if (freshness === "current") { qualityScore += 5; qualityReasons.push("发布时间在 180 天内"); }
  if (freshness === "aging") { qualityScore -= 5; qualityReasons.push("发布时间超过两年"); }
  qualityScore -= riskReasons.length * 25;
  if (riskReasons.length) qualityReasons.push(...riskReasons);
  const credibility: SourceCredibility = sourceType === "government" || sourceType === "standards" || sourceType === "research"
    ? "high"
    : sourceType === "vendor" || sourceType === "news" || sourceType === "community" ? "medium" : "low";

  return {
    title: sanitizeContent(source.title).slice(0, 240),
    url: parsed.toString(),
    content,
    domain,
    qualityScore: Math.max(0, Math.min(100, qualityScore)),
    riskLevel,
    riskReasons,
    sourceType,
    credibility,
    freshness,
    publishedDate,
    qualityReasons,
  };
}

export function analyzeEvidenceCoverage(sources: ResearchSource[], subquestions: string[], citedSourceCount?: number): EvidenceCoverage {
  const targetSourceCount = Math.max(1, Math.min(3, subquestions.length || 3));
  const highCredibilitySourceCount = sources.filter((source) => source.credibility === "high").length;
  const recentSourceCount = sources.filter((source) => source.freshness === "current" || source.freshness === "recent").length;
  const sourceTypeDiversity = new Set(sources.map((source) => source.sourceType ?? "other")).size;
  const breadth = Math.min(1, sources.length / targetSourceCount);
  const credibility = Math.min(1, highCredibilitySourceCount / Math.min(2, targetSourceCount));
  const diversity = Math.min(1, sourceTypeDiversity / Math.min(3, targetSourceCount));
  const freshness = sources.length ? recentSourceCount / sources.length : 0;
  const citation = citedSourceCount === undefined ? 1 : Math.min(1, citedSourceCount / Math.min(2, sources.length));
  const score = Math.round((breadth * 35 + credibility * 25 + diversity * 20 + freshness * 10 + citation * 10));
  const notes = [
    `来源广度 ${sources.length}/${targetSourceCount}`,
    `高可信来源 ${highCredibilitySourceCount}`,
    `来源类型 ${sourceTypeDiversity} 类`,
    `可判定近期来源 ${recentSourceCount}`,
    citedSourceCount === undefined ? "引用覆盖将在报告生成后结算" : `有效引用来源 ${citedSourceCount}/${Math.min(2, sources.length)}`,
    "该分数衡量来源组合的广度与元数据，不替代逐句事实核验。",
  ];
  return { method: "source-breadth-heuristic", score, sourceCount: sources.length, targetSourceCount, sourceTypeDiversity, highCredibilitySourceCount, recentSourceCount, citedSourceCount, requiredCitedSourceCount: citedSourceCount === undefined ? undefined : Math.min(2, sources.length), notes };
}

export function screenSources(rawSources: RawResearchSource[], limit = 6) {
  const seen = new Set<string>();
  const assessed: ResearchSource[] = [];
  let rejectedCount = 0;
  let deduplicatedCount = 0;
  for (const source of rawSources) {
    const result = assessSource(source);
    if (!result) {
      rejectedCount += 1;
      continue;
    }
    if (seen.has(result.url)) {
      deduplicatedCount += 1;
      continue;
    }
    seen.add(result.url);
    assessed.push(result);
  }
  const eligible = assessed.filter((source) => source.riskLevel !== "high" && source.qualityScore >= 35);
  rejectedCount += assessed.length - eligible.length;
  const domainCounts = new Map<string, number>();
  let diversityExcludedCount = 0;
  const diverseSources = eligible
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .filter((source) => {
      const current = domainCounts.get(source.domain) ?? 0;
      if (current >= MAX_SOURCES_PER_DOMAIN) {
        diversityExcludedCount += 1;
        return false;
      }
      domainCounts.set(source.domain, current + 1);
      return true;
    });
  const maxSources = Math.max(1, Math.min(10, limit));
  const sources = diverseSources.slice(0, maxSources);
  return {
    sources,
    rejectedCount,
    deduplicatedCount,
    diversityExcludedCount,
    truncatedCount: Math.max(0, diverseSources.length - sources.length),
  };
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
