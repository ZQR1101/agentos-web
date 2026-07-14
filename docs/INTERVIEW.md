# AgentOS 面试与演示材料

## 90 秒演示流程

1. 在任务工作台输入一个需要最新信息和来源的调研问题。
2. 展示任务创建后停在人工审批节点，说明外部调用不会静默执行。
3. 点击暂停，刷新页面，再从“运行记录”打开并恢复，证明任务已经持久化。
4. 批准执行，观察 Planner、Executor、Reviewer 的事件交接。
5. 展示 Reviewer 分数、执行轮数、Markdown 报告和可点击来源。
6. 打开“工作流”“Agents”“工具权限”页面，说明角色边界、Loop 退出条件和权限策略。

## 面试讲解重点

### 为什么不是一个 Prompt？

单次模型调用无法稳定表达长任务状态、工具权限和失败恢复。本项目把任务状态放在 Harness 与 Task Store 中，模型只负责具体角色的结构化决策。

### Multi-Agent 如何交接？

Planner 输出 `ResearchPlan`；Executor 接收计划和搜索来源并输出 Markdown；Reviewer 输出 `ReviewResult`。角色之间通过 TypeScript 数据结构交接，而不是自由对话。

### 如何防止无限循环？

Harness 将修订次数限制为一次。Reviewer 第二次仍不通过时，任务进入失败状态并保存原因，等待用户重试。

### 如何保证可控？

外部搜索和模型调用前需要人工审批；任务支持暂停、恢复和失败重试；密钥只存在服务端；报告要求引用真实搜索结果。

### 当前最大的技术债是什么？

本地 JSON 存储与同步执行只适合单机 Demo。生产化需要 PostgreSQL、后台任务队列、SSE、幂等执行、分布式锁和可取消 Worker。

## 简历项目描述

**AgentOS — 可控多 Agent 调研平台｜Next.js、TypeScript、DeepSeek、Tavily**

- 设计并实现 Planner–Executor–Reviewer 多 Agent 工作流，以结构化 JSON/TypeScript Schema 完成任务计划、工具结果、报告与审核意见的角色交接。
- 构建带退出条件的 Agent Harness：支持人工审批、任务暂停/恢复、失败重试及最多一次自动修订，避免不可控工具调用和无限循环。
- 接入 Tavily 实时网页检索与 DeepSeek 模型 API，生成带可验证来源的 Markdown 调研报告，并记录 Agent 事件、评分、执行轮数和响应 ID。
- 实现任务持久化与运行记录，支持刷新后恢复任务，为后续迁移 PostgreSQL、后台 Worker 和 SSE 预留清晰边界。

## 可继续追问自己的问题

- 为什么选择显式状态机，而不是让 Agent 自由决定全部步骤？
- 如果两个请求同时执行同一个 Task，如何保证幂等性？
- 如何防御网页来源中的 Prompt Injection？
- 怎样评估 Planner、检索、写作和 Reviewer 各自的质量？
- 如何将 Tavily 工具改造成 MCP Server？
