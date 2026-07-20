import type { RepositoryRef } from "@/types/software-engineering";
import { getGitHubAuthorization } from "@/lib/github-app-auth";

type GitHubRepository = { default_branch: string; description?: string | null; language?: string | null; html_url: string };
type GitHubTree = { truncated?: boolean; tree?: Array<{ path: string; type: "blob" | "tree" }> };
export type RepositoryInspection = { metadata: GitHubRepository; branch: string; files: string[]; truncated: boolean; packageJson?: Record<string, unknown> };
export type RepositoryFile = { path: string; content: string; truncated: boolean };
export type RepositoryIssue = { number: number; title: string; body: string; state: string; htmlUrl: string; labels: string[] };
export type RepositoryPullRequestFile = { path: string; status: string; additions: number; deletions: number; changes: number; patch: string; blobUrl: string };
export type RepositoryPullRequest = { number: number; title: string; body: string; state: string; htmlUrl: string; author: string; baseBranch: string; headBranch: string; baseSha: string; headSha: string; additions: number; deletions: number; changedFiles: number; files: RepositoryPullRequestFile[] };

async function githubFetch<T>(path: string) {
  const authorization = await getGitHubAuthorization();
  const response = await fetch(`https://api.github.com${path}`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "AgentOS-Code-Understanding", ...(authorization ? { Authorization: authorization } : {}) }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(response.status === 404 ? "仓库不存在、不是公开仓库，或 GitHub 不允许访问。" : `GitHub API 请求失败（${response.status}）。`);
  return response.json() as Promise<T>;
}

export async function inspectPublicRepository(repository: RepositoryRef, requestedRef?: string): Promise<RepositoryInspection> {
  const prefix = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
  const metadata = await githubFetch<GitHubRepository>(prefix);
  const branch = requestedRef?.trim() || metadata.default_branch || repository.defaultBranch;
  const tree = await githubFetch<GitHubTree>(`${prefix}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  let packageJson: Record<string, unknown> | undefined;
  try {
    const file = await githubFetch<{ content?: string; encoding?: string }>(`${prefix}/contents/package.json?ref=${encodeURIComponent(branch)}`);
    if (file.encoding === "base64" && file.content) packageJson = JSON.parse(Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8")) as Record<string, unknown>;
  } catch { /* package.json is optional */ }
  return { metadata, branch, files: (tree.tree ?? []).filter((item) => item.type === "blob").map((item) => item.path), truncated: Boolean(tree.truncated), packageJson };
}

export async function readPublicRepositoryFiles(repository: RepositoryRef, paths: string[]): Promise<RepositoryFile[]> {
  const uniquePaths = [...new Set(paths)].filter((item) => item && !item.startsWith("/")).slice(0, 10);
  const prefix = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/contents`;
  const files: RepositoryFile[] = [];
  const failures: string[] = [];
  for (const filePath of uniquePaths) {
    try {
      const file = await githubFetch<{ content?: string; encoding?: string; size?: number }>(`${prefix}/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(repository.defaultBranch)}`);
      if (file.encoding !== "base64" || !file.content) throw new Error(`GitHub 未返回可读取的文本文件：${filePath}`);
      const raw = Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8");
      const limit = 16_000;
      files.push({ path: filePath, content: raw.slice(0, limit), truncated: raw.length > limit || (file.size ?? 0) > limit });
    } catch (error) {
      failures.push(`${filePath}: ${error instanceof Error ? error.message : "读取失败"}`);
    }
  }
  if (!files.length && failures.length) throw new Error(`候选文件全部读取失败：${failures.join("；")}`);
  return files;
}

export async function readPublicRepositoryIssue(repository: RepositoryRef, issueNumber: number): Promise<RepositoryIssue> {
  const issue = await githubFetch<{ number: number; title: string; body?: string | null; state: string; html_url: string; labels?: Array<string | { name?: string }> }>(`/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues/${issueNumber}`);
  return { number: issue.number, title: issue.title, body: issue.body ?? "", state: issue.state, htmlUrl: issue.html_url, labels: (issue.labels ?? []).map((label) => typeof label === "string" ? label : label.name ?? "").filter(Boolean) };
}

export async function readPublicRepositoryPullRequest(repository: RepositoryRef, pullRequestNumber: number): Promise<RepositoryPullRequest> {
  const prefix = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
  const pullRequest = await githubFetch<{ number: number; title: string; body?: string | null; state: string; html_url: string; user?: { login?: string }; base: { ref: string; sha: string }; head: { ref: string; sha: string }; additions: number; deletions: number; changed_files: number }>(`${prefix}/pulls/${pullRequestNumber}`);
  const changedFiles = await githubFetch<Array<{ filename: string; status: string; additions: number; deletions: number; changes: number; patch?: string; blob_url: string }>>(`${prefix}/pulls/${pullRequestNumber}/files?per_page=100`);
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    body: pullRequest.body ?? "",
    state: pullRequest.state,
    htmlUrl: pullRequest.html_url,
    author: pullRequest.user?.login ?? "unknown",
    baseBranch: pullRequest.base.ref,
    headBranch: pullRequest.head.ref,
    baseSha: pullRequest.base.sha,
    headSha: pullRequest.head.sha,
    additions: pullRequest.additions,
    deletions: pullRequest.deletions,
    changedFiles: pullRequest.changed_files,
    files: changedFiles.slice(0, 30).map((file) => ({ path: file.filename, status: file.status, additions: file.additions, deletions: file.deletions, changes: file.changes, patch: (file.patch ?? "").slice(0, 20_000), blobUrl: file.blob_url })),
  };
}
