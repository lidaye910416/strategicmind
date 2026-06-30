# 让 StrategicMind 拥有 MiroFish 级"时间感"

> **状态**: ✅ APPROVED (2026-06-30)
> **关联**: [`../architecture/mirofish-benchmark.md`](../architecture/mirofish-benchmark.md), [`../architecture/loop-engine-v2.md`](../architecture/loop-engine-v2.md), [`../features/simulation-realism.md`](../features/simulation-realism.md)
> **方案**: A — 加 5 字段 + time_step (零模型破坏)
> **默认 time_step**: `month` (12 rounds = 12 months = 1 year)

---

## 1. Goal

让 StrategicMind 推演给用户 MiroFish 级别的"时间感"：

1. **每 round 是多少真实时间** — 用户能立即说出 "Round 3 = 第 3 个月 / Day 90"
2. **每 round 推进了多少节点/行动** — 图谱不是黑盒，而是按 round 增量可见
3. **图谱节点按 round 染色** — 新出现的节点一眼可见（不是"图谱突然多出 50 个节点"）

不破坏现有数据模型，向后兼容旧 run 快照。

## 2. 背景：MiroFish 对标差距

| 维度 | StrategicMind 现状 | MiroFish 做法 | 差距 |
|---|---|---|---|
| 每 round 实际时长 | `hours_per_round = 24` → 1 round = 1 天 | `minutes_per_round = 30` → 1 round = 30 分钟 | 隐式 |
| 总时长可读性 | "12/12" = 12 天（战略推演太短） | "144/144" = 72 小时 = 3 天 | StrategicMind 12 轮对战略不合身 |
| 每轮 elapsed 时间 | ❌ 无 | ✅ `formatElapsedTime(round × minutesPerRound)` | 缺核心 |
| 每轮 action count | ❌ 无 | ✅ "ACTS 12" | 缺 |
| 每轮节点增长 | ⚠️ 仅 EntityDanmaku 弹幕，无 round 映射 | ✅ Zep 写图 + 增量日志 | 缺可视化 |
| Round 日志格式 | 自由文本 | `R{round}/{total} \| T:{hours}h \| A:{count}` | 无规范 |

**诊断**: backend 数据已经具备（`SimClock` + `hours_per_round` + `world_state_updated`），但 frontend 没显示。同时 `hours_per_round = 24` 让 12 轮对战略维度太短。

## 3. 数据流

```
用户选 time_step=month (默认)
   ↓
StrategicConfigGenerator 算 hours_per_round = 720
   ↓
LoopEngine._execute_round 每轮:
  - clock.advance(720) → simulated_hours_elapsed += 720
  - 算 actions_this_round, nodes_added, edges_added
  - emit SSE event payload 加 5 字段:
      * simulated_hours_elapsed (累加)
      * simulated_label ("Month 3" / "Day 90")
      * actions_this_round
      * nodes_added
      * edges_added
   ↓
前端 useGraphStream 收 event → 写 store
   ↓
3 个新 UI 组件订阅:
  - RoundTimelineStrip 顶部时间轴
  - RoundTimeline 行内摘要
  - EntityDanmaku 浮窗加 "📍 Round N"
```

## 4. 组件

### 4.1 Backend

#### 4.1.1 `SimClock.simulated_label(round, time_step)`

文件：`backend/services/loop/clock.py` (改)

```python
def simulated_label(self, round_num: int, time_step: str) -> str:
    if time_step == "day":
        return f"Day {round_num}"
    if time_step == "week":
        return f"Week {round_num}"
    if time_step == "month":
        return f"Month {round_num}"
    if time_step == "quarter":
        q, year_offset = divmod(round_num - 1, 4)
        return f"Q{(q % 4) + 1} Year {year_offset + 1}"
    if time_step == "year":
        return f"Year {round_num}"
    return f"Round {round_num}"
```

~20 行新增。

#### 4.1.2 LoopEngine event payload 扩展

文件：`backend/services/loop/engine.py:140` (`_execute_round` 的 result dict)

