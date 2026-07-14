# AgentOS 面试与演示材料

## 90 秒演示流程

1. 在任务工作台输入一个需要最新信息和来源的调研问题。
2. 展示任务创建后停在人工审批节点，说明外部调用不会静默执行。
3. 点击暂停，刷新页面，再从“运行记录”打开并恢复，证明任务已经持久化。
4. 批准执行，观察工作台实时刷新 Planner、MCP Tool、Executor、Reviewer 的步骤、事件、执行 ID 和耗时。
5. 展示 Reviewer 分数、程序化引用检查、来源质量分和提示注入风险标签。
6. 打开“工作流”“Agents”“工具权限”页面，说明角色边界、Loop 退出条件和权限策略。

## 面试讲解重点

### 为什么不是一个 Prompt？

单次模型调用无法稳定表达长任务状态、工具权限和失败恢复。本项目把任务状态放在 Harness 与 Task Store 中，模型只负责具体角色的结构化决策。

### Multi-Agent 如何交接？

Planner 输出 `ResearchPlan`；Executor 接收计划和搜索来源并输出 Markdown；Reviewer 输出 `ReviewResult`。角色之间通过 TypeScript 数据结构交接，而不是自由对话。

### Skill 是真实执行模块还是页面概念？

是真实模块。`research-report@1.0.0` 封装 Planner、Executor、Reviewer 的提示词与执行方法，并用 Zod 校验 Planner/Reviewer 输出；`source-review@1.0.0` 封装确定性的来源筛选和引用验证。两者注册到同一个 Skill Registry，Skills 页面直接读取注册表，Task 还会保存本次实际使用的 Skill ID 与版本，便于复现和升级审计。

### 如何防止无限循环？

不是只在 Prompt 里要求模型停止。Harness 在每次外部动作前通过确定性预算执行器授权，默认最多 8 步、5 次模型调用、3 次工具调用和 180 秒；任一维度超限都会失败关闭并持久化用量。修订次数另行限制为一次，Reviewer 第二次仍不通过时任务进入失败状态并保存原因。

### 两个请求同时执行同一个 Task 会发生什么？

Task Store 将状态检查与 `waiting_approval → running` 更新放在同一个串行临界区，只有一个请求能获得带 `executionId` 的执行权。其他请求看到 `running` 时返回 202 并轮询复用结果，看到 `completed` 时直接返回已持久化结果，因此不会重复调用 DeepSeek 或 Tavily。并发测试会用 20 个请求竞争同一个任务，断言只有一个成功 claim。

### 如何保证可控？

外部搜索和模型调用前需要人工审批；每次调用还必须通过 Harness 预算授权，授权动作和当前用量会先写入 Task Store。DeepSeek 单次调用限制 45 秒，Tavily 限制 20 秒。任务支持暂停、恢复和失败重试；密钥只存在服务端。网页摘要统一视为不可信数据，Source Policy 会进行 URL 校验、质量评分和提示注入检测，高风险来源不会进入模型上下文。

### Reviewer 会不会自己也判断错？

会，所以不能只依赖模型自评。Harness 在 Reviewer 之外确定性校验引用编号、URL 是否与搜索结果一致，以及报告是否混入未授权外链。模型语义审核与程序规则必须同时通过。

### 如何证明 Prompt Injection 防护不是只写了几条规则？

CI 会执行一个版本化离线评测集，当前包含 10 个正常、可疑和高风险来源样本，以及 5 个引用完整性用例。脚本对精确匹配率、高风险拒绝召回率和可用来源保留率设置阈值，退化会直接阻止合并。当前 100% 只说明这组小型回归样本全部通过，不声称覆盖开放网络攻击。

### 这里的 MCP 是真实协议还是页面模拟？

是真实协议。项目使用官方 TypeScript SDK 创建 Research MCP Server，注册带 Zod 输入输出 Schema 和只读注解的 `search_web` Tool。Harness 侧使用 MCP Client 先初始化，再执行 `tools/list` 和 `tools/call`。Tool 对瞬时空结果执行最多 3 次有限指数退避重试，并把尝试次数作为结构化输出返回。单元测试使用 InMemory Transport 完整跑协议，远程客户端则可通过带 Bearer Token 和 Host Allowlist 的 Streamable HTTP Endpoint 连接。

### 当前最大的技术债是什么？

本地 JSON 存储与同步执行只适合单机 Demo。生产化需要 PostgreSQL、后台任务队列、SSE、幂等执行、分布式锁和可取消 Worker。

## 简历项目描述

**AgentOS — 可控多 Agent 调研平台｜Next.js、TypeScript、DeepSeek、Tavily**

- 设计并实现 Planner–Executor–Reviewer 多 Agent 工作流，以结构化 JSON/TypeScript Schema 完成任务计划、工具结果、报告与审核意见的角色交接。
- 构建带退出条件的 Agent Harness：支持人工审批、任务暂停/恢复、失败重试及最多一次自动修订，避免不可控工具调用和无限循环。
- 为任务执行实现原子状态转换与幂等响应，避免并发请求重复调用模型；以串行写锁和临时文件原子替换保护本地持久化，并编写并发竞争测试。
- 接入 Tavily 实时网页检索与 DeepSeek 模型 API，生成带可验证来源的 Markdown 调研报告，并记录 Agent 事件、评分、执行轮数和响应 ID。
- 基于官方 MCP TypeScript SDK 实现 Research MCP Server 与 Client，支持工具发现、结构化调用、InMemory/Streamable HTTP 双 Transport 及合约测试。
- 设计 Source Policy 安全层，对外部摘要进行质量评分、提示注入检测与高风险隔离，并以确定性引用校验配合 LLM Reviewer 构成双层质量门禁。
- 建立版本化离线安全评测集与 CI 阈值，覆盖中英文提示注入、危险 URL、重复来源、引用错配和未授权外链等回归场景。
- 实现任务持久化与运行记录，支持刷新后恢复任务，为后续迁移 PostgreSQL、后台 Worker 和 SSE 预留清晰边界。

## 可继续追问自己的问题

- 为什么选择显式状态机，而不是让 Agent 自由决定全部步骤？
- 如果部署多个 Worker，如何把进程内 claim 升级为数据库事务和带过期时间的执行租约？
- 如何防御网页来源中的 Prompt Injection？
- 怎样评估 Planner、检索、写作和 Reviewer 各自的质量？
- 为什么 Harness 内部选 InMemory Transport，而对外提供 Streamable HTTP？
- 如何为多个 MCP Server 增加动态 Tool Registry、权限隔离和健康检查？
