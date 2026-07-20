import { createSign } from "node:crypto";

type GitHubAppConfig = { appId: string; installationId: string; privateKey: string };
type CachedToken = { value: string; expiresAt: number };
let cachedToken: CachedToken | undefined;

function base64Url(value: string) { return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); }

export function getGitHubAppConfig(environment: NodeJS.ProcessEnv = process.env): GitHubAppConfig | undefined {
  const appId = environment.GITHUB_APP_ID?.trim();
  const installationId = environment.GITHUB_APP_INSTALLATION_ID?.trim();
  const privateKey = environment.GITHUB_APP_PRIVATE_KEY_BASE64?.trim();
  if (!appId && !installationId && !privateKey) return undefined;
  if (!appId || !installationId || !privateKey) throw new Error("GitHub App 配置不完整：需同时设置 GITHUB_APP_ID、GITHUB_APP_INSTALLATION_ID 和 GITHUB_APP_PRIVATE_KEY_BASE64。" );
  return { appId, installationId, privateKey: Buffer.from(privateKey, "base64").toString("utf8") };
}

export function createGitHubAppJwt(config: GitHubAppConfig, now = Math.floor(Date.now() / 1000)) {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iat: now - 30, exp: now + 540, iss: config.appId }));
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256"); signer.update(signingInput); signer.end();
  return `${signingInput}.${signer.sign(config.privateKey).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}

export async function getGitHubAuthorization(environment: NodeJS.ProcessEnv = process.env) {
  const config = getGitHubAppConfig(environment);
  if (!config) return undefined;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return `Bearer ${cachedToken.value}`;
  const response = await fetch(`https://api.github.com/app/installations/${encodeURIComponent(config.installationId)}/access_tokens`, { method: "POST", headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${createGitHubAppJwt(config)}`, "X-GitHub-Api-Version": "2022-11-28" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`GitHub App 安装令牌获取失败（${response.status}）。请确认 App 已安装到目标仓库且只读权限已授予。`);
  const payload = await response.json() as { token?: string; expires_at?: string };
  if (!payload.token || !payload.expires_at) throw new Error("GitHub App 未返回有效安装令牌。" );
  cachedToken = { value: payload.token, expiresAt: new Date(payload.expires_at).getTime() };
  return `Bearer ${cachedToken.value}`;
}