在现有 `{round, type, payload, ...}` 后追加：

```python
# 既有: "round": int(self.round_num), ...
# 新增:
"simulated_hours_elapsed": self.clock.hours_elapsed,
"simulated_label": self.clock.simulated_label(self.round_num, self.time_step),
"actions_this_round": len(actions_emitted),
# 节点/边 delta: LoopEngine 自己维护上一轮计数, 避免依赖 KGIndex 新 API
"nodes_added": self._count_nodes() - self._last_node_count,
"edges_added": self._count_edges() - self._last_edge_count,
```

`self.time_step` 在 `__init__` 注入，默认 `"month"`。

`LoopEngine.__init__` 新增 `self._last_node_count: int = 0`, `self._last_edge_count: int = 0`, `_count_nodes()` / `_count_edges()` 委托给 `self.knowledge_store.num_entities()` / `num_relations()` (KGIndex 已实现, 见 `backend/services/kg_engine/graph_index.py:357-360`)。

每轮 event emit 完更新 `self._last_*_count = 当前值`，下一轮算 delta 时已包含本轮新增。

~40 行新增/改。

#### 4.1.3 `StrategicConfigGenerator` 接受 `time_step`

文件：`backend/services/strategic_config_generator.py` (改)

```python
TIME_STEP_HOURS = {
    "day": 24, "week": 168, "month": 720,
    "quarter": 2160, "year": 8760,
}

def _stage_config_generation(self, req, user_params):
    time_step = user_params.get("time_step", "month")
    hours_per_round = TIME_STEP_HOURS.get(time_step, 720)
    years = user_params.get("years", 1)
    rounds_per_year = {24: 365, 168: 52, 720: 12, 2160: 4, 8760: 1}[hours_per_round]
    max_rounds = years * rounds_per_year
    sim_config.time_step = time_step
    sim_config.hours_per_round = hours_per_round
    sim_config.max_rounds = max_rounds
    # 透传给 Generator
    self._generate_with_user_params(doc, req, user_params)
```

修复 CLAUDE.md "坑 #5": `StrategicConfigGenerator` 派生参数未生效（user_params.years=3 但 max_rounds 仍是 3）。

~40 行新增/改。

### 4.2 Frontend

#### 4.2.1 `useRoundStream()` selector

文件：`frontend/src/store/hooks/useRoundStream.ts` (新)

```typescript
export interface RoundStreamSnapshot {
  currentRound: number;
  totalRounds: number;
  simulatedHours: number;
  simulatedLabel: string;
  actionsThisRound: number;
  nodesAddedThisRound: number;
  edgesAddedThisRound: number;
}

export function useRoundStream(): RoundStreamSnapshot {
  return usePipelineStore((s) => ({
    currentRound: s.worldState?.round_num ?? 0,
    totalRounds: s.worldState?.total_rounds ?? 12,
    simulatedHours: s.worldState?.simulated_hours_elapsed ?? 0,
    simulatedLabel: s.worldState?.simulated_label ?? "",
    actionsThisRound: s.worldState?.actions_this_round ?? 0,
    nodesAddedThisRound: s.worldState?.nodes_added ?? 0,
    edgesAddedThisRound: s.worldState?.edges_added ?? 0,
  }));
}
```

~40 行。

#### 4.2.2 `<RoundTimelineStrip />`

文件：`frontend/src/components/RoundTimelineStrip.tsx` (新)

布局：横向 pill 列表，12 个 round 一行排开。

