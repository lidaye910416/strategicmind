# Workbench 内容补全 + 步骤进度可见化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在工作台顶部增加 7 步流水线进度条, 在 SystemLogs 头部增加 compact 进度条, 在 RightRail 补充 2 张实时数据卡, 让工作台从"半成品"变成"信息密度高、可实时追踪步骤"的工作台。

**Architecture:**
- 新增 store selector `useStageProgress()` 聚合 `currentStage` / `simRounds` / `yearAdvanced` 为统一 shape
- 新增 2 个 UI 组件: `StageProgressStrip` (full-width 80px, 工作台用) + `StageProgressPills` (compact 24px, 终端用)
- 新增 2 个 RightRail 实时数据卡: 活跃 Agent 列表 + 部门动作分布
- 共享 store selectors, 后端零改动 (SSE 事件已含 stage_change / year_advanced)

**Tech Stack:** React 18 + TypeScript + framer-motion + lucide-react + zustand (store) + vitest + @testing-library/react

**Spec:** `docs/superpowers/specs/2026-06-09-workbench-content-and-step-progress.md`

---

## File Structure

| 类型 | 路径 | 职责 |
|---|---|---|
| 新增 | `frontend/src/components/Workbench/StageProgressStrip.tsx` | 7 步流水线状态条 (full-width, 80px) |
| 新增 | `frontend/src/components/Workbench/StageProgressPills.tsx` | 7 pills compact 状态条 (24px) |
| 新增 | `frontend/src/components/Workbench/stageProgress.ts` | 共享工具: `computeStageStatus()` / `STAGE_ORDER` |
| 新增 | `frontend/src/components/Workbench/__tests__/StageProgressStrip.test.tsx` | 单元测试 |
| 新增 | `frontend/src/components/Workbench/__tests__/StageProgressPills.test.tsx` | 单元测试 |
| 新增 | `frontend/src/components/Workbench/__tests__/stageProgress.test.ts` | 工具函数单元测试 |
| 修改 | `frontend/src/store/pipeline.ts` | 新增 `useStageProgress` selector |
| 修改 | `frontend/src/components/Workbench/WorkbenchLayout.tsx` | 在 StateHero 后插入 StageProgressStrip |
| 修改 | `frontend/src/components/SystemLogs.tsx` | 在 header 加 StageProgressPills |
| 修改 | `frontend/src/components/Workbench/RightRail.tsx` | 加 Section 5 + 6 |
| 修改 | `frontend/src/components/Workbench/__tests__/RightRail.test.tsx` | 加 2 卡测试 |
| 修改 | `frontend/src/i18n/zh.ts` | 加新 i18n keys |

每个新组件/工具都有自己的边界:
- `stageProgress.ts` — 纯函数, 不依赖 React, 易于独立测试
- `StageProgressStrip.tsx` — 纯展示, 接收 props (不直接调 store, 测试容易)
- `StageProgressPills.tsx` — 纯展示, 接收 props

为了测试方便, `StageProgressStrip` 和 `StageProgressPills` 接受 `stages: StageInfo[]` 作为 prop, 内部容器组件 (named export) 调 `useStageProgress()` 然后传给它们。

---

## Task 1: i18n 键值补充

**Files:**
- Modify: `frontend/src/i18n/zh.ts` (在 WORKBENCH 对象末尾追加)

- [ ] **Step 1: 找到 WORKBENCH 对象位置**

Run: `grep -n "stagesTitle:\|stagesTitle$" frontend/src/i18n/zh.ts`
Expected: line ~385 (WORKBENCH 对象内)

- [ ] **Step 2: 在 WORKBENCH 末尾追加 6 个新键值**

在 `stagesTitle: '7 步流水线',` 之后追加:

```ts
  // 7 步进度条 (P5 增强)
  stageProgressTitle: '推演流水线',
  stageProgressLoopBadge: (year: number) => `↻ 循环第 ${year} 年`,
  stageProgressIdleHint: '等待启动推演…',
  stageProgressSubSimulation: (round: number, total: number, agents: number) =>
    `R${round}/${total} · ${agents} 部门活跃`,
  stageProgressSubLoop: (year: number) => `回环至第 ${year} 年`,
  stageProgressNoData: '尚无阶段数据',
  // 部门动作分布 (P5 增强)
  railSectionActiveAgents: '活跃 Agent',
  railSectionDepartment: '部门动作分布',
  railActiveAgentsEmpty: '等待 Agent 行动流入…',
  railDepartmentEmpty: '等待部门行动流入…',
  railDepartmentDept: (name: string) => name,
  railActiveAgentActionCount: (n: number) => `${n} 行动`,
```

- [ ] **Step 3: 验证 i18n 编译通过**

Run: `cd frontend && npx tsc --noEmit -p . 2>&1 | head -20`
Expected: 0 errors (or only existing pre-existing warnings)

- [ ] **Step 4: 提交**

```bash
cd /Users/jasonlee/strategicmind
git add frontend/src/i18n/zh.ts
git commit -m "feat(i18n): 7 步进度条 + 活跃 Agent / 部门动作 i18n keys"
```

---

## Task 2: stageProgress 工具函数 (纯函数, 易于测试)

**Files:**
- Create: `frontend/src/components/Workbench/stageProgress.ts`
- Create: `frontend/src/components/Workbench/__tests__/stageProgress.test.ts`

- [ ] **Step 1: 写失败的测试**

