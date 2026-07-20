import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createGitHubMcpServer, GITHUB_MCP_SERVER, repositoryFilesSchema, repositoryIssueSchema, repositoryOverviewSchema, repositoryPullRequestSchema, type RepositoryFileReader, type RepositoryInspector, type RepositoryIssueReader, type RepositoryPullRequestReader } from "@/lib/mcp/github-server";
import type { RepositoryRef } from "@/types/software-engineering";
import { traceEngineeringOperation } from "@/lib/engineering-trace";

async function connect(inspector?: RepositoryInspector, fileReader?: RepositoryFileReader, issueReader?: RepositoryIssueReader, pullRequestReader?: RepositoryPullRequestReader) {
  const server = createGitHubMcpServer(inspector, fileReader, issueReader, pullRequestReader);
  const client = new Client({ name: "agentos-code-understanding", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  return { client, server };
}

function mcpError(result: unknown, fallback: string) {
  const content = typeof result === "object" && result !== null && "content" in result && Array.isArray(result.content) ? result.content : [];
  const item = content.find((candidate): candidate is { type: "text"; text: string } => typeof candidate === "object" && candidate !== null && "type" in candidate && candidate.type === "text" && "text" in candidate && typeof candidate.text === "string");
  return new Error(item?.text ?? fallback);
}

export async function inspectRepositoryWithGitHubMcp(repository: RepositoryRef, inspector?: RepositoryInspector) {
  const connection = await connect(inspector);
  try {
    const discovered = await connection.client.listTools();
    const tool = discovered.tools.find((candidate) => candidate.name === GITHUB_MCP_SERVER.toolName);
    if (!tool) throw new Error("GitHub MCP 未暴露仓库概览工具。");
    const result = await traceEngineeringOperation("tool", `github.${tool.name}`, () => connection.client.callTool({ name: tool.name, arguments: { owner: repository.owner, name: repository.name, defaultBranch: repository.defaultBranch } }), { server: GITHUB_MCP_SERVER.name, scope: "github:read" });
    if (result.isError) {
      throw mcpError(result, "GitHub MCP 工具调用失败。");
    }
    return { ...repositoryOverviewSchema.parse(result.structuredContent), trace: { server: GITHUB_MCP_SERVER.name, tool: tool.name, discoveredTools: discovered.tools.map((item) => item.name) } };
  } finally { await Promise.allSettled([connection.client.close(), connection.server.close()]); }
}

export async function readRepositoryFilesWithGitHubMcp(repository: RepositoryRef, paths: string[], fileReader?: RepositoryFileReader) {
  const connection = await connect(undefined, fileReader);
  try {
    const discovered = await connection.client.listTools();
    const tool = discovered.tools.find((candidate) => candidate.name === "get_repository_files");
    if (!tool) throw new Error("GitHub MCP 未暴露文件读取工具。");
    const result = await traceEngineeringOperation("tool", `github.${tool.name}`, () => connection.client.callTool({ name: tool.name, arguments: { owner: repository.owner, name: repository.name, defaultBranch: repository.defaultBranch, paths } }), { server: GITHUB_MCP_SERVER.name, scope: "github:read", fileCount: paths.length });
    if (result.isError) throw mcpError(result, "GitHub MCP 文件读取失败。");
    return repositoryFilesSchema.parse(result.structuredContent).files;
  } finally { await Promise.allSettled([connection.client.close(), connection.server.close()]); }
}

export async function readIssueWithGitHubMcp(repository: RepositoryRef, issueNumber: number, issueReader?: RepositoryIssueReader) {
  const connection = await connect(undefined, undefined, issueReader);
  try {
    const discovered = await connection.client.listTools();
    const tool = discovered.tools.find((candidate) => candidate.name === "get_issue");
    if (!tool) throw new Error("GitHub MCP 未暴露 Issue 读取工具。");
    const result = await traceEngineeringOperation("tool", `github.${tool.name}`, () => connection.client.callTool({ name: tool.name, arguments: { owner: repository.owner, name: repository.name, defaultBranch: repository.defaultBranch, issueNumber } }), { server: GITHUB_MCP_SERVER.name, scope: "github:read", issueNumber });
    if (result.isError) throw mcpError(result, "GitHub MCP Issue 读取失败。");
    return { ...repositoryIssueSchema.parse(result.structuredContent), trace: { server: GITHUB_MCP_SERVER.name, tool: tool.name, discoveredTools: discovered.tools.map((item) => item.name) } };
  } finally { await Promise.allSettled([connection.client.close(), connection.server.close()]); }
}

export async function readPullRequestWithGitHubMcp(repository: RepositoryRef, pullRequestNumber: number, pullRequestReader?: RepositoryPullRequestReader) {
  const connection = await connect(undefined, undefined, undefined, pullRequestReader);
  try {
    const discovered = await connection.client.listTools();
    const tool = discovered.tools.find((candidate) => candidate.name === "get_pull_request");
    if (!tool) throw new Error("GitHub MCP 未暴露 PR 读取工具。");
    const result = await traceEngineeringOperation("tool", `github.${tool.name}`, () => connection.client.callTool({ name: tool.name, arguments: { owner: repository.owner, name: repository.name, defaultBranch: repository.defaultBranch, pullRequestNumber } }), { server: GITHUB_MCP_SERVER.name, scope: "github:read", pullRequestNumber });
    if (result.isError) throw mcpError(result, "GitHub MCP PR 读取失败。");
    return { ...repositoryPullRequestSchema.parse(result.structuredContent), trace: { server: GITHUB_MCP_SERVER.name, tool: tool.name, discoveredTools: discovered.tools.map((item) => item.name) } };
  } finally { await Promise.allSettled([connection.client.close(), connection.server.close()]); }
}
