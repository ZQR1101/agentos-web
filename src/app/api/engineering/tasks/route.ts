import { NextResponse } from "next/server";
import { createEngineeringTask, listEngineeringTasks } from "@/lib/engineering-task-store";
import { recoverAndResumeEngineeringTasks } from "@/lib/engineering-runtime";
import { resolveOrganizationContext } from "@/lib/approval-policy";

export const runtime = "nodejs";

function repositoryFromUrl(value: string) {
  const matched = value.trim().match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)\/?$/i);
  if (!matched) return undefined;
  return { provider: "github" as const, owner: matched[1], name: matched[2].replace(/\.git$/, ""), defaultBranch: "main" };
}

export async function GET(request: Request) { const organization = resolveOrganizationContext(request.headers); if (!organization) return NextResponse.json({ error: "未识别可信组织上下文。" }, { status: 401 }); await recoverAndResumeEngineeringTasks(); return NextResponse.json({ tasks: await listEngineeringTasks(organization.id), organizationId: organization.id }); }

export async function POST(request: Request) {
  const organization = resolveOrganizationContext(request.headers);
  if (!organization) return NextResponse.json({ error: "未识别可信组织上下文。" }, { status: 401 });
  const body = await request.json().catch(() => null) as { repositoryUrl?: unknown; question?: unknown; useCase?: unknown; issueUrl?: unknown; pullRequestUrl?: unknown } | null;
  if (typeof body?.repositoryUrl !== "string" || typeof body.question !== "string") return NextResponse.json({ error: "请提供 GitHub 仓库地址和分析目标。" }, { status: 400 });
  const repository = repositoryFromUrl(body.repositoryUrl);
  if (!repository) return NextResponse.json({ error: "请输入完整的 GitHub 仓库地址，例如 https://github.com/vercel/next.js。" }, { status: 400 });
  const question = body.question.trim();
  if (!question || question.length > 500) return NextResponse.json({ error: "分析目标不能为空且不能超过 500 个字符。" }, { status: 400 });
  const useCase = body.useCase === "bug_triage" ? "bug_triage" as const : body.useCase === "pull_request_review" ? "pull_request_review" as const : "repository_analysis" as const;
  let issue;
  let pullRequest;
  if (useCase === "bug_triage") {
    if (typeof body.issueUrl !== "string") return NextResponse.json({ error: "Bug 定位任务需要 GitHub Issue 地址。" }, { status: 400 });
    const matched = body.issueUrl.trim().match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/i);
    if (!matched || matched[1].toLowerCase() !== repository.owner.toLowerCase() || matched[2].toLowerCase() !== repository.name.toLowerCase()) return NextResponse.json({ error: "Issue 必须属于所填写的 GitHub 仓库。" }, { status: 400 });
    issue = { number: Number(matched[3]), title: question, url: body.issueUrl.trim() };
  }
  if (useCase === "pull_request_review") {
    if (typeof body.pullRequestUrl !== "string") return NextResponse.json({ error: "PR 审查任务需要 GitHub Pull Request 地址。" }, { status: 400 });
    const matched = body.pullRequestUrl.trim().match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/i);
    if (!matched || matched[1].toLowerCase() !== repository.owner.toLowerCase() || matched[2].toLowerCase() !== repository.name.toLowerCase()) return NextResponse.json({ error: "Pull Request 必须属于所填写的 GitHub 仓库。" }, { status: 400 });
    pullRequest = { number: Number(matched[3]), title: question, url: body.pullRequestUrl.trim() };
  }
  const task = await createEngineeringTask({ repository, useCase, question, issue, pullRequest }, organization.id);
  return NextResponse.json({ task }, { status: 201 });
}
