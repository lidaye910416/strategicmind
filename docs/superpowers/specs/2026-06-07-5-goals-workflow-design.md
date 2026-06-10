# StrategicMind 5 目标达成 Workflow 设计

**日期**：2026-06-07
**作者**：Ralph Agent
**模式**：ultracode（多 Agent 编排 + Workflow 工具）
**前置 HEAD**：`9725ff8` (main)

---

## 0. 5 目标（必须全部达成）

| # | 目标 | 验收 |
|---|---|---|
| **G1** | 前后端链接好 | 前端 `/` 加载 0 CORS 报错；`/api/pipeline/runs` 200；后端启停脚本化 |
| **G2** | 推演进行中 Dashboard 和 Workbench 内容同步 | 同一 runId 在两个视图展示一致；SSE live_event 真正跑通；`/workbench/:runId` URL 切自动重连 |
| **G3** | 添加与公司经营/多轮模拟相关的可选参数 | StrategicConfigGenerator 接 user_params；`max_rounds = years × time_step`；公司部门多选；外部因素 textarea；涌现策略 |
| **G4** | 历史任务不丢，刷新仍在 | runs 卡片化 + 复制配置 + 中途刷新重连（hydrate + SSE 重开 + graph-snapshot 回放）|
| **G5** | 重点参考, 按年份循环迭代 + 内外部环境变化 | **L3 多年逐月**（36 轮）+ 持续市场环境演化 + 外部因素按 N 轮注入 + 跨年"再推 1 年"按钮 |

---

## 1. 架构总览

```
[ 用户操作 ]                    [ 前端 ]                        [ 后端 ]
   │                             │                              │
   │  选年限/部门/外部因素        │   POST /api/pipeline/start   │
   ├────────────────────────────▶│──▶ PipelineOrchestrator      │
   │  (G3)                       │     创建 run + 持久化          │
   │                             │     checkpoint_dir/           │
   │                             │     注入 user_params            │
   │  看 Dashboard               │                              │
   │  ┌─────────────────┐         │   SSE /events                │
   │  │ LiveRunPanel   │◀────────│── (G2) snapshot + live_event  │
   │  │ + Progress     │         │   持续推演 events             │
   │  └─────────────────┘         │                              │
   │  切到 /workbench/:runId      │                              │
   │  ┌─────────────────┐         │   hydrate + graph-snapshot   │
   │  │ WorkbenchPanel │◀────────│── (G4) SSE 重连              │
   │  │ (同步内容)     │         │   + network-frames 回放      │
   │  └─────────────────┘         │                              │
   │  刷新页面                   │   GET /pipeline/runs          │
   │  ┌─────────────────┐         │   hydrateFromRunId           │
   │  │ RecentRuns     │◀────────│── (G4) 列表卡片化 + 复制配置  │
   │  │ + 复制配置按钮 │         │                              │
   │  └─────────────────┘         │                              │
   │  3 年 36 轮跑完              │                              │
   │  点击"再推 1 年"            │   POST /advance-year          │
   │  ┌─────────────────┐         │   (G5) MarketEnvironment     │
   │  │ 持续演化         │◀────────│── 季度更新 + 外部 shock     │
   │  │ 涌现 + 报告     │         │   推演到下一年              │
   │  └─────────────────┘         │                              │
```

---

## 2. Workflow 5 阶段（每阶段独立验收）

### P0 基础设施（G1）
- BE-INFRA-1: python3 -m backend.run_server 启 8000, `/api/health` 200
- FE-INFRA-1: vite.config.ts 加 `server.proxy['/api']` → 8000
- BE-INFRA-2: flask_cors 加 CORS(app, origins=["http://localhost:3000","http://localhost:3001"])
- FE-INFRA-2: 前端 axios baseURL 改 `''`（走 vite proxy）
- 验收：刷新 `/` 0 CORS 报错，Network 面板 `/api/pipeline/runs` 200

### P1 实时同步（G2）
- BE-SYNC-1: 确认 sim_loop._execute_round 触发 progress_callback（加 1 行 print 验证）
- BE-SYNC-2: orchestrator emit 路径已布（已合并）；EventBus queue.Queue（已修）
- FE-SYNC-1: store/pipeline.ts 现有 SSE handler 已解 `live_event`（已落地）
- FE-SYNC-2: Dashboard 与 Workbench **共用** `useGraphNodes/useSimRounds`（已部分落地，需补）
- FE-SYNC-3: Workbench.tsx `useEffect(() => hydrateFromRunId(runId))` 已存在；加轮询 retry 3 次
- 验收：启动推演后用 2 个 tab 打开 Dashboard + Workbench，状态同步