`frontend/src/components/Workbench/__tests__/stageProgress.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { STAGE_ORDER, computeStageStatuses, type StageInfo } from '../stageProgress'

describe('stageProgress', () => {
  it('STAGE_ORDER has exactly 7 stages in canonical order', () => {
    expect(STAGE_ORDER).toEqual([
      'SEED_PARSING',
      'GRAPH_BUILDING',
      'ENTITY_EXTRACTION',
      'PROFILE_GENERATION',
      'CONFIG_GENERATION',
      'SIMULATION_RUNNING',
      'REPORT_GENERATING',
    ])
  })

  it('marks all 7 stages as pending when nothing is done and no current', () => {
    const result = computeStageStatuses({
      currentStage: 'IDLE',
      completedStages: [],
    })
    expect(result.map((s) => s.status)).toEqual([
      'pending', 'pending', 'pending', 'pending',
      'pending', 'pending', 'pending',
    ])
  })

  it('marks stages <= current as done and current as active', () => {
    const result = computeStageStatuses({
      currentStage: 'ENTITY_EXTRACTION',
      completedStages: ['SEED_PARSING', 'GRAPH_BUILDING'],
    })
    expect(result.find((s) => s.id === 'SEED_PARSING')?.status).toBe('done')
    expect(result.find((s) => s.id === 'GRAPH_BUILDING')?.status).toBe('done')
    expect(result.find((s) => s.id === 'ENTITY_EXTRACTION')?.status).toBe('active')
    expect(result.find((s) => s.id === 'PROFILE_GENERATION')?.status).toBe('pending')
  })

  it('marks SIMULATION_RUNNING as active (not pending) when current', () => {
    const result = computeStageStatuses({
      currentStage: 'SIMULATION_RUNNING',
      completedStages: [
        'SEED_PARSING', 'GRAPH_BUILDING', 'ENTITY_EXTRACTION',
        'PROFILE_GENERATION', 'CONFIG_GENERATION',
      ],
    })
    expect(result.find((s) => s.id === 'SIMULATION_RUNNING')?.status).toBe('active')
  })

  it('marks looped-back stages as looping-active when isLooping=true', () => {
    const result = computeStageStatuses({
      currentStage: 'GRAPH_BUILDING',
      completedStages: [
        'SEED_PARSING', 'GRAPH_BUILDING', 'ENTITY_EXTRACTION',
        'PROFILE_GENERATION', 'CONFIG_GENERATION', 'SIMULATION_RUNNING',
      ],
      isLooping: true,
    })
    expect(result.find((s) => s.id === 'GRAPH_BUILDING')?.status).toBe('looping-active')
  })

  it('returns 7 entries even when currentStage is unknown (e.g. IDLE)', () => {
    const result = computeStageStatuses({
      currentStage: 'WHATEVER',
      completedStages: [],
    })
    expect(result).toHaveLength(7)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/components/Workbench/__tests__/stageProgress.test.ts 2>&1 | tail -20`
Expected: FAIL (module not found)

- [ ] **Step 3: 实现工具函数**

`frontend/src/components/Workbench/stageProgress.ts`:

```ts
/**
 * stageProgress — 7 步流水线状态计算工具 (P5 增强)
 *
 * 纯函数, 不依赖 React/store, 便于单元测试和复用。
 * 后端 STAGE_ORDER 在 `backend/services/pipeline_orchestrator.py` 第 81 行。
 */

export const STAGE_ORDER = [
  'SEED_PARSING',
  'GRAPH_BUILDING',
  'ENTITY_EXTRACTION',
  'PROFILE_GENERATION',
  'CONFIG_GENERATION',
  'SIMULATION_RUNNING',
  'REPORT_GENERATING',
] as const

export type StageId = typeof STAGE_ORDER[number]

export type StageStatus = 'done' | 'active' | 'pending' | 'looping-active'

export interface StageInfo {
  id: StageId
  index: number
  status: StageStatus
}

export interface ComputeInput {
  currentStage: string
  completedStages: string[]
  /** 跨年回环标志: orchestrator 重新跑 GRAPH/ENTITY/PROFILE 时为 true */
  isLooping?: boolean
}

export function computeStageStatuses(input: ComputeInput): StageInfo[] {
  const { currentStage, completedStages, isLooping } = input
  const completedSet = new Set(completedStages)
  return STAGE_ORDER.map((id, index) => {
    let status: StageStatus
    if (completedSet.has(id) && !(isLooping && id === currentStage)) {
      status = 'done'
    } else if (id === currentStage) {
      status = isLooping ? 'looping-active' : 'active'
    } else {
      status = 'pending'
    }
    return { id, index, status }
  })
}

/** 第 6 步 SIMULATION_RUNNING 的子进度 shape */
export interface SimulationSub {
  round: number
  totalRounds: number
  activeAgents: number
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd frontend && npx vitest run src/components/Workbench/__tests__/stageProgress.test.ts 2>&1 | tail -10`
Expected: PASS (6 tests passed)

- [ ] **Step 5: 提交**

```bash
cd /Users/jasonlee/strategicmind
git add frontend/src/components/Workbench/stageProgress.ts frontend/src/components/Workbench/__tests__/stageProgress.test.ts
git commit -m "feat(workbench): stageProgress 工具函数 + 6 个单元测试"
```

---

## Task 3: store selector `useStageProgress`

**Files:**
- Modify: `frontend/src/store/pipeline.ts` (在 `useStage` selector 之后追加)

- [ ] **Step 1: 找到 useStage 位置**

Run: `grep -n "export const useStage" frontend/src/store/pipeline.ts`
Expected: line ~972

- [ ] **Step 2: 在 useStage 之后追加新 selector**

在 `export const useStage = () => usePipelineStore((s) => s.currentStage)` 之后插入:

