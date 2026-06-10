# StrategicMind 项目优化 Workflow 设计

**日期**：2026-06-06
**作者**：Ralph Agent
**模式**：ultracode（多 Agent 编排，token 不设上限）
**目标**：调用 Agent team 完成 2 件事
1. 基于示例种子文档彻底跑通 pipeline
2. 优化前端逻辑更符合用户使用与分析逻辑

---

## 1. 总目标

把 StrategicMind（一个基于群体智能的 A 股/公司战略推演系统）从「能跑」推进到「好用」：
- 跑通：基于 `uploads/hubei_plan_seed.txt` 端到端跑完 7 步 pipeline
- 好用：前端 Dashboard/Workbench 的信息架构、交互、状态、实时反馈符合用户决策路径

## 2. 范围

### In scope
- 后端：`PipelineOrchestrator` 7 stage 跑通、失败修复、env/配置健康
- 前端：`Dashboard.tsx`、`Workbench.tsx`、`pipeline.ts` store、`LiveRunPanel`、`PipelineDashboard` 及衍生组件
- SSE 实时事件、checkpoint 持久化、stage 进度反馈
- 用户决策路径：上传 → 配置 → 启动 → 监控 → 报告

### Out of scope（本次）
- 模型微调、知识库重训
- 新增 PRD 级别的功能（如新增部门、Agent 类型）
- 移动端适配

## 3. 架构与依赖

```
Environment 探活 (A1) ──┐
                         ├──> Pipeline E2E 跑通 (A2) ──> 失败修复 (A3)
                                                              │
                                                              ▼
用户旅程分析 (B1) ──┐
代码审计 (B2) ──────┼──> 问题清单 v1 + Top-5 优先级
UI 评审 (B3) ───────┘
                    │
                    ▼
   3 方案独立设计 (C1/C2/C3) ──> 评委选优 (Cjudge) ──> 实施 (Cimpl)
                                                              │
                                                              ▼
                                                       端到端验证 (Verify)
```

## 4. 各 Agent 任务与产出

| Agent | 任务 | 输入 | 产出 | 隔离 |
|---|---|---|---|---|
| **A1** env-probe | 探活：.env / 端口 / LLM provider / API 健康 | repo root | env-report.md | - |
| **A2** pipeline-runner | POST /api/pipeline/start + 监听 SSE 事件，跑 7 stage | A1 + seed | run-trace.json + 各 stage 产物 | - |
| **A3** pipeline-fixer | 读 A2 trace，定点修复后端 bug 或配置 | A2 trace | patch + retest | - |
| **B1** user-journey | 3 路径：上传→启动 / 启动→监控 / 监控→报告 | frontend code | user-journey.md | worktree |
| **B2** code-audit | 5 文件审计：Dashboard/Workbench/store/LiveRunPanel/PipelineDashboard | frontend code | code-audit.md | worktree |
| **B3** ui-review | 信息密度 / 视线流 / 沙盘推演范式对比 | frontend code + 沙盘范式参考 | ui-review.md | worktree |
| **C1** design-perf | 性能/实时性 优先方案 | B1+B2+B3 | design-perf.md | worktree |
| **C2** design-dx | DX/可维护性 优先方案 | B1+B2+B3 | design-dx.md | worktree |
| **C3** design-ux | UX/决策流 优先方案 | B1+B2+B3 | design-ux.md | worktree |
| **Cjudge** | 5 维度评分（0-5）：正确性/可行性/影响/简洁性/对齐用户旅程 | C1/C2/C3 | verdict.md | - |
| **Cimpl** | 实施 winner 方案 + 融合 runner-up 优点 | verdict.md | code changes | worktree |
| **Verify** | 端到端回归：pipeline + 前端 | A3 patch + Cimpl | final-report.md | - |

## 5. 数据流与文件约定

- **种子**：`uploads/hubei_plan_seed.txt`（不可改）
- **A 系列产物**：`/tmp/agent-A*/`
- **B 系列产物**：`/tmp/agent-B*/`（3 份独立 review）
- **C 系列产物**：`/tmp/agent-C*/`（3 份独立 design + 1 份 verdict）
- **最终代码改动**：直接在主分支（pipeline 修复 + 前端优化）
- **最终报告**：`docs/superpowers/specs/2026-06-06-optimization-final-report.md`

## 6. 验收

- **Pipeline**：能基于 hubei_plan_seed 端到端跑通 7 stage，状态达 completed，每个 stage 产物落盘
- **前端**：实施完成后 `npm run build` 0 错误、`npm run lint` 0 错误；启动新 pipeline 后 LiveRunPanel 收到实时事件，Workbench 7 步卡片按 stage 切换；用户从 Dashboard 启动 → Workbench 监控 → Report 查看 三步路径无断点
- **代码质量**：单文件 > 600 行的要拆分（pipeline_orchestrator.py 当前 829 行暂不动，由 A3 按需拆）

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 后端环境未就绪（LLM 缺 key、端口占用、依赖缺失） | A1 先探，失败则报告用户，由用户决定是否补环境 |
| Pipeline 7 stage 中间崩溃 | A2 完整记录 trace，A3 定点修复，最多重试 2 轮 |
| 3 个前端方案设计相互冲突 | Cjudge 选优 + 融合 runner-up，避免取最大公约数 |
| Agent 修改冲突 | B/C 系列用 git worktree 隔离 |
| Token 消耗过大 | 阶段间 barrier 收敛信息；B/C Agent 只读必要文件 |

## 8. 不做

- 不做 PRD 新增（保持现有 10 个 PRD 范围）
- 不动模型层（LLM provider/llm_factory/llm_request_queue 等不在优化范围）
- 不改数据 schema
