# AgentOS

[![CI](https://github.com/ZQR1101/agentos-web/actions/workflows/ci.yml/badge.svg)](https://github.com/ZQR1101/agentos-web/actions/workflows/ci.yml)

一个面向 Agent 开发实习作品集的可控调研 Agent。它不是普通聊天页面，而是一个包含真实多 Agent 协作、网页检索、人工审批、任务持久化和执行追踪的 Agent Runtime 原型。

## 项目亮点

- **真实 Multi-Agent**：Planner 输出结构化 JSON 计划；Executor 调用 Tavily 检索并基于来源写报告；Reviewer 独立评分和提出修订要求。
- **受控 Agent Loop**：Reviewer 未通过时由 Harness 触发一次修订，达到上限后终止，避免无限循环。
- **Human-in-the-loop**：外部搜索和模型调用前必须获得用户批准，任务可在审批节点暂停和恢复。
- **可验证来源**：报告只能依据搜索摘要生成，并展示可点击的原始网页链接。
- **任务持久化**：Task、Plan、Sources、Report、Review 和 Events 保存至 `.data/tasks.json`，刷新后仍可恢复。
- **可观测性**：记录 Agent 交接、当前步骤、Reviewer 分数、执行轮数、失败原因和模型响应 ID。

## 架构

```mermaid
flowchart LR
    UI["Next.js 工作台"] --> API["Task API / Research API"]
    API --> H["Harness"]
    H --> P["Planner Agent"]
    P -->|"ResearchPlan JSON"| E["Executor Agent"]
    E --> T["Tavily Search"]
    T -->|"Sources"| E
    E -->|"Markdown Report"| R["Reviewer Agent"]
    R -->|"approved"| DONE["持久化结果"]
    R -->|"revisionInstructions"| E
    H --> STORE["Task Store"]
```

## 执行流程

1. 用户创建任务，服务端生成 Task 并保存。
2. 系统停在审批节点；用户可以批准、暂停或稍后恢复。
3. Planner 将目标转换为 `searchQuery`、`subquestions` 和 `successCriteria`。
4. Executor 使用 Tavily 获取最多 6 个公开网页来源，再调用 DeepSeek 生成带引用的 Markdown 报告。
5. Reviewer 返回 `approved`、`score`、`issues` 和 `revisionInstructions`。
6. 未通过时最多修订一次；通过后保存报告、来源、评分和完整事件记录。

单次任务至少调用 DeepSeek 3 次；触发修订时最多调用 5 次。

## 技术栈

- Next.js 16、React 19、TypeScript、Tailwind CSS
- DeepSeek OpenAI-compatible Chat Completions API
- Tavily Search API
- React Markdown + GFM
- 本地 JSON Task Store（可替换为 SQLite/PostgreSQL）

## 本地运行

```bash
npm install
Copy-Item .env.example .env.local
npm run dev
```

在 `.env.local` 配置：

```env
DEEPSEEK_API_KEY=你的密钥
DEEPSEEK_MODEL=deepseek-v4-flash
TAVILY_API_KEY=你的密钥
```

打开 `http://localhost:3000`。不要提交 `.env.local` 或在截图、Issue 中暴露完整密钥。

## 主要目录

```text
src/app/api/tasks/       Task 创建、查询、暂停、恢复与重试
src/app/api/research/    Multi-Agent Loop 与外部工具调用
src/lib/task-store.ts    本地任务持久化
src/components/ChatBox   工作台和审批交互
src/components/RunsList  真实运行记录
src/types/task.ts        Agent 结构化交接协议
```

## 验证

```bash
npm run lint
npm run build
```

## 当前边界

- JSON Task Store 适合本地 Demo，不适合多实例或 Serverless 生产部署。
- 执行 API 当前为同步请求；生产版本应使用任务队列、轮询/SSE 和可取消的后台 Worker。
- Tavily 返回的网页摘要仍需考虑来源质量、时效性和内容注入风险。

## 下一步

1. 将 Task Store 替换为 PostgreSQL，并为 Task、Step、Event 建表。
2. 使用后台 Worker + SSE，实现执行中暂停、取消和实时步骤更新。
3. 增加来源可信度评分、Prompt Injection 防护和评测数据集。
4. 把搜索能力封装为标准 MCP Server，并增加 Tool Registry。

面试演示流程和简历描述见 [`docs/INTERVIEW.md`](docs/INTERVIEW.md)。
