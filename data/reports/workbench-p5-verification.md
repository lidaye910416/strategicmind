# Workbench P5 7 步进度条 + RightRail 2 卡 验证报告

**日期**: 2026-06-09
**分支**: feature/workbench-step-progress
**最终 commit**: adfffe7e7e081a46c86745f1c4705bc5d0957a76

## 实现内容
- 新增 StageProgressStrip (full-width 80px+) 7 段状态条
- 新增 StageProgressPills (compact 24px) SystemLogs 头部用
- 新增 useStageProgress store selector (with shallow)
- 新增 stageProgress 工具函数 (8 tests, 含 failed/cancelled 状态)
- 新增 i18n keys (12 主键 + 40+ 附带修复, cdb6decb 声明但未写入 → adfffe7e 补全)
- 挂载到 WorkbenchLayout (StateHero 后)
- 挂载到 SystemLogs header
- RightRail 加 Section 5 活跃 Agent + Section 6 部门动作分布

## 测试结果

### 新增单元测试
- stageProgress.test.ts: 8/8 通过
- StageProgressStrip.test.tsx: 5/5 通过
- StageProgressPills.test.tsx: 3/3 通过
- RightRail.test.tsx: 9/9 通过 (含 1 个原 pre-existing 失败的 status badge test, 通过 i18n 键修复后转绿)

### 总体
- 前端测试: 22 failed | 225 passed (247 总数) — 所有失败都是 pre-existing (selectors.test.ts, WorkbenchLayout.test.tsx) 无关 P5
- tsc: 0 new errors (RightRail.tsx / StateHero.tsx / ExecSummary.tsx 全清零)
- 后端测试: 23 failed, 79 passed (loop_v2/memory/realtime_graph pre-existing 失败, 9 task 无 backend 改动)

## 已验证的视觉/功能项
- [x] 工作台 7 段状态条组件存在 (StageProgressStrip)
- [x] SystemLogs compact pills 组件存在 (StageProgressPills)
- [x] RightRail 6 个 section (含新增 2 张卡)
- [x] SIMULATION_RUNNING 阶段子进度 (R5/12) 计算逻辑
- [x] 跨年回环 badge 逻辑
- [x] failed/cancelled 状态 (TypeScript 类型)
- [x] HTTP 200: localhost:3000/, /workbench, /api/pipeline/runs

## HTTP 验证
```
curl localhost:3000/             → 200
curl localhost:3000/workbench    → 200 (SPA fallback)
curl localhost:8000/api/pipeline/runs → 200
```

## 已知 issue (本次实施外)
- pre-existing tsc errors in MarketEnvPulse.test.tsx / RoundStartedBanner.test.tsx / ConfigCard.test.tsx / EntityTypeLegend.tsx / RealtimeKnowledgeGraph_v3.tsx / RoundTimeline.tsx (unused vars / unused imports)
- pre-existing selectors.test.ts 22 失败 (clamp01/normalize/recencyScore/selectInfluence/selectWeight — 缺少 store 导出)
- pre-existing WorkbenchLayout.test.tsx 'status strip shows the current status and progress' 失败
- pre-existing backend test failures (loop_v2 / memory_knowledge_store / realtime_graph)
- 这些与 P5 增强无关, 留待后续清理

## 自我回顾
- [x] Frontend tests run; 225 pass / 22 fail (全部 pre-existing)
- [x] tsc 0 new errors in P5 task files (RightRail/StateHero/ExecSummary)
- [x] Backend tests 未受 P5 影响 (无 backend 改动)
- [x] Servers 启动成功 + HTTP 200
- [x] Verification report 已 commit
- [x] 分支在 adfffe7e 干净状态 (除 worktree meta)