### P2 参数化（G3）
- BE-PARAM-1: StrategicConfigGenerator 重构：读 `user_params`，派生 `max_rounds = years × {year:1, quarter:4, month:12}[time_step]`
- BE-PARAM-2: pipeline_orchestrator._stage_simulation_running 用新 `max_rounds` 替换硬编码 3
- FE-PARAM-1: ConfigCard.tsx 已落地 8 维（年限/时间步长/部门/外部因素/涌现/收敛/报告风格/对象数）— 确认 UI 状态映射完整
- FE-PARAM-2: Dashboard startPipeline 把新 params 透传
- 验收：years=3, time_step=month, departments=[销售,技术,财务] → SIMULATION_RUNNING 跑 36 rounds，3 个部门各生成 ≥3 个 agent

### P3 持久化（G4）
- BE-PERSIST-1: `GET /api/pipeline/runs?limit=20` 返回 [{run_id, status, started_at, config_summary}] 列表（config 摘要：年限/部门/风格）
- BE-PERSIST-2: `POST /api/pipeline/<id>/cancel` 后状态持久化
- FE-PERSIST-1: RecentRuns 卡片化：config 摘要 + 状态徽章 + 2 个按钮（查看报告 / 复制配置）
- FE-PERSIST-2: 复制配置：跳 Dashboard 预填 `user_params`（不复制 doc_ids，提示）
- FE-PERSIST-3: Workbench.tsx `hydrateFromRunId` 失败 retry 3 次；`graph-snapshot` + `network-frames` + `events` SSE 三件套重连
- 验收：推演中刷新 → 3 秒内 workbench 恢复；点击历史 run 卡片看到完整复盘

### P4 多年循环（G5）
- BE-LOOP-1: MarketEnvironmentAgent 季度演化（已有 `market_environment.py`），每 4 轮调用一次 `evolve_quarter()` 产生市场扰动
- BE-LOOP-2: ExternalShockSimulator 接入（已有 `external_shock_simulator.py`），每 N=3 轮把 user 的 external_factors 注入推演
- BE-LOOP-3: 新增 `POST /api/pipeline/<id>/advance-year` → 推演 12 月 + 1 季度环境更新 + 1 次市场扰动
- BE-LOOP-4: emit `market_event` SSE 事件类型（含 shock 描述）
- FE-LOOP-1: Workbench 顶部"再推 1 年"按钮（仅 completed/failed run 可点）
- FE-LOOP-2: SystemLogs 接收 `market_event` 显示为醒目的橙色横幅
- 验收：years=3, time_step=month → 36 rounds + 9 季度环境扰动（每 4 轮 1 次）+ 外部因素在 R3/R6/R9... 注入；前端日志看到 9 条橙色"市场事件"

### P5 验证 + 报告
- 端到端跑通：3 年 36 轮
- 中途刷新测试 3 次
- 复制配置 + 重跑
- "再推 1 年" 按钮
- 写 `docs/superpowers/specs/2026-06-07-5-goals-final-report.md` 5 目标逐项 ✅/❌/⚠️

---

## 3. Workflow Agent 分配

| Phase | Agent | 输入 | 产出 | 隔离 |
|---|---|---|---|---|
| P0 | INFRA | 现状代码 | vite.config + flask_cors + axios 改 | worktree |
| P1 | SYNC | P0 + P2/P3 已合并代码 | sim_loop 触发 print 验证 + FE 双视图共用 store | worktree |
| P2 | PARAM | arch-spec + 当前 StrategicConfigGenerator | 后端派生 max_rounds + 前端 ConfigCard 校验 | worktree |
| P3 | PERSIST | P0-P2 已合并 | RecentRuns 卡片 + 复制配置 + hydrate retry | worktree |
| P4 | LOOP | 沙盘库 + P0-P3 已合并 | market_environment 调用 + 跨年 API | worktree |
| P5 | Verify | 所有 commit | 端到端 36 轮 + 5 目标报告 | - |

---

## 4. 风险与缓解

| 风险 | 缓解 |
|---|---|
| P2 StrategicConfigGenerator 改崩后端 | 改前保留旧 `_define_metrics` 行为做 fallback；pytest 72 PASS 守护 |
| P4 持续环境演化循环依赖 | 用 `n_stakeholders * 0.1` 而非 0 防除零；每 4 轮调用 1 次避免 LLM 成本爆炸 |
| 中途刷新数据不一致 | SSE 重连前先 `GET /graph-snapshot` + `GET /network-frames` 把 store 填满 |
| 多年推到性能 | `/advance-year` 复用 sim_loop.run，不重启 run；用 `run_id + year_offset` |

---

## 5. 不做（Out of scope）

- LLM 智能体策略升级
- 多公司并行模拟
- 报告自动生成质量优化（已能用）
- 移动端
- 国际化（中文化已就位）
- ESLint 规则补全（项目历史缺失，独立 chore）
