import { timingSafeEqual } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createResearchMcpServer } from "@/lib/mcp/research-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status: number, headers: HeadersInit = {}) {
  return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: error }, id: null }, { status, headers });
}

function tokenMatches(request: Request, expected: string) {
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

function hostAllowed(request: Request) {
  const configured = process.env.MCP_ALLOWED_HOSTS ?? "localhost:3000,127.0.0.1:3000";
  const allowed = configured.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  return allowed.includes((request.headers.get("host") ?? "").toLowerCase());
}

async function handleMcpRequest(request: Request) {
  if (!hostAllowed(request)) return jsonError("MCP Host 不在允许列表中。", 403);
  const accessToken = process.env.MCP_ACCESS_TOKEN;
  if (!accessToken) return jsonError("远程 MCP 尚未配置访问令牌。", 503);
  if (!tokenMatches(request, accessToken)) {
    return jsonError("MCP 访问令牌无效。", 401, { "WWW-Authenticate": "Bearer" });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createResearchMcpServer();
  await server.connect(transport);
  return transport.handleRequest(request);
}

export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
export const DELETE = handleMcpRequest;