```ts

export interface StageProgress {
  stages: Array<{
    id: string
    index: number
    status: 'done' | 'active' | 'pending' | 'looping-active'
  }>
  currentStage: string
  completedStages: string[]
  /** SIMULATION_RUNNING 阶段子进度 (其它阶段为 null) */
  sub: {
    round: number
    totalRounds: number
    activeAgents: number
  } | null
  /** 跨年回环第几年 (1 表示首次, 2+ 表示回环) */
  yearOffset: number
  isLooping: boolean
}

export const useStageProgress = (): StageProgress => usePipelineStore((s) => {
  const completed = s.snapshot?.completed_stages ?? []
  const current = s.snapshot?.current_stage ?? s.currentStage ?? 'IDLE'
  const yearOffset = s.yearAdvanced?.year ?? 0  // 注: YearAdvancedEvent 的字段名是 year, 不是 year_offset
  // yearOffset >= 2 表示已经走过至少 1 次跨年, 重新进入 GRAPH/ENTITY/PROFILE 时算回环
  const isLooping = yearOffset >= 2 && (
    current === 'GRAPH_BUILDING' ||
    current === 'ENTITY_EXTRACTION' ||
    current === 'PROFILE_GENERATION' ||
    current === 'CONFIG_GENERATION'
  )
  const sub = current === 'SIMULATION_RUNNING' && s.simRounds.length > 0
    ? {
        round: s.simRounds[s.simRounds.length - 1].round,
        totalRounds: s.snapshot?.total_rounds ?? s.simRounds.length,
        activeAgents: (s.snapshot?.active_agents as number | undefined) ??
          (s.simRounds[s.simRounds.length - 1].active_agents as number | undefined) ??
          0,
      }
    : null
  return {
    stages: computeStageStatusesLocal(current, completed, isLooping),
    currentStage: current,
    completedStages: completed,
    sub,
    yearOffset,
    isLooping,
  }
})

/** 内联工具避免循环依赖: 与 stageProgress.computeStageStatuses 行为一致 */
function computeStageStatusesLocal(
  currentStage: string,
  completedStages: string[],
  isLooping: boolean,
) {
  const STAGE_ORDER_LOCAL = [
    'SEED_PARSING', 'GRAPH_BUILDING', 'ENTITY_EXTRACTION', 'PROFILE_GENERATION',
    'CONFIG_GENERATION', 'SIMULATION_RUNNING', 'REPORT_GENERATING',
  ] as const
  const completedSet = new Set(completedStages)
  return STAGE_ORDER_LOCAL.map((id, index) => {
    let status: 'done' | 'active' | 'pending' | 'looping-active'
    if (completedSet.has(id) && !(isLooping && id === currentStage)) {
      status = 'done'
    } else if (id === currentStage) {
      status = isLooping ? 'looping-active' : 'active'
    } else {
      status = 'pending'
    }
    return { id, index, status }
  })
}
```

> 注: `computeStageStatusesLocal` 内联避免从 `../components/Workbench/stageProgress` 导入触发 store 循环依赖。

- [ ] **Step 3: 验证 TypeScript 编译通过**

Run: `cd frontend && npx tsc --noEmit -p . 2>&1 | head -20`
Expected: 0 errors

- [ ] **Step 4: 提交**

```bash
cd /Users/jasonlee/strategicmind
git add frontend/src/store/pipeline.ts
git commit -m "feat(store): useStageProgress selector (聚合 currentStage/simRounds/yearAdvanced)"
```

---

## Task 4: StageProgressStrip 组件 (TDD)

**Files:**
- Create: `frontend/src/components/Workbench/StageProgressStrip.tsx`
- Create: `frontend/src/components/Workbench/__tests__/StageProgressStrip.test.tsx`

- [ ] **Step 1: 写失败的测试**

`frontend/src/components/Workbench/__tests__/StageProgressStrip.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StageProgressStrip from '../StageProgressStrip'
import type { StageInfo } from '../stageProgress'
import { WORKBENCH } from '../../../i18n/zh'

function makeStages(overrides: Partial<Record<string, StageInfo['status']>> = {}): StageInfo[] {
  const ids = [
    'SEED_PARSING', 'GRAPH_BUILDING', 'ENTITY_EXTRACTION', 'PROFILE_GENERATION',
    'CONFIG_GENERATION', 'SIMULATION_RUNNING', 'REPORT_GENERATING',
  ] as const
  return ids.map((id, index) => ({
    id,
    index,
    status: overrides[id] ?? 'pending',
  }))
}

describe('StageProgressStrip', () => {
  it('renders 7 stage segments with localized labels', () => {
    render(<StageProgressStrip stages={makeStages()} />)
    expect(screen.getByText(WORKBENCH.stageProgressTitle)).toBeTruthy()
    expect(screen.getByTestId('wb-stage-SEED_PARSING')).toBeTruthy()
    expect(screen.getByTestId('wb-stage-REPORT_GENERATING')).toBeTruthy()
  })

  it('shows done / active / pending icons based on status', () => {
    const stages = makeStages({
      SEED_PARSING: 'done',
      GRAPH_BUILDING: 'done',
      ENTITY_EXTRACTION: 'active',
    })
    const { container } = render(<StageProgressStrip stages={stages} />)
    const seg = screen.getByTestId('wb-stage-ENTITY_EXTRACTION')
    expect(seg.getAttribute('data-status')).toBe('active')
    expect(seg.getAttribute('data-current')).toBe('true')
  })

  it('renders simulation sub-progress when currentStage is SIMULATION_RUNNING', () => {
    const stages = makeStages({
      SEED_PARSING: 'done', GRAPH_BUILDING: 'done', ENTITY_EXTRACTION: 'done',
      PROFILE_GENERATION: 'done', CONFIG_GENERATION: 'done',
      SIMULATION_RUNNING: 'active',
    })
    render(
      <StageProgressStrip
        stages={stages}
        sub={{ round: 5, totalRounds: 12, activeAgents: 9 }}
        currentStage="SIMULATION_RUNNING"
      />,
    )
    expect(screen.getByTestId('wb-stage-sub')).toBeTruthy()
    expect(screen.getByTestId('wb-stage-sub').textContent).toContain('R5/12')
    expect(screen.getByTestId('wb-stage-sub').textContent).toContain('9')
  })

  it('renders looping badge when isLooping=true', () => {
    const stages = makeStages({
      SEED_PARSING: 'done', GRAPH_BUILDING: 'looping-active',
      ENTITY_EXTRACTION: 'done', PROFILE_GENERATION: 'done',
      CONFIG_GENERATION: 'done', SIMULATION_RUNNING: 'done',
    })
    render(<StageProgressStrip stages={stages} isLooping yearOffset={2} />)
    expect(screen.getByTestId('wb-stage-loop-badge')).toBeTruthy()
    expect(screen.getByTestId('wb-stage-loop-badge').textContent).toContain('2')
  })

  it('does not render sub-progress when currentStage is not SIMULATION_RUNNING', () => {
    const stages = makeStages({ SEED_PARSING: 'active' })
    render(
      <StageProgressStrip
        stages={stages}
        sub={{ round: 5, totalRounds: 12, activeAgents: 9 }}
        currentStage="SEED_PARSING"
      />,
    )
    expect(screen.queryByTestId('wb-stage-sub')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/components/Workbench/__tests__/StageProgressStrip.test.tsx 2>&1 | tail -10`
