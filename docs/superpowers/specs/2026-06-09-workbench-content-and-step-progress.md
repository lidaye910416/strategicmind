# Workbench 内容补全 + 步骤进度可见化

**日期**: 2026-06-09
**作者**: Claude (brainstorming + spec)
**状态**: Approved (pending user review)
**关联**: loop-engine-v2-implementation.md §Phase 2 / T2.6

---

## 1. 问题陈述 (Problem)

用户反馈两件事：

1. **工作台像半成品** — `WorkbenchLayout` 在 running / round-complete / year-complete 这三种主流程状态下，`StateHero` 主动 `return null` (line 30-33 of `StateHero.tsx`)，导致顶部区域只剩 `ExecSummary` 那一行 1-2 行的"刚发生/下一轮"文字，**没有任何"当前在 7 步流水线的哪一步"的视觉指示**。12 轮的 RoundTimeline 显示出来了但流水线本身消失不见。
2. **SystemLogs 控制台看不到步骤** — `SystemLogs.tsx` 的 `stage_change` 分支只推一条 `阶段切换 → X` 的纯文本到滚动日志里 (line 132-135)。工作台风格的终端风头部只有 "System Dashboard · N lines" 一个标题，没有结构化的步骤进度条。

加上 `RightRail` 的 "Emerging entities" / "Next event" / "Current round summary" 这 3 块在推演刚启动、数据尚未流入时基本是空 placeholder（"等待实体涌现…"），右侧整列看起来空空荡荡。

## 2. 目标 (Goals)

| # | 目标 | 度量 |
|---|---|---|
| G1 | 工作台顶部有 7 步流水线可视化进度条，**每一时刻都能看出当前在哪一步** | 用户打开 `/workbench` 在 1 秒内看到 7 段状态条 |
| G2 | SystemLogs 头部有 compact 进度条，与工作台保持同步 | 同一 runId 下，刷新两边状态一致 |
| G3 | 第 6 步 SIMULATION_RUNNING 正确表达"循环"特性 | 显示 round 子进度 + 跨年时显示回环 badge |
| G4 | RightRail 在推演初段就有内容可看 | 新增 2 个实时数据卡 (活跃 Agent / 部门动作) |

## 3. 设计 (Design)

### 3.1 新增组件 `StageProgressStrip` (full-width)

**位置**: `frontend/src/components/Workbench/StageProgressStrip.tsx`

**结构**：
```
┌────────────────────────────────────────────────────────────────┐
│ 推演流水线                                            ↻ 循环第 2 年 │
│                                                                │
│  [1✓]──[2✓]──[3✓]──[4✓]──[5✓]──[6 ● R5/12]──[7 ·]              │
│  种子  图谱  实体 画像  配置   ▶ 仿真        报告               │
│  解析  构建  抽取 生成  生成     (9 部门)     生成               │
│                                                                │
│  [6] 当前: 仿真推演 · 5/12 轮 · 9 部门活跃 · 42 行动            │
└────────────────────────────────────────────────────────────────┘
```

**7 段来源**: 后端 `STAGE_ORDER` (在 `pipeline_orchestrator.py` line 81-89) 已有定义。前端复用 `STAGE_LABELS` i18n key (在 `zh.ts` line 12)。

**状态计算**：
```ts
type StageStatus = 'done' | 'active' | 'pending' | 'looping-active'
const stages = STAGE_ORDER.map((s) => ({
  id: s,
  status: completed_stages.includes(s) ? 'done'
        : s === current_stage ? 'active'
        : 'pending',
}))
```

**第 6 步循环处理**：
- 当 `current_stage === 'SIMULATION_RUNNING'`: 状态 = 'active', 下方子进度 = `simRounds.length / total_rounds`
- 当用户在 `year_advanced` 事件后回到 `GRAPH_BUILDING` / `ENTITY_EXTRACTION` / `PROFILE_GENERATION` (跨年重跑) — 状态 = 'looping-active', 显示 `↻ 回环第 N 年` 标签
- 检测方法：监听 `year_advanced` 事件, 维护 `year_offset` 计数, >1 时回环

### 3.2 新增组件 `StageProgressPills` (compact, 用于 SystemLogs)

**位置**: `frontend/src/components/Workbench/StageProgressPills.tsx`

**结构** (24px 高, horizontal):
```
[1✓][2✓][3✓][4✓][5✓][6▶ R5/12][7·]  仿真推演
```

仅 7 个 pill + 当前阶段短名, 共享 `StageProgressStrip` 的 store selectors。

### 3.3 挂载点 (Mount Points)

| 组件 | 位置 | 高度 | 行内修改 |
|---|---|---|---|
| `StageProgressStrip` | `WorkbenchLayout` 中, `StateHero` 与 `ExecSummary` 之间 | 80px | 新建 `section` 块 |
| `StageProgressPills` | `SystemLogs` 头部, 在 "System Dashboard" 标题右侧 | 24px | 在 header `<div>` 内增加 pills |
| **2 个新 RightRail 卡** | `RightRail.tsx` 中, 4 个 section 后增加 #5 和 #6 | 各自 ~140px | 改 `RightRailImpl` |

