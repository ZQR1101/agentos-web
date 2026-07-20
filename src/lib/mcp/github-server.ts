import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { inspectPublicRepository, readPublicRepositoryFiles, readPublicRepositoryIssue, readPublicRepositoryPullRequest, type RepositoryFile, type RepositoryInspection, type RepositoryIssue, type RepositoryPullRequest } from "@/lib/github-repository-tool";

export const GITHUB_MCP_SERVER = { name: "agentos-github", version: "1.0.0", toolName: "get_repository_overview" } as const;
export const repositoryOverviewSchema = z.object({
  metadata: z.object({ default_branch: z.string(), description: z.string().nullable().optional(), language: z.string().nullable().optional(), html_url: z.string().url() }),
  branch: z.string(), files: z.array(z.string()), truncated: z.boolean(), packageJson: z.record(z.string(), z.unknown()).optional(),
});
export const repositoryFilesSchema = z.object({ files: z.array(z.object({ path: z.string(), content: z.string(), truncated: z.boolean() })) });
export const repositoryIssueSchema = z.object({ number: z.number().int().positive(), title: z.string(), body: z.string(), state: z.string(), htmlUrl: z.string().url(), labels: z.array(z.string()) });
export const repositoryPullRequestSchema = z.object({
  number: z.number().int().positive(), title: z.string(), body: z.string(), state: z.string(), htmlUrl: z.string().url(), author: z.string(), baseBranch: z.string(), headBranch: z.string(), baseSha: z.string(), headSha: z.string(), additions: z.number().int().nonnegative(), deletions: z.number().int().nonnegative(), changedFiles: z.number().int().nonnegative(),
  files: z.array(z.object({ path: z.string(), status: z.string(), additions: z.number().int().nonnegative(), deletions: z.number().int().nonnegative(), changes: z.number().int().nonnegative(), patch: z.string(), blobUrl: z.string().url() })),
});

export type RepositoryInspector = (input: { owner: string; name: string; defaultBranch: string }) => Promise<RepositoryInspection>;
export type RepositoryFileReader = (input: { owner: string; name: string; defaultBranch: string }, paths: string[]) => Promise<RepositoryFile[]>;
export type RepositoryIssueReader = (input: { owner: string; name: string; defaultBranch: string }, issueNumber: number) => Promise<RepositoryIssue>;
export type RepositoryPullRequestReader = (input: { owner: string; name: string; defaultBranch: string }, pullRequestNumber: number) => Promise<RepositoryPullRequest>;

const defaultInspector: RepositoryInspector = (input) => inspectPublicRepository({ provider: "github", ...input });
const defaultFileReader: RepositoryFileReader = (input, paths) => readPublicRepositoryFiles({ provider: "github", ...input }, paths);
const defaultIssueReader: RepositoryIssueReader = (input, issueNumber) => readPublicRepositoryIssue({ provider: "github", ...input }, issueNumber);
const defaultPullRequestReader: RepositoryPullRequestReader = (input, pullRequestNumber) => readPublicRepositoryPullRequest({ provider: "github", ...input }, pullRequestNumber);

export function createGitHubMcpServer(inspector: RepositoryInspector = defaultInspector, fileReader: RepositoryFileReader = defaultFileReader, issueReader: RepositoryIssueReader = defaultIssueReader, pullRequestReader: RepositoryPullRequestReader = defaultPullRequestReader) {
  const server = new McpServer({ name: GITHUB_MCP_SERVER.name, version: GITHUB_MCP_SERVER.version }, { instructions: "先发现工具，再使用只读 GitHub 仓库概览工具。禁止写入仓库。" });
  server.registerTool(GITHUB_MCP_SERVER.toolName, {
    title: "Get repository overview", description: "读取公开 GitHub 仓库元数据、递归文件树和 package.json；不修改外部状态。",
    inputSchema: { owner: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(100), defaultBranch: z.string().trim().min(1).max(100).default("main") },
    outputSchema: repositoryOverviewSchema.shape,
    annotations: { title: "GitHub Repository Overview", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (input) => {
    try {
      const output = repositoryOverviewSchema.parse(await inspector(input));
      return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "GitHub MCP 调用失败。" }] };
    }
  });
  server.registerTool("get_repository_files", {
    title: "Get repository files", description: "读取指定的公开仓库文本文件，单次最多 10 个；返回内容会在服务端截断。",
    inputSchema: { owner: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(100), defaultBranch: z.string().trim().min(1).max(100).default("main"), paths: z.array(z.string().trim().min(1).max(300)).min(1).max(10) },
    outputSchema: repositoryFilesSchema.shape,
    annotations: { title: "GitHub Repository Files", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ paths, ...repository }) => {
    try {
      const output = repositoryFilesSchema.parse({ files: await fileReader(repository, paths) });
      return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "GitHub MCP 文件读取失败。" }] };
    }
  });
  server.registerTool("get_issue", {
    title: "Get GitHub issue", description: "读取指定仓库的 GitHub Issue 标题、正文、状态与标签；不读取或修改其他资源。",
    inputSchema: { owner: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(100), defaultBranch: z.string().trim().min(1).max(100).default("main"), issueNumber: z.number().int().positive() },
    outputSchema: repositoryIssueSchema.shape,
    annotations: { title: "GitHub Issue", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ issueNumber, ...repository }) => {
    try {
      const output = repositoryIssueSchema.parse(await issueReader(repository, issueNumber));
      return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "GitHub Issue 读取失败。" }] };
    }
  });
  server.registerTool("get_pull_request", {
    title: "Get GitHub pull request", description: "读取指定 PR 的元数据和受限 diff；不提交评论、不批准 PR，也不修改代码。",
    inputSchema: { owner: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(100), defaultBranch: z.string().trim().min(1).max(100).default("main"), pullRequestNumber: z.number().int().positive() },
    outputSchema: repositoryPullRequestSchema.shape,
    annotations: { title: "GitHub Pull Request", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ pullRequestNumber, ...repository }) => {
    try {
      const output = repositoryPullRequestSchema.parse(await pullRequestReader(repository, pullRequestNumber));
      return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "GitHub PR 读取失败。" }] };
    }
  });
  return server;
}