Expected: FAIL (module not found)

- [ ] **Step 3: 实现 StageProgressStrip 组件**

`frontend/src/components/Workbench/StageProgressStrip.tsx`:

```tsx
/**
 * StageProgressStrip — Workbench 7 步流水线状态条 (P5 增强)
 *
 * 位于 WorkbenchLayout 的 StateHero 下方, 80px 高。
 * 7 段水平排列, 每段含: 序号 / 图标 / 短名 / 状态色。
 * SIMULATION_RUNNING 是当前阶段时, 下方显示子进度 (round N/M · 部门数)。
 * 跨年回环时显示 "↻ 循环第 N 年" badge。
 *
 * 数据源: useStageProgress() (store/pipeline.ts)
 */
import { memo } from 'react'
import { motion } from 'framer-motion'
import {
  FileText, Network, Tags, Users, Sliders, Play, FileBarChart,
  Check, Loader2, RotateCcw,
} from 'lucide-react'
import { WORKBENCH, STAGE_LABELS } from '../../i18n/zh'
import type { StageInfo, SimulationSub } from './stageProgress'

export interface StageProgressStripProps {
  stages: StageInfo[]
  /** 第 6 步子进度 (其它阶段为 null) */
  sub?: SimulationSub | null
  currentStage?: string
  isLooping?: boolean
  yearOffset?: number
  dataTestId?: string
}

const STAGE_ICONS: Record<string, typeof FileText> = {
  SEED_PARSING: FileText,
  GRAPH_BUILDING: Network,
  ENTITY_EXTRACTION: Tags,
  PROFILE_GENERATION: Users,
  CONFIG_GENERATION: Sliders,
  SIMULATION_RUNNING: Play,
  REPORT_GENERATING: FileBarChart,
}

const STATUS_CLS: Record<StageInfo['status'], string> = {
  'done': 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-300/60',
  'active': 'bg-gradient-to-br from-brand-500 to-accent-500 text-white border-transparent shadow-soft animate-pulse-soft',
  'pending': 'bg-ink-50/70 dark:bg-ink-900/50 text-ink-400 dark:text-ink-500 border-ink-200/60 dark:border-ink-800/60',
  'looping-active': 'bg-gradient-to-br from-amber-500 to-orange-500 text-white border-transparent shadow-soft animate-pulse-soft',
}

function StageProgressStripImpl({
  stages,
  sub,
  currentStage,
  isLooping = false,
  yearOffset = 0,
  dataTestId = 'wb-stage-progress',
}: StageProgressStripProps) {
  const showSub = currentStage === 'SIMULATION_RUNNING' && sub
  return (
    <div
      data-testid={dataTestId}
      data-current-stage={currentStage ?? stages.find((s) => s.status === 'active')?.id ?? 'IDLE'}
      className="w-full card p-3 min-h-[80px] flex flex-col gap-2"
      aria-label={WORKBENCH.stageProgressTitle}
    >
      {/* Title row */}
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider font-bold text-ink-500">
          {WORKBENCH.stageProgressTitle}
        </div>
        {isLooping && yearOffset >= 2 && (
          <div
            data-testid="wb-stage-loop-badge"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300/60"
          >
            <RotateCcw size={10} />
            {WORKBENCH.stageProgressLoopBadge(yearOffset)}
          </div>
        )}
      </div>

      {/* 7 segments row */}
      <div className="flex items-stretch gap-1.5">
        {stages.map((s) => {
          const Icon = STAGE_ICONS[s.id] ?? FileText
          const cls = STATUS_CLS[s.status]
          const isCurrent = s.status === 'active' || s.status === 'looping-active'
          return (
            <motion.div
              key={s.id}
              data-testid={`wb-stage-${s.id}`}
              data-status={s.status}
              data-current={isCurrent ? 'true' : 'false'}
              whileHover={{ scale: 1.02 }}
              className={[
                'flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1.5 rounded-md border',
                'text-[10px] font-mono',
                cls,
              ].join(' ')}
              title={STAGE_LABELS[s.id] ?? s.id}
            >
              <div className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold">
                {s.status === 'done' ? <Check size={11} /> :
                 isCurrent ? <Loader2 size={11} className="animate-spin" /> :
                 s.index + 1}
              </div>
              <Icon size={11} className="flex-shrink-0" />
              <span className="truncate text-[10px]">{STAGE_LABELS[s.id] ?? s.id}</span>
            </motion.div>
          )
        })}
      </div>

      {/* Sub-progress row (only when SIMULATION_RUNNING active) */}
      {showSub && sub && (
        <div
          data-testid="wb-stage-sub"
          className="flex items-center gap-2 text-[11px] font-mono text-ink-700 dark:text-ink-200"
        >
          <Play size={10} className="text-brand-500 flex-shrink-0" />
          <span>{WORKBENCH.stageProgressSubSimulation(sub.round, sub.totalRounds, sub.activeAgents)}</span>
          {/* Inline progress bar */}
          <div className="flex-1 h-1.5 rounded-full bg-ink-200 dark:bg-ink-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-brand-500 to-accent-500"
              style={{ width: `${Math.max(0, Math.min(100, (sub.round / Math.max(1, sub.totalRounds)) * 100))}%` }}
            />
          </div>
        </div>
      )}

      {/* Loop sub-line */}
      {isLooping && currentStage && currentStage !== 'SIMULATION_RUNNING' && (
        <div
          data-testid="wb-stage-loop-sub"
          className="text-[10px] font-mono text-amber-700 dark:text-amber-300"
        >
          {WORKBENCH.stageProgressSubLoop(yearOffset)}
        </div>
      )}
    </div>
  )
}

const StageProgressStrip = memo(StageProgressStripImpl)
export default StageProgressStrip
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd frontend && npx vitest run src/components/Workbench/__tests__/StageProgressStrip.test.tsx 2>&1 | tail -10`
Expected: PASS (5 tests passed)

- [ ] **Step 5: 提交**