```tsx
<div className="flex gap-1 overflow-x-auto py-2 px-4 bg-bg-elevated">
  {Array.from({length: totalRounds}).map((_, i) => {
    const n = i + 1
    const isCurrent = n === currentRound
    const isPast = n < currentRound
    return (
      <div key={n} className={cn(
        "flex flex-col items-center min-w-[64px] px-2 py-1 rounded-md border",
        isCurrent && "bg-brand-500/20 border-brand-500 animate-pulse",
        isPast && "bg-bg-subtle border-border opacity-70",
        !isCurrent && !isPast && "border-border"
      )}>
        <span className="text-xs font-mono">R{n}</span>
        <span className="text-[10px] text-fg-muted">{simulatedLabelFor(n)}</span>
        <div className="flex gap-0.5 text-[10px]">
          {roundDeltas[n]?.nodes > 0 && <span className="text-emerald-500">+{roundDeltas[n].nodes}</span>}
          {roundDeltas[n]?.edges > 0 && <span className="text-blue-500">+{roundDeltas[n].edges}</span>}
        </div>
      </div>
    )
  })}
</div>
```

插入位置：`Workbench.tsx` 顶部，`LiveRunPanel` 上方。

~80 行。

#### 4.2.3 `<RoundTimeline />` 行内摘要

文件：`frontend/src/components/RoundTimeline.tsx` (改)

每行原结构 `[icon] [summary] [time]` →
新增: `[icon] [summary] [R{n} · {simulatedLabel} · {acts} acts · +{nodes} nodes] [time]`

~30 行。

#### 4.2.4 `<EntityDanmaku />` 加 round 来源

文件：`frontend/src/components/EntityDanmaku.tsx` (改)

浮窗右上角加 badge：

```tsx
<span className="absolute top-1 right-1 text-[9px] px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-700">
  📍 R{emergedRound}
</span>
```

`emergedRound` 从 entity store 派生（entity 入 store 时记录 round）。

~15 行。

## 5. 错误处理

| 场景 | 处理 |
|---|---|
| `time_step` 非法值 | 兜底 `month`，logger.warning |
| `knowledge_store.num_entities()` / `num_relations()` 抛异常 | try/except 兜底 `{nodes_added: 0, edges_added: 0}`，metric `diff_failures++` |
| 旧 run 快照缺新字段 | UI 兜底 `—` / `0` |
| SSE event 缺字段 | `?? 0` / `?? ""` 默认值 |

## 6. 测试

### 6.1 Backend

**`backend/tests/integration/test_round_evolution.py`** (新)

```python
async def test_event_payload_contains_simulated_hours(loop_engine, capture_bus):
    """每轮 SSE event payload 必含 5 个新字段"""
    events = []
    capture_bus.subscribe(lambda e: events.append(e))
    for r in range(1, 4):
        await loop_engine.run_round(r)
    for e in events:
        assert "simulated_hours_elapsed" in e
        assert "simulated_label" in e
        assert "actions_this_round" in e
        assert "nodes_added" in e
        assert "edges_added" in e


def test_time_step_default_is_month():
    """不传 time_step → month + hours_per_round=720"""
    config = StrategicConfigGenerator.generate(doc, req)
    assert config.sim_config.time_step == "month"
    assert config.sim_config.hours_per_round == 720


def test_time_step_year_derives_max_rounds():
    """time_step=year, years=3 → max_rounds=3"""
    config = StrategicConfigGenerator.generate(doc, req, user_params={"time_step": "year", "years": 3})
    assert config.sim_config.max_rounds == 3


@pytest.mark.parametrize("time_step,expected_label", [
    ("day", "Day 3"),
    ("week", "Week 3"),
    ("month", "Month 3"),
    ("quarter", "Q3 Year 1"),
    ("year", "Year 3"),
])
def test_simulated_label_format(time_step, expected_label):
    clock = SimClock()
    assert clock.simulated_label(3, time_step) == expected_label
```

### 6.2 Frontend

**`frontend/src/store/hooks/__tests__/useRoundStream.test.ts`** (新)

```typescript
test('selector returns RoundStreamSnapshot shape', () => {
  const snap = useRoundStream()
  expect(snap).toHaveProperty('currentRound')
  expect(snap).toHaveProperty('simulatedLabel')
  expect(snap).toHaveProperty('nodesAddedThisRound')
})

test('falls back to 0 when worldState fields missing', () => {
  // 旧 run 快照缺新字段
  const snap = useRoundStream()
  expect(snap.nodesAddedThisRound).toBe(0)
})
```

