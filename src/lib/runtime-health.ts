export interface RuntimeHealth {
  ready: boolean;
  model: string;
  deepSeekConfigured: boolean;
  tavilyConfigured: boolean;
  remoteMcpEnabled: boolean;
  allowedMcpHostCount: number;
  taskStoreMode: "json" | "postgres";
  queueMode: "in-memory" | "redis";
}

function configured(value: string | undefined) {
  return Boolean(value?.trim());
}

export function getRuntimeHealth(environment: NodeJS.ProcessEnv = process.env): RuntimeHealth {
  const allowedHosts = (environment.MCP_ALLOWED_HOSTS ?? "localhost:3000,127.0.0.1:3000")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  const deepSeekConfigured = configured(environment.DEEPSEEK_API_KEY);
  const tavilyConfigured = configured(environment.TAVILY_API_KEY);
  return {
    ready: deepSeekConfigured && tavilyConfigured,
    model: environment.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash",
    deepSeekConfigured,
    tavilyConfigured,
    remoteMcpEnabled: configured(environment.MCP_ACCESS_TOKEN),
    allowedMcpHostCount: allowedHosts.length,
    taskStoreMode: configured(environment.DATABASE_URL) ? "postgres" : "json",
    queueMode: configured(environment.REDIS_URL) ? "redis" : "in-memory",
  };
}