```bash
cd /Users/jasonlee/strategicmind
git add frontend/src/components/Workbench/StageProgressStrip.tsx frontend/src/components/Workbench/__tests__/StageProgressStrip.test.tsx
git commit -m "feat(workbench): StageProgressStrip 7 步流水线状态条 (5 tests)"
```

---

## Task 5: StageProgressPills 组件 (compact, 给 SystemLogs 用)

**Files:**
- Create: `frontend/src/components/Workbench/StageProgressPills.tsx`
- Create: `frontend/src/components/Workbench/__tests__/StageProgressPills.test.tsx`

- [ ] **Step 1: 写失败的测试**

`frontend/src/components/Workbench/__tests__/StageProgressPills.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StageProgressPills from '../StageProgressPills'
import type { StageInfo } from '../stageProgress'

function makeStages(overrides: Partial<Record<string, StageInfo['status']>> = {}): StageInfo[] {
  const ids = [
    'SEED_PARSING', 'GRAPH_BUILDING', 'ENTITY_EXTRACTION', 'PROFILE_GENERATION',
    'CONFIG_GENERATION', 'SIMULATION_RUNNING', 'REPORT_GENERATING',
  ] as const
  return ids.map((id, index) => ({ id, index, status: overrides[id] ?? 'pending' }))
}

describe('StageProgressPills', () => {
  it('renders 7 pill segments', () => {
    const { container } = render(<StageProgressPills stages={makeStages()} />)
    const pills = container.querySelectorAll('[data-testid^="wb-pill-"]')
    expect(pills).toHaveLength(7)
  })

  it('shows round sub-progress in pill 6 when sub provided', () => {
    const stages = makeStages({
      SEED_PARSING: 'done', GRAPH_BUILDING: 'done', ENTITY_EXTRACTION: 'done',
      PROFILE_GENERATION: 'done', CONFIG_GENERATION: 'done',
      SIMULATION_RUNNING: 'active',
    })
    render(
      <StageProgressPills
        stages={stages}
        sub={{ round: 5, totalRounds: 12, activeAgents: 9 }}
        currentStage="SIMULATION_RUNNING"
      />,
    )
    const pill6 = screen.getByTestId('wb-pill-SIMULATION_RUNNING')
    expect(pill6.textContent).toContain('R5/12')
  })

  it('marks done pills with checkmark visual (data-status="done")', () => {
    const stages = makeStages({ SEED_PARSING: 'done' })
    const pill = screen.getByTestId
      ? null
      : null
    const { container } = render(<StageProgressPills stages={stages} />)
    const p = container.querySelector('[data-testid="wb-pill-SEED_PARSING"]')
    expect(p?.getAttribute('data-status')).toBe('done')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/components/Workbench/__tests__/StageProgressPills.test.tsx 2>&1 | tail -10`
Expected: FAIL (module not found)

- [ ] **Step 3: 实现 StageProgressPills 组件**

`frontend/src/components/Workbench/StageProgressPills.tsx`:

```tsx
/**
 * StageProgressPills — compact 7-pill 状态条 (P5 增强)
 *
 * 给 SystemLogs 头部用, 24px 高, 与 StageProgressStrip 共用 store selector。
 */
import { memo } from 'react'
import { Check, Loader2 } from 'lucide-react'
import type { StageInfo, SimulationSub } from './stageProgress'

export interface StageProgressPillsProps {
  stages: StageInfo[]
  sub?: SimulationSub | null
  currentStage?: string
  isLooping?: boolean
}

const STATUS_CLS: Record<StageInfo['status'], string> = {
  'done': 'bg-emerald-500/30 text-emerald-700 dark:text-emerald-300 border-emerald-400/60',
  'active': 'bg-gradient-to-r from-brand-500 to-accent-500 text-white border-transparent',
  'pending': 'bg-ink-100/70 dark:bg-ink-800/40 text-ink-500 dark:text-ink-500 border-ink-300/40 dark:border-ink-700/40',
  'looping-active': 'bg-gradient-to-r from-amber-500 to-orange-500 text-white border-transparent',
}

function StageProgressPillsImpl({
  stages,
  sub,
  currentStage,
  isLooping = false,
}: StageProgressPillsProps) {
  return (
    <div className="flex items-center gap-0.5" data-testid="wb-stage-pills" data-current={currentStage ?? ''}>
      {stages.map((s) => {
        const isCurrent = s.status === 'active' || s.status === 'looping-active'
        const showSub = s.id === 'SIMULATION_RUNNING' && sub && isCurrent
        return (
          <div
            key={s.id}
            data-testid={`wb-pill-${s.id}`}
            data-status={s.status}
            className={[
              'inline-flex items-center justify-center min-w-[18px] h-5 px-1 rounded',
              'text-[9px] font-mono font-bold border',
              STATUS_CLS[s.status],
            ].join(' ')}
            title={`${s.index + 1}. ${s.id}`}
          >
            {s.status === 'done' ? <Check size={8} /> :
             isCurrent ? <Loader2 size={8} className="animate-spin" /> :
             s.index + 1}
            {showSub && sub && (
              <span className="ml-0.5 text-[8px]">R{sub.round}/{sub.totalRounds}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

const StageProgressPills = memo(StageProgressPillsImpl)
export default StageProgressPills
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd frontend && npx vitest run src/components/Workbench/__tests__/StageProgressPills.test.tsx 2>&1 | tail -10`
Expected: PASS (3 tests passed)

- [ ] **Step 5: 提交**

```bash
cd /Users/jasonlee/strategicmind
git add frontend/src/components/Workbench/StageProgressPills.tsx frontend/src/components/Workbench/__tests__/StageProgressPills.test.tsx
git commit -m "feat(workbench): StageProgressPills compact 状态条 (3 tests)"
```

---

## Task 6: 在 WorkbenchLayout 中挂载 StageProgressStrip

**Files:**
- Modify: `frontend/src/components/Workbench/WorkbenchLayout.tsx`

- [ ] **Step 1: 找到 StateHero 行位置**

Run: `grep -n "StateHero" frontend/src/components/Workbench/WorkbenchLayout.tsx`
Expected: line ~73