### 3.4 RightRail 新增 2 个数据卡

**Section 5: 活跃 Agent (Active Agents)**
- 数据源: `simRounds[last].actions` 聚合 `agent_id` + `action_type`
- 渲染: 最多 8 行, 每行 `[icon] agent_name · N 行动 · 最新行动类型`
- 点击 → 高亮对应的图谱节点 (工作台风格)

**Section 6: 部门动作分布 (Department Activity)**
- 数据源: `simRounds[last].actions` 聚合 `department` (9 个部门, 固定列表)
- 渲染: 9 行横向 bar, 每行 `[部门名] ████░░░ N 行动`
- 排序: 行动数降序
- 无数据时: 显示 "等待部门行动流入…"

### 3.5 状态同步 (Data Flow)

```
Backend orchestrator
  ├─ emits stage_change event (already exists)
  ├─ emits year_advanced event (already exists, G5)
  └─ snapshot.completed_stages (already in RunSnapshot)
        ↓ SSE
Frontend store
  ├─ setSnapshot() → state.currentStage, state.completedStages
  ├─ _handleSSEMessage() → state.currentStage on stage_change
  └─ setYearAdvanced() → state.yearAdvanced (year_offset counter)
        ↓
StageProgressStrip + StageProgressPills + RightRail (read-only)
```

**所有数据已存在于 store**, 无后端改动。

## 4. 边界与不做 (Non-Goals)

- ❌ 不改 backend orchestrator 逻辑
- ❌ 不改 SSE 协议
- ❌ 不动 StateHero (它在非 running 状态已经显示, 不需要重复)
- ❌ 不动 12 轮 RoundTimeline (它显示 simulation 内部进度, 7 步是 simulation 之前的阶段)
- ❌ 不实现"点击进度条 step 跳到该阶段" (依赖后端控制流, 风险大)

## 5. 测试 (Testing)

### 5.1 组件单元测试 (`vitest`)
- `StageProgressStrip.test.tsx`: 7 段 status 渲染 / 当前 stage 子进度 / 回环 badge
- `StageProgressPills.test.tsx`: 7 pills 状态映射 / 与 strip 数据一致
- `RightRail.test.tsx`: 新增 2 卡的空态/有数据态

### 5.2 集成测试 (Playwright, 默认 skip)
- 启动 run → 截图 7 步进度条
- 推进到 SIMULATION_RUNNING → 验证子进度更新
- 跨年推进 → 验证回环 badge

### 5.3 视觉验收
- 工作台 1440x900 视口下, 7 步进度条在 ExecSummary 上方独立显示, 不挤压图谱
- SystemLogs 头部 compact pills 与日志流不重叠

## 6. 风险与权衡 (Trade-offs)

| 风险 | 影响 | 缓解 |
|---|---|---|
| 后端可能没在所有 stage_change 都重发 completed_stages | 新订阅者看不到 done 列表 | 已经在 `setSnapshot()` 中通过 REST 拉完整 snapshot, 兜底 |
| StageProgressStrip 增加 80px 会挤压图谱区域 | 图谱可用高度从 520 → 440 | 接受这个权衡, 因为步骤进度是高优信息 |
| RightRail 加 2 卡可能让侧栏过长 | 需要滚动 | 给 RightRail `overflow-y-auto` 已有, 接受滚动 |
| "回环" 检测依赖 year_offset 计数 | 如果用户跨多个 run 比较会混乱 | 仅在单 runId 内计数, runId 切换时 reset |

## 7. 实施步骤 (Implementation Steps)

1. **新增 store selectors**: `useStageProgress()` 返回 `{ stages, currentIndex, isLooping, yearOffset, sub: { round, total } }`
2. **新建 StageProgressStrip.tsx** (新组件, ~120 行)
3. **新建 StageProgressPills.tsx** (新组件, ~60 行, 共享 selectors)
4. **改 WorkbenchLayout.tsx**: 在 StateHero 后插入 StageProgressStrip
5. **改 SystemLogs.tsx**: header 加 StageProgressPills
6. **改 RightRail.tsx**: 加 Section 5 (Active Agents) + Section 6 (Department Activity)
7. **加 i18n keys**: `stageLabels`, `stageProgressTitle`, `departmentActions`, `activeAgents` 等
8. **写单元测试**: 3 个新组件测试文件
9. **跑测试**: `cd frontend && npm run test`
10. **手动验收**: `npm run dev` + 启动一个 run, 截图比对

## 8. 完成定义 (Definition of Done)

- [ ] `StageProgressStrip` 在工作台顶部显示, 7 段状态正确
- [ ] `StageProgressPills` 在 SystemLogs 头部显示
- [ ] SIMULATION_RUNNING 阶段子进度 (round N/M) 正确更新
- [ ] 跨年后回环 badge 显示
- [ ] RightRail 新增 2 卡在推演初段有 placeholder, 数据流入后正常渲染
- [ ] 单元测试全过, 集成测试默认 skip 不影响
- [ ] 浏览器 console 无 React 警告
- [ ] 工作台 1440x900 视口下布局不挤压图谱区域
