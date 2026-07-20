# AgentOS

面向 GitHub 软件工程团队的受控 Multi-Agent Runtime。第一阶段聚焦只读的软件工程分析：代码库分析、Bug 定位和 PR 审查。

## 产品定位

AgentOS 不试图替代代码模型。它负责让模型在企业工程流程中可控地运行：明确角色、最小权限、人工审批、预算限制、完整 Trace 和可复核的质量结论。

```text
代码库 / Issue / PR Diff
        ↓
Planner → Repository Tool → 专项分析 Agent → Reviewer
        ↓
带代码证据的分析报告
```

第一版严格只读：不修改文件、不创建分支、不创建 PR、不自动合并。

## 首批业务场景

### 代码库分析

针对“分析这个项目的认证流程”一类问题，Agent 读取目录和代码、搜索相关符号、构建调用链，经 Reviewer 复核后输出架构说明与风险。

### Bug 定位

针对“用户登录失败，帮我分析”一类 Issue，Agent 关联 Issue、日志和代码路径，输出有证据的根因、影响范围和最小修改建议。

### PR 审查

输入 PR diff 后，Security、Code Review 与 Test 角色分别检查安全风险、设计回归和测试缺口，再由 Reviewer 汇总风险等级和建议。

## Runtime 能力

- Task Management：状态机、队列、重试、取消与恢复。
- Agent Planning：结构化计划、角色交接和工作流约束。
- Tool Registry：工具契约、作用域、预算和默认拒绝策略。
- Permission / Approval：最小权限与明确审批。
- Trace：模型、工具、状态、成本和决策日志。
- Evaluation：证据覆盖、质量复核和可解释的完成条件。

详细架构见 [docs/AGENTOS_RUNTIME.md](docs/AGENTOS_RUNTIME.md)。

## 当前实现

- Next.js 16、React 19、TypeScript、Tailwind CSS。
- 本地 JSON 零配置存储，以及面向多实例部署的 PostgreSQL 任务存储。
- 独立 Worker 通过事务行锁和可续期租约领取任务，支持指数退避重试、取消、手动重试和过期租约恢复。
- 任务状态、尝试次数、失败原因和完整 Trace 持久化。
- 结构化 Runtime / Agent / Reviewer / Tool Span：记录每次尝试的耗时、状态、错误和只读工具属性；未接入模型时明确标记 Token 未采集。
- 组织/仓库级审批策略：按精确仓库、组织通配和全局规则校验审批人身份、角色与工具权限，并持久化允许/拒绝决策。
- 多租户任务边界：任务绑定 `organizationId`，API、详情页、评估和 PostgreSQL 查询按组织隔离；Worker 仅在内部保留全局队列视角。
- GitHub App Webhook：校验 HMAC-SHA256 签名，以 delivery ID 幂等处理 PR 更新和 Issue 标签事件，并通过 installation 映射组织后创建等待审批任务。
- 受控 Harness：模型、工具、步骤和耗时预算。
- Software Engineering Agent 的只读工作流契约与控制台：`/engineering`。
- GitHub MCP：仓库树、受限文件内容、Issue、PR 元数据和受限 diff。
- 三条可执行业务链路：Code Understanding、Bug Triage、PR Review。
- PR Review 的安全、质量、测试规则，diff 新行号证据和独立 Reviewer 汇总。
- Evaluation 看板：人工接受/退回结论、自动证据评分、重试率、完成率和业务 Agent 对比。
- 版本化离线基准：固定 9 条真实 GitHub PR/Issue 的 SHA 快照与 7 条合成边界用例，输出真实/合成通过率、PR precision/recall，以及按仓库、语言、风险类型划分的表现。
- 可选 GitHub App 安装令牌认证，可访问获授权的私有仓库。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。

生产模式配置 `DATABASE_URL` 和 `AGENTOS_INLINE_WORKER=false`，然后分别启动 Web 与 Worker：

```bash
npm run db:migrate
npm run start
npm run worker
```

## 验证

```bash
npx tsx --test tests/software-engineering-workflow.test.ts
npm run eval:software
npm run test:postgres-race
npm run build
```

## 下一步

1. 持续扩充经过双人复核的真实 Issue / PR 样本，按仓库、语言和风险类型分层衡量根因准确率与审查误报率。
2. 增加组织、仓库级策略和审批人身份，形成真正的多租户权限边界。
3. 将模型调用、Token、耗时和工具预算纳入统一 Trace 与成本看板。