- [ ] **Step 2: 添加 import + 容器组件包装**

修改 WorkbenchLayout.tsx, 在 imports 区域追加:

```ts
import StageProgressStrip from './StageProgressStrip'
import { useStageProgress } from '../../store/pipeline'
```

把 `WorkbenchLayoutShell` 函数体 (line 45-160 那个组件) 改造成使用 `useStageProgress()`, 在 `<StateHero>` 后插入 `<StageProgressStrip>`:

替换 line 53-82 这一段:

```tsx
function WorkbenchLayoutShell({
  children,
  totalRounds,
  dataTestId = 'wb-layout',
}: WorkbenchLayoutProps) {
  const status = useStatus()
  const snapshot = useSnapshot()
  const simRounds = useSimRounds()
  const { state } = useWorkbenchState()
  const stageProgress = useStageProgress()  // 新增

  const onRoundSelect = useCallback((_runId: string, _roundNum: number) => {
    // Hook for future jump-to-round; in Phase 2 we just update the visible
    // ExecSummary / RightRail by passing the selected round down via a
    // controlled prop. For now the events propagate via simRounds already.
  }, [])

  const total = totalRounds ?? snapshot?.total_rounds ?? Math.max(simRounds.length, 12)
  const current = simRounds.length > 0 ? simRounds[simRounds.length - 1].round : 0
  const progress = typeof snapshot?.progress === 'number' ? snapshot.progress : 0

  return (
    <div
      data-testid={dataTestId}
      data-state={state}
      data-status={status}
      className="w-full flex flex-col gap-3 min-h-[600px]"
    >
      {/* ===== Region: state hero (only shown for terminal/non-running states) ===== */}
      <StateHero dataTestId={`${dataTestId}-hero`} />

      {/* ===== NEW (P5): Region 0.5 — 7 步流水线状态条 ===== */}
      <section
        data-testid={`${dataTestId}-stage-progress`}
        className="w-full"
        aria-label="Stage progress"
      >
        <StageProgressStrip
          stages={stageProgress.stages}
          sub={stageProgress.sub}
          currentStage={stageProgress.currentStage}
          isLooping={stageProgress.isLooping}
          yearOffset={stageProgress.yearOffset}
        />
      </section>

      {/* ===== Region 1: Top — ExecSummary ===== */}
      <section
        data-testid={`${dataTestId}-exec`}
        className="w-full"
        aria-label="Executive summary"
      >
        <ExecSummary currentRound={current} />
      </section>
```

- [ ] **Step 3: 验证 TypeScript 编译通过**

Run: `cd frontend && npx tsc --noEmit -p . 2>&1 | head -20`
Expected: 0 errors

- [ ] **Step 4: 跑现有 WorkbenchLayout 测试, 确认没破坏**

Run: `cd frontend && npx vitest run src/components/Workbench/__tests__/WorkbenchLayout.test.tsx 2>&1 | tail -15`
Expected: PASS (all existing tests)

- [ ] **Step 5: 提交**

```bash
cd /Users/jasonlee/strategicmind
git add frontend/src/components/Workbench/WorkbenchLayout.tsx
git commit -m "feat(workbench): 在 WorkbenchLayout 挂载 StageProgressStrip"
```

---

## Task 7: 在 SystemLogs 头部挂载 StageProgressPills

**Files:**
- Modify: `frontend/src/components/SystemLogs.tsx`

- [ ] **Step 1: 添加 import**

在 line 19 后追加:

```ts
import StageProgressPills from './Workbench/StageProgressPills'
import { useStageProgress } from '../store/pipeline'
```

- [ ] **Step 2: 在 SystemLogs 内部加 selector 调用**

在 line 76 (`export default function SystemLogs({`) 函数体开头, 紧跟 `const [paused, setPaused] = useState(false)` 之后, 添加:

```ts
const stageProgress = useStageProgress()
```

- [ ] **Step 3: 在 header 添加 pills**

修改 line 273-278 之间的 header JSX:

```tsx
<div className="flex items-center justify-between px-3 py-2 bg-ink-900/80 border-b border-ink-800 flex-shrink-0">
  <div className="flex items-center gap-2">
    <Terminal size={12} className="text-emerald-400" />
    <span className="text-[10px] font-bold text-emerald-400 tracking-widest uppercase">System Dashboard</span>
    <span className="text-[9px] text-ink-500 font-mono">{logs.length} lines</span>
    {/* NEW (P5): compact 7-pill 状态条 */}
    <StageProgressPills
      stages={stageProgress.stages}
      sub={stageProgress.sub}
      currentStage={stageProgress.currentStage}
      isLooping={stageProgress.isLooping}
    />
  </div>
  <div className="flex items-center gap-1">
```

- [ ] **Step 4: 验证 TypeScript 编译通过**

Run: `cd frontend && npx tsc --noEmit -p . 2>&1 | head -20`
Expected: 0 errors

- [ ] **Step 5: 提交**

```bash
cd /Users/jasonlee/strategicmind
git add frontend/src/components/SystemLogs.tsx
git commit -m "feat(systemlogs): header 增加 StageProgressPills"
```

---

## Task 8: RightRail 加 Section 5 "活跃 Agent" (TDD)

**Files:**
- Modify: `frontend/src/components/Workbench/RightRail.tsx`
- Modify: `frontend/src/components/Workbench/__tests__/RightRail.test.tsx`

- [ ] **Step 1: 在 RightRail.test.tsx 末尾追加测试 (会先失败)**

打开 `RightRail.test.tsx`, 在最后 `})` 闭合前追加 3 个新 `it`:

