# AgentOS Runtime：软件工程 Agent 首个应用

AgentOS 的目标不是替代某一个代码模型，而是成为企业将模型投入工程生产前的受控执行层。模型和 Agent 可替换，Runtime 负责把它们约束为可审计、可审批、可恢复的交付流程。

## 首个业务闭环

```text
代码库 / GitHub Issue / PR Diff → Planner → 只读 Repository Tool → 专项 Agent → Reviewer → 报告
```

`src/lib/software-engineering-workflow.ts` 定义此闭环的不可变执行蓝图。第一版严格只读，支持代码库分析、Bug 定位和 PR 审查：

- `github:read`：读取 Issue、仓库、分支、文件、日志与 PR diff；不修改任何外部状态。
- 报告中的每项结论都应回链到代码、Issue 或 diff 证据；建议不会自动执行。

## Runtime 责任

| 能力 | Runtime 的责任 |
| --- | --- |
| Task Management | 状态机、排队、重试、取消与恢复点 |
| Agent Planning | 角色交接、计划契约与步骤预算 |
| Tool Registry | 工具输入输出、作用域与预算 |
| Permission / Approval | 默认拒绝、最小权限、每次敏感升级均可审批 |
| Memory | 按组织、仓库和任务隔离的短/长期记忆 |
| Execution | 隔离工作区、凭证注入、超时和资源限制 |
| Trace | 模型、工具、状态、成本、diff 与审批审计 |
| Evaluation | 测试、静态检查、审查结论与可复现证据 |

代码库理解、Bug Triage 与 PR Review 已复用同一 Runtime，同时保持独立任务契约、证据规则和 `github:read` 权限边界。PR Review 的 Security、Code Review、Test 和 Reviewer 角色仅生成报告，不会向 GitHub 提交审查或修改。

## 当前执行可靠性

- 审批只负责将任务持久化为 `queued`，不直接调用业务 Agent。
- PostgreSQL 模式使用事务行锁领取任务；独立 Worker 通过可续期租约将任务切换为 `running`，避免跨实例重复领取。
- 失败任务在三次预算内按指数退避自动重试；最终失败后可以由用户手动重置预算。
- 排队或执行中的任务可以取消；取消后的迟到结果不能覆盖 `cancelled` 终态。
- API 恢复时会检测过期执行租约，并将中断任务恢复到持久化队列。
- 本地开发保留 JSON + 内联 Worker；生产可关闭内联执行，将 Web 与 Worker 独立扩缩容。

## 当前质量闭环

- 自动 Evaluation 衡量证据文件数、覆盖完整性和结论可靠等级。
- 已完成任务支持人工标记“接受 / 需要改进 / 不可用”并记录复核备注。
- `/evaluations` 将人工接受率与自动可靠率分开展示，同时聚合完成率、重试率和各业务 Agent 质量。
- 未经人工复核的任务不计入接受率分母，避免把“无人评价”误判为业务认可。
- `evals/software-agent-benchmark.json` 保存版本化离线基准；`npm run eval:software` 生成最近报告并在看板展示用例通过率、PR precision 和 recall。
