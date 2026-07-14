import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createResearchMcpServer,
  RESEARCH_MCP_SERVER,
  searchResultSchema,
  type SearchProvider,
  type SearchRetryOptions,
} from "@/lib/mcp/research-server";
import type { McpCallTrace } from "@/types/task";

async function connectResearchMcp(searchProvider?: SearchProvider, retryOptions?: SearchRetryOptions) {
  const server = createResearchMcpServer(searchProvider, retryOptions);
  const client = new Client({ name: "agentos-harness", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

async function closeConnection(connection: Awaited<ReturnType<typeof connectResearchMcp>>) {
  await Promise.allSettled([connection.client.close(), connection.server.close()]);
}

export async function inspectResearchMcp() {
  const connection = await connectResearchMcp(async () => []);
  try {
    const discovered = await connection.client.listTools();
    return {
      server: connection.client.getServerVersion(),
      instructions: connection.client.getInstructions(),
      tools: discovered.tools,
      transport: "in-memory" as const,
    };
  } finally {
    await closeConnection(connection);
  }
}

export async function searchWithResearchMcp(
  query: string,
  maxResults = 6,
  searchProvider?: SearchProvider,
  retryOptions?: SearchRetryOptions,
) {
  const connection = await connectResearchMcp(searchProvider, retryOptions);
  try {
    const discovered = await connection.client.listTools();
    const tool = discovered.tools.find((candidate) => candidate.name === RESEARCH_MCP_SERVER.toolName);
    if (!tool) throw new Error("Research MCP 未暴露 search_web 工具。");

    const result = await connection.client.callTool({
      name: tool.name,
      arguments: { query, maxResults },
    });
    if (result.isError) {
      const content = Array.isArray(result.content) ? result.content : [];
      const message = content.find((item): item is { type: "text"; text: string } => (
        typeof item === "object" && item !== null && "type" in item && item.type === "text" && "text" in item && typeof item.text === "string"
      ))?.text;
      throw new Error(message ?? "MCP 工具调用失败。");
    }
    const output = searchResultSchema.parse(result.structuredContent);
    const serverInfo = connection.client.getServerVersion();
    const trace: McpCallTrace = {
      serverName: serverInfo?.name ?? RESEARCH_MCP_SERVER.name,
      serverVersion: serverInfo?.version ?? RESEARCH_MCP_SERVER.version,
      toolName: tool.name,
      transport: "in-memory",
      discoveredTools: discovered.tools.map((item) => item.name),
    };
    return { ...output, trace };
  } finally {
    await closeConnection(connection);
  }
}