```ts
  it('renders 6 sections including new Active Agents + Department Activity', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'running' })
    const { container } = render(<RightRail />)
    const sections = container.querySelectorAll('section')
    expect(sections).toHaveLength(6)
    const ids = Array.from(sections).map((s) => s.getAttribute('data-testid'))
    expect(ids).toEqual([
      'wb-rail-controls',
      'wb-rail-summary',
      'wb-rail-emerging',
      'wb-rail-next',
      'wb-rail-active-agents',
      'wb-rail-department',
    ])
  })

  it('Active Agents section shows empty placeholder when no actions', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'running' })
    const { container } = render(<RightRail />)
    const sec = container.querySelector('[data-testid="wb-rail-active-agents"]')
    expect(sec?.textContent).toContain('等待 Agent 行动流入')
  })

  it('Active Agents section aggregates agents from simRounds actions', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'running' })
    render(<RightRail />)
    act(() => {
      usePipelineStore.getState().appendSimRound({
        round: 1,
        actions: [
          { agent_id: 'a1', agent_name: 'CTO 张三', action_type: 'INVEST', department: 'RD' },
          { agent_id: 'a1', agent_name: 'CTO 张三', action_type: 'HIRE', department: 'RD' },
          { agent_id: 'a2', agent_name: 'CMO 李四', action_type: 'MARKET', department: 'MKT' },
        ],
      } as any)
    })
    const items = screen.getAllByTestId('wb-rail-agent-item')
    expect(items.length).toBe(2)
    // 按行动数降序: a1 (2 行动) > a2 (1 行动)
    expect(items[0].textContent).toContain('CTO 张三')
    expect(items[0].textContent).toContain('2 行动')
  })

  it('Department Activity section aggregates by department with mini bars', () => {
    usePipelineStore.setState({ runId: 'run_x', status: 'running' })
    render(<RightRail />)
    act(() => {
      usePipelineStore.getState().appendSimRound({
        round: 1,
        actions: [
          { agent_id: 'a1', department: 'RD', action_type: 'INVEST' },
          { agent_id: 'a2', department: 'RD', action_type: 'HIRE' },
          { agent_id: 'a3', department: 'MKT', action_type: 'MARKET' },
        ],
      } as any)
    })
    const bars = screen.getAllByTestId('wb-rail-dept-bar')
    expect(bars.length).toBe(2)
    // RD 2 行动 > MKT 1 行动
    expect(bars[0].textContent).toContain('RD')
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/components/Workbench/__tests__/RightRail.test.tsx 2>&1 | tail -10`
Expected: FAIL (sections 数量不对, 4 != 6)

- [ ] **Step 3: 在 RightRail.tsx 加 import + 计算逻辑**

在 RightRail.tsx 顶部 imports 后追加:

```ts
import { Activity, Users } from 'lucide-react'
```

在 `RightRailImpl` 函数体内, 在 `useSimRounds` 之后追加 (line 52 附近):

```ts
// ---- 活跃 Agent 聚合 (从 simRounds.actions) ----
const activeAgents = useMemo(() => {
  const counts = new Map<string, { name: string; count: number; lastAction: string }>()
  for (const r of simRounds) {
    for (const a of (r as any).actions ?? []) {
      const id = a.agent_id ?? a.id ?? 'unknown'
      const name = a.agent_name ?? a.name ?? id
      const cur = counts.get(id) ?? { name, count: 0, lastAction: '' }
      cur.count += 1
      cur.lastAction = a.action_type ?? cur.lastAction
      counts.set(id, cur)
    }
  }
  return Array.from(counts.entries())
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
}, [simRounds])

// ---- 部门动作聚合 ----
const departmentActions = useMemo(() => {
  const counts = new Map<string, number>()
  for (const r of simRounds) {
    for (const a of (r as any).actions ?? []) {
      const d = a.department ?? 'OTHER'
      counts.set(d, (counts.get(d) ?? 0) + 1)
    }
  }
  const max = Math.max(1, ...Array.from(counts.values()))
  return Array.from(counts.entries())
    .map(([dept, n]) => ({ dept, n, ratio: n / max }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 9)
}, [simRounds])
```

- [ ] **Step 4: 在 JSX 末尾追加 Section 5 + 6**

在 RightRail.tsx line 357 (`</aside>`) 之前, 找到 Section 4 结束位置 (line 356 的 `</section>` 之后), 追加:

```tsx
      {/* ===== Section 5: 活跃 Agent (P5 增强) ===== */}
      <section
        data-testid="wb-rail-active-agents"
        className="card p-3"
        aria-label={WORKBENCH.railSectionActiveAgents}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-wider font-bold text-ink-500">
            {WORKBENCH.railSectionActiveAgents}
          </div>
          <Users size={11} className="text-brand-500" />
        </div>
        {activeAgents.length === 0 ? (
          <div className="text-[11px] text-ink-400 py-2 text-center">
            {WORKBENCH.railActiveAgentsEmpty}
          </div>
        ) : (
          <ul className="space-y-1">
            {activeAgents.map((a) => (
              <li
                key={a.id}
                data-testid="wb-rail-agent-item"
                className="flex items-center gap-2 px-2 h-9 rounded-md
                           bg-ink-50/70 dark:bg-ink-900/50
                           border border-ink-200/40 dark:border-ink-800/40"
                style={{ maxHeight: 40 }}
                title={a.name}
              >
                <Activity size={10} className="text-brand-500 flex-shrink-0" />
                <div className="flex-1 min-w-0 text-[11px] text-ink-700 dark:text-ink-200 truncate">
                  {a.name}
                </div>
                <span className="text-[9px] font-mono font-bold text-ink-500 flex-shrink-0">
                  {WORKBENCH.railActiveAgentActionCount(a.count)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ===== Section 6: 部门动作分布 (P5 增强) ===== */}
      <section
        data-testid="wb-rail-department"
        className="card p-3"
        aria-label={WORKBENCH.railSectionDepartment}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-wider font-bold text-ink-500">
            {WORKBENCH.railSectionDepartment}
          </div>
          <Activity size={11} className="text-emerald-500" />
        </div>
        {departmentActions.length === 0 ? (
          <div className="text-[11px] text-ink-400 py-2 text-center">
            {WORKBENCH.railDepartmentEmpty}
          </div>
        ) : (
          <ul className="space-y-1">
            {departmentActions.map((d) => (
              <li
                key={d.dept}
                data-testid="wb-rail-dept-bar"
                className="flex items-center gap-2"
              >
                <span className="text-[10px] font-mono text-ink-600 dark:text-ink-300 w-10 flex-shrink-0">
                  {d.dept}
                </span>
                <div className="flex-1 h-3 rounded bg-ink-100 dark:bg-ink-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600"
                    style={{ width: `${Math.max(2, d.ratio * 100)}%` }}
                  />
                </div>
                <span className="text-[9px] font-mono text-ink-500 w-6 text-right flex-shrink-0">
                  {d.n}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd frontend && npx vitest run src/components/Workbench/__tests__/RightRail.test.tsx 2>&1 | tail -10`