**`frontend/src/components/__tests__/RoundTimelineStrip.test.tsx`** (新)

```tsx
test('renders N pills for N rounds', () => {
  render(<RoundTimelineStrip totalRounds={12} currentRound={3} />)
  expect(screen.getAllByText(/^R\d+$/)).toHaveLength(12)
})

test('current round has pulse animation', () => {
  const { container } = render(<RoundTimelineStrip totalRounds={12} currentRound={3} />)
  expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
})
```

## 7. 验收

**Backend**:
- 跑 12 轮推演，SSE event 100% 含 5 个新字段
- pytest `test_round_evolution.py` 4 个测试全绿
- 旧 run checkpoint 仍能 load (向后兼容)

**Frontend**:
- Workbench 顶部出现 `<RoundTimelineStrip />`
- 启动推演时 hero 文案: `"12 rounds × month = 1 年"`
- 新增 entity 浮窗显示 `📍 R3`
- vitest 2 个新文件全绿
- tsc --noEmit 0 新错

**用户感知 (e2e)**:
- 推演进行中能回答:
  - "Round 5 = 第 5 个月 / Day 150 / 本轮 +3 节点 / 累计 +18 节点"
- 进度条文字从 `5/12` 变为 `5/12 · Month 5 · +3 nodes`

## 8. 改动清单

| # | 文件 | 改/新 | 行数 |
|---|---|---|---|
| 1 | `backend/services/loop/clock.py` | 改 | +20 |
| 2 | `backend/services/loop/engine.py` | 改 | +30 |
| 3 | `backend/services/strategic_config_generator.py` | 改 | +40 |
| 4 | `frontend/src/store/hooks/useRoundStream.ts` | 新 | +40 |
| 5 | `frontend/src/components/RoundTimelineStrip.tsx` | 新 | +80 |
| 6 | `frontend/src/components/RoundTimeline.tsx` | 改 | +30 |
| 7 | `frontend/src/components/EntityDanmaku.tsx` | 改 | +15 |
| 8 | `frontend/src/views/Workbench.tsx` | 改 | +5 |
| 9 | `backend/tests/integration/test_round_evolution.py` | 新 | +120 |
| 10 | `frontend/src/store/hooks/__tests__/useRoundStream.test.ts` | 新 | +60 |
| 11 | `frontend/src/components/__tests__/RoundTimelineStrip.test.tsx` | 新 | +80 |

**总计**: 11 文件 / ~520 行。

## 9. 风险 & 缓解

| 风险 | 缓解 |
|---|---|
| `hours_per_round = 720` 太长，每轮 LLM 决策时间增加 | 12 轮默认总时长 1 年 = 合理；`time_step="day"` 仍可选 |
| 旧 run 快照缺新字段 | 兜底 `—` / `0`，UI 不破 |
| EventBus 收不到所有 round event | 已用 `bus.get_history()` 重放（CLAUDE.md 坑 #2） |
| pytest collection 仍卡 `backend/services/__init__.py:4` | 新测试放 `backend/tests/integration/`，与已 PASS 测试同目录 |

## 10. 不做 (Out of Scope)

- ❌ 不做 multi-track 并行（属方案 B，留给下轮）
- ❌ 不做激进 4 层时间结构重构（属方案 C）
- ❌ 不动 LoopEngine v2 核心调度逻辑
- ❌ 不改 BeliefEffectProposal / Scheduler / MemoryWriteback

## 11. 跨引用

- 决策: [`../decisions/ADR-002-loop-engine-v2-no-v1-shim.md`](../decisions/ADR-002-loop-engine-v2-no-v1-shim.md)
- 架构: [`../architecture/loop-engine-v2.md`](../architecture/loop-engine-v2.md), [`../architecture/mirofish-benchmark.md`](../architecture/mirofish-benchmark.md)
- 特性: [`../features/simulation-realism.md`](../features/simulation-realism.md)
- CLAUDE.md 坑 #5: `StrategicConfigGenerator` 派生参数未生效 — 本 spec 同时修复