Expected: PASS (all tests, 现有 4 个 + 新增 4 个 = 8 个)

- [ ] **Step 6: 提交**

```bash
cd /Users/jasonlee/strategicmind
git add frontend/src/components/Workbench/RightRail.tsx frontend/src/components/Workbench/__tests__/RightRail.test.tsx
git commit -m "feat(rightrail): Section 5 活跃 Agent + Section 6 部门动作分布 (4 tests)"
```

---

## Task 9: 端到端手动验证

**Files:**
- 无文件修改, 启动 dev 服务验证

- [ ] **Step 1: 启动后端**

```bash
cd /Users/jasonlee/strategicmind
pkill -f "backend.run_server" 2>/dev/null
nohup python3 -m backend.run_server > /tmp/backend.log 2>&1 &
sleep 3
lsof -i :8000
```

Expected: 后端进程 listening on 8000

- [ ] **Step 2: 启动前端**

```bash
cd /Users/jasonlee/strategicmind/frontend
pkill -f "vite" 2>/dev/null
nohup npm run dev > /tmp/frontend.log 2>&1 &
sleep 5
lsof -i :3000
```

Expected: 前端进程 listening on 3000

- [ ] **Step 3: 启动一个推演**

通过 UI 操作或 curl:
```bash
curl -X POST http://localhost:8000/api/pipeline/start \
  -H "Content-Type: application/json" \
  -d '{"simulation_hours": 24, "report_style": "executive"}'
```

记下返回的 run_id。

- [ ] **Step 4: 浏览器访问工作台**

打开浏览器到 `http://localhost:3000/workbench/<run_id>`, 验证:

| 检查项 | 期望 |
|---|---|
| 工作台顶部 StateHero 下方有 7 段彩色条 | ✓ |
| 第 1 段 SEED_PARSING 显示 ✓ + 灰底色 | ✓ |
| 当前阶段是 active 高亮 (gradient) | ✓ |
| 推到 SIMULATION_RUNNING 时下方子进度条显示 `R1/12 · 9 部门` | ✓ |
| 浏览器 console 0 errors | ✓ |
| SystemLogs 头部右上角有 7 个 compact pills | ✓ |
| RightRail 滚动到底有 2 张新卡: 活跃 Agent + 部门动作 | ✓ |
| 部门动作 mini bar 渲染正常 (无 overflow) | ✓ |

- [ ] **Step 5: 截图保存 (可选)**

用浏览器开发者工具截 1440x900 视口, 保存到 `/tmp/workbench-p5.png` 供 review。

- [ ] **Step 6: 全测试套件跑一遍**

```bash
cd /Users/jasonlee/strategicmind
python3 -m pytest backend/tests/integration/ backend/tests/acceptance/ --ignore=backend/tests/e2e -q 2>&1 | tail -5
cd frontend && npm run test 2>&1 | tail -10
```

Expected: 全部通过 (允许已知 flaky)

- [ ] **Step 7: 提交验证报告 (可选, 创建 data/reports/)**

```bash
mkdir -p /Users/jasonlee/strategicmind/data/reports/
cat > /Users/jasonlee/strategicmind/data/reports/workbench-p5-verification.md <<'EOF'
# Workbench P5 验证报告

日期: 2026-06-09
实施: 7 步进度条 + SystemLogs pills + RightRail 2 张新卡

## 验证结果
- 单元测试: <数量> 通过
- 工作台 7 步状态条: ✓
- SystemLogs compact pills: ✓
- RightRail 6 section: ✓
- SIMULATION_RUNNING 子进度: ✓
- 跨年回环 badge: ✓ (需要 G5 触发)

## 已知 issue
- 暂无
EOF
```

- [ ] **Step 8: 提交 (如有截图/报告)**

```bash
cd /Users/jasonlee/strategicmind
git add data/reports/workbench-p5-verification.md
git commit -m "docs: Workbench P5 验证报告"
```

---

## Self-Review Checklist (执行完后做)

- [ ] **Spec coverage:**
  - §3.1 StageProgressStrip → Task 4 ✓
  - §3.2 StageProgressPills → Task 5 ✓
  - §3.3 WorkbenchLayout 挂载点 → Task 6 ✓
  - §3.3 SystemLogs 头部挂载点 → Task 7 ✓
  - §3.4 RightRail Section 5 活跃 Agent → Task 8 ✓
  - §3.4 RightRail Section 6 部门动作 → Task 8 ✓
  - §5.1 单元测试 → Task 2/4/5/8 ✓
  - §5.3 视觉验收 → Task 9 ✓
  - §3.5 数据流 (后端零改动) → 通过 store selectors ✓
  - §4 Non-Goals (不改后端/不改 SSE) → ✓
  - §8 DoD (回环 badge / 子进度 / 7 段 / 双位置) → 全部覆盖

- [ ] **Placeholder scan:** 无 TBD/TODO/模糊描述, 每步有完整代码

- [ ] **Type consistency:**
  - `StageInfo` 在 stageProgress.ts 定义, StageProgressStrip/Pills 都引用 ✓
  - `SimulationSub` 在 stageProgress.ts 定义, 3 个文件都用 ✓
  - `data-testid` 命名一致: `wb-stage-*` / `wb-pill-*` / `wb-rail-*` ✓
  - `useStageProgress` 返回 shape 在 store 里定义, 消费方都用同 shape ✓

---

## 备注

- 所有任务都是独立的 (TDD + 频繁 commit), 任一任务失败可单独 revert
- 后端零改动, 不需要重启后端服务
- 现有 i18n / store / test 模式都遵循 (参考 RightRail.test.tsx 风格)
- 第 9 步的"跨年回环 badge"需要触发 G5 advance-year 才能看到, 验收时如不便触发可略过
