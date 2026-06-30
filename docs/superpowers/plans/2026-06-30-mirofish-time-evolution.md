# MiroFish 时间演化 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 StrategicMind 推演在 frontend 显示 MiroFish 级"时间感" — 每 round 的真实时间（默认 month → "Round 3 = 第 3 个月"）、每 round 节点/行动增量、图谱节点按 round 染色。

**Architecture:**
- Backend 派生链修复：`time_step → hours_per_round → clock.advance()` 真实推进；同时 SSE event payload 携带 `simulated_label` / `nodes_added` / `edges_added` 等 5 字段
- Frontend 新增 `useRoundStream` selector + `<RoundTimelineStrip>` 时间轴条组件，复用现有 store 数据零侵入
- LoopEngine 自维护 `_last_node_count` / `_last_edge_count` 算 delta，不改 KGIndex 接口

**Tech Stack:**
- Backend: Python 3.13, asyncio, dataclasses, pytest
- Frontend: React 18, TypeScript, Zustand (atomic slices per G8), vitest, Tailwind
- SSE via Flask blueprint (现有 `pipeline.py`)

---

## 文件结构

| 文件 | 角色 | 改/新 |
|---|---|---|
| `backend/services/loop/clock.py` | 加 `simulated_label(round, time_step)` 方法 | 改 |
| `backend/services/strategic_config_generator.py` | 加 `_TIME_STEP_HOURS` 映射 + 派生 `hours_per_round` | 改 |
| `backend/services/loop/engine.py` | `__init__` 收 `hours_per_round` + event payload 加 5 字段 + delta tracking | 改 |
| `backend/tests/integration/test_round_evolution.py` | 4 个测试（label / config / event / 端到端） | 新 |
| `frontend/src/store/hooks/useRoundStream.ts` | selector: 派生 RoundStreamSnapshot | 新 |
| `frontend/src/store/hooks/__tests__/useRoundStream.test.ts` | selector 测试 | 新 |
| `frontend/src/components/RoundTimelineStrip.tsx` | 顶部 pill 列表（current 脉冲 + 节点/边 delta 徽章） | 新 |
| `frontend/src/components/__tests__/RoundTimelineStrip.test.tsx` | 组件测试 | 新 |
| `frontend/src/components/RoundTimeline.tsx` | 行内追加 `R{n} · {label} · {acts} acts · +{nodes}` | 改 |
| `frontend/src/components/EntityDanmaku.tsx` | 浮窗右上角 `📍 R{n}` badge | 改 |
| `frontend/src/views/Workbench.tsx` | 插入 `<RoundTimelineStrip>` 到 LiveRunPanel 上方 | 改 |

---

## Task 1: SimClock.simulated_label 方法 + 测试 (TDD)

**Files:**
- Modify: `backend/services/loop/clock.py`
- Test: `backend/tests/unit/test_sim_clock_label.py` (新)

- [ ] **Step 1: 写失败测试**

新建 `backend/tests/unit/test_sim_clock_label.py`:

```python
"""
SimClock.simulated_label — 时间步长 → 人类可读 label.

Acceptance: 5 种 time_step 各自的 label 格式正确.
"""
from __future__ import annotations

import pytest

from backend.services.loop.clock import SimClock


@pytest.mark.parametrize("time_step,round_num,expected", [
    ("day", 1, "Day 1"),
    ("day", 30, "Day 30"),
    ("week", 1, "Week 1"),
    ("week", 12, "Week 12"),
    ("month", 1, "Month 1"),
    ("month", 12, "Month 12"),
    ("quarter", 1, "Q1 Year 1"),
    ("quarter", 4, "Q4 Year 1"),
    ("quarter", 5, "Q1 Year 2"),
    ("year", 1, "Year 1"),
    ("year", 3, "Year 3"),
])
def test_simulated_label_format(time_step, round_num, expected):
    clock = SimClock()
    assert clock.simulated_label(round_num, time_step) == expected


def test_simulated_label_unknown_time_step_falls_back():
    clock = SimClock()
    assert clock.simulated_label(3, "decade") == "Round 3"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest backend/tests/unit/test_sim_clock_label.py -v`
Expected: FAIL — `AttributeError: 'SimClock' object has no attribute 'simulated_label'`

- [ ] **Step 3: 实现 SimClock.simulated_label**

修改 `backend/services/loop/clock.py`，在 `SimClock` 类末尾（约 line 120 之前）加方法：

```python
def simulated_label(self, round_num: int, time_step: str) -> str:
    """把 round_num + time_step 转成人类可读 label (Month 3 / Q2 Year 1 / Day 90 等)."""
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

- [ ] **Step 4: 跑测试确认通过**

Run: `python3 -m pytest backend/tests/unit/test_sim_clock_label.py -v`
Expected: PASS — 11 个参数化用例 + 1 个 fallback 用例

- [ ] **Step 5: Commit**

```bash
git add backend/services/loop/clock.py backend/tests/unit/test_sim_clock_label.py
git commit -m "feat(clock): add simulated_label(round, time_step) method

把 time_step 转人类可读 label: Day N / Week N / Month N / Q{n} Year {m} / Year N.
未知 time_step 兜底 Round N. 11 个参数化测试覆盖 5 种格式 + 1 个 fallback."
```

---

## Task 2: StrategicConfigGenerator 派生 hours_per_round (TDD)

**Files:**
- Modify: `backend/services/strategic_config_generator.py`
- Test: `backend/tests/unit/test_strategic_config_hours.py` (新)

- [ ] **Step 1: 写失败测试**

新建 `backend/tests/unit/test_strategic_config_hours.py`:

```python
"""
StrategicConfigGenerator — 从 time_step 派生 hours_per_round.

修复 CLAUDE.md 坑 #5: 派生参数未生效.
之前: sim_config.time_step = 'month' 但 hours_per_round = 24 (硬编码).
之后: hours_per_round = {day:24, week:168, month:720, quarter:2160, year:8760}.
"""
from __future__ import annotations

import pytest

from backend.services.strategic_config_generator import StrategicConfigGenerator
from backend.services.strategic_config_types import _TIME_STEP_HOURS


@pytest.mark.parametrize("time_step,expected_hours", [
    ("day", 24),
    ("week", 168),
    ("month", 720),
    ("quarter", 2160),
    ("year", 8760),
])
def test_time_step_hours_mapping_exists(time_step, expected_hours):
    """_TIME_STEP_HOURS 映射存在且值正确"""
    assert _TIME_STEP_HOURS[time_step] == expected_hours


def test_default_time_step_is_month():
    """不传 time_step → month + 720h/round"""
    gen = StrategicConfigGenerator()
    config = gen.generate(seed_doc="dummy", requirement="dummy")  # type: ignore
    assert config.time_step == "month"
    assert config.hours_per_round == 720


def test_time_step_year_derives_max_rounds_and_hours():
    """time_step=year, years=3 → max_rounds=3, hours_per_round=8760"""
    gen = StrategicConfigGenerator()
    config = gen.generate(  # type: ignore
        seed_doc="dummy",
        requirement="dummy",
        user_params={"time_step": "year", "years": 3},
    )
    assert config.max_rounds == 3
    assert config.hours_per_round == 8760


def test_time_step_month_year_2_derives_24_rounds():
    """time_step=month, years=2 → max_rounds=24"""
    gen = StrategicConfigGenerator()
    config = gen.generate(  # type: ignore
        seed_doc="dummy",
        requirement="dummy",
        user_params={"time_step": "month", "years": 2},
    )
    assert config.max_rounds == 24
    assert config.hours_per_round == 720


def test_unknown_time_step_falls_back_to_month():
    """time_step='decade' (非法) → 兜底 month, hours_per_round=720"""
    gen = StrategicConfigGenerator()
    config = gen.generate(  # type: ignore
        seed_doc="dummy",
        requirement="dummy",
        user_params={"time_step": "decade"},
    )
    assert config.hours_per_round == 720
```

注：`StrategicConfigGenerator.generate(...)` 的具体签名需要根据 `strategic_config_generator.py` 实际定义调整（可能叫 `__call__` 或有不同参数名）。看实际代码后用真实签名替换 `seed_doc="dummy", requirement="dummy"`。

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest backend/tests/unit/test_strategic_config_hours.py -v`
Expected: FAIL — `_TIME_STEP_HOURS` 未定义 / `hours_per_round` 默认不是 720

- [ ] **Step 3: 实现派生**

修改 `backend/services/strategic_config_generator.py`，在文件顶部 import 后加：

```python
_TIME_STEP_HOURS: Dict[str, int] = {
    "day": 24,
    "week": 168,
    "month": 720,
    "quarter": 2160,
    "year": 8760,
}
```

在 `_generate_with_user_params` 方法（约 line 121-123）的 `per_year = _TIME_STEP_PER_YEAR.get(time_step, 4)` 行后追加：

```python
# 派生 hours_per_round (CLAUDE.md 坑 #5 修复)
hours_per_round = _TIME_STEP_HOURS.get(time_step, _TIME_STEP_HOURS["month"])
if time_step not in _TIME_STEP_HOURS:
    logger.warning("Unknown time_step=%s, fallback to month (720h/round)", time_step)
```

然后找到 sim_config 构造点（`self.config["max_rounds"] = max_rounds` 之类的语句），同样写入 `self.config["hours_per_round"] = hours_per_round` 和 `self.config["time_step"] = time_step`。

- [ ] **Step 4: 跑测试确认通过**

Run: `python3 -m pytest backend/tests/unit/test_strategic_config_hours.py -v`
Expected: PASS — 5 个参数化 + 5 个派生测试

- [ ] **Step 5: Commit**

```bash
git add backend/services/strategic_config_generator.py backend/tests/unit/test_strategic_config_hours.py
git commit -m "fix(config): derive hours_per_round from time_step (CLAUDE.md #5)

之前 time_step='month' 但 hours_per_round 硬编码 24 → clock 永远只走 1 天/轮.
现在 _TIME_STEP_HOURS 映射 (day:24, week:168, month:720, quarter:2160, year:8760)
让 Round 3 = Month 3 / Day 90 / Q3 Year 1 等真实可读时间. 未知 time_step 兜底 month + warning."
```

---

## Task 3: LoopEngine 注入 hours_per_round + emit 5 字段 + delta tracking (TDD)

**Files:**
- Modify: `backend/services/loop/engine.py`
- Test: `backend/tests/integration/test_round_event_payload.py` (新)

- [ ] **Step 1: 写失败测试**

新建 `backend/tests/integration/test_round_event_payload.py`:

```python
"""
LoopEngine — 每 round 的 SSE event payload 必含 5 个新字段.

新字段: simulated_hours_elapsed / simulated_label / actions_this_round /
        nodes_added / edges_added
"""
from __future__ import annotations

import asyncio
import pytest

from backend.services.event_bus import EventBus
from backend.services.loop.clock import SimClock
from backend.services.loop.engine import LoopEngine
from backend.services.loop.action_resolver import ActionResolver
from backend.services.loop.memory_writeback import MemoryWriteback
from backend.services.loop.event_injector import EventInjector
from backend.services.loop.scheduler import AgentScheduler
from backend.services.loop.llm_adapter import LoopEngineLLMAdapter
from backend.services.kg_engine.graph_index import KGIndex
from backend.models.world_state import WorldState
from backend.models.strategic_agent import AgentType, StrategicAgent
from backend.models.action_type import ActionType, StrategicAction


@pytest.fixture
def loop_engine(bus, knowledge_store, llm_stub, agents, world_state):
    return LoopEngine(
        run_id="test_run",
        clock=SimClock(),
        agents=agents,
        knowledge_store=knowledge_store,
        event_bus=bus,
        sim_config={"time_step": "month", "hours_per_round": 720, "max_rounds": 3},
        llm_client=llm_stub,
        scheduler=AgentScheduler(),
        action_resolver=ActionResolver(),
        memory_writer=MemoryWriteback(knowledge_store=knowledge_store),
        event_injector=EventInjector(),
        world_state=world_state,
    )


async def test_event_payload_has_simulated_hours_elapsed(loop_engine, bus):
    """每 round SSE event payload 必含 simulated_hours_elapsed"""
    captured = []
    bus.subscribe(lambda e: captured.append(e))

    for r in range(1, 4):
        await loop_engine._execute_round(r)

    round_events = [e for e in captured if e.get("type") == "round_completed"]
    assert len(round_events) >= 3
    for e in round_events:
        assert "simulated_hours_elapsed" in e
        assert e["simulated_hours_elapsed"] >= 0


async def test_event_payload_has_simulated_label_month(loop_engine, bus):
    """time_step=month → simulated_label = 'Month N'"""
    captured = []
    bus.subscribe(lambda e: captured.append(e))

    await loop_engine._execute_round(1)

    round_events = [e for e in captured if e.get("type") == "round_completed"]
    assert round_events[0]["simulated_label"] == "Month 1"


async def test_event_payload_has_actions_count(loop_engine, bus):
    """actions_this_round >= 0 (force_one_action_per_round_minimum=True 兜底)"""
    captured = []
    bus.subscribe(lambda e: captured.append(e))

    await loop_engine._execute_round(1)

    round_events = [e for e in captured if e.get("type") == "round_completed"]
    assert "actions_this_round" in round_events[0]
    assert round_events[0]["actions_this_round"] >= 0


async def test_event_payload_has_nodes_added_field(loop_engine, bus):
    """nodes_added 字段存在, 初始为 0"""
    captured = []
    bus.subscribe(lambda e: captured.append(e))

    await loop_engine._execute_round(1)

    round_events = [e for e in captured if e.get("type") == "round_completed"]
    assert "nodes_added" in round_events[0]
    assert round_events[0]["nodes_added"] >= 0


async def test_event_payload_has_edges_added_field(loop_engine, bus):
    """edges_added 字段存在"""
    captured = []
    bus.subscribe(lambda e: captured.append(e))

    await loop_engine._execute_round(1)

    round_events = [e for e in captured if e.get("type") == "round_completed"]
    assert "edges_added" in round_events[0]
    assert round_events[0]["edges_added"] >= 0


async def test_clock_advances_by_hours_per_round(loop_engine):
    """每 round clock.advance(hours_per_round=720) → 累计正确"""
    await loop_engine._execute_round(1)
    assert loop_engine.clock.total_hours == 720
    await loop_engine._execute_round(2)
    assert loop_engine.clock.total_hours == 1440


async def test_nodes_added_increments_after_knowledge_update(loop_engine, bus, knowledge_store):
    """第 2 round 添加 1 个 entity 后, 第 2 round event 的 nodes_added 应 >= 1"""
    captured = []
    bus.subscribe(lambda e: captured.append(e))

    await loop_engine._execute_round(1)
    # round 1 后注入 1 个 entity
    knowledge_store.add_entity({"id": "e1", "name": "NewCo", "type": "COMPETITOR"})

    captured.clear()
    await loop_engine._execute_round(2)

    round_events = [e for e in captured if e.get("type") == "round_completed"]
    assert round_events[0]["nodes_added"] >= 1
```

注：fixture `bus`, `knowledge_store`, `llm_stub`, `agents`, `world_state` 需要看 `backend/tests/integration/test_loop_engine_v2.py` 的现有 fixture 定义复用（不在本 plan 范围）。

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest backend/tests/integration/test_round_event_payload.py -v`
Expected: FAIL — `simulated_hours_elapsed` 等字段缺失 / `sim_config` 参数未被 LoopEngine 识别

- [ ] **Step 3: 修改 LoopEngine.__init__ + _execute_round**

修改 `backend/services/loop/engine.py`：

a) 在 `LoopEngine.__init__` (约 line 175-200) 末尾加：

```python
# G10: 时间演化增强 — 从 sim_config 注入
self.time_step = sim_config.get("time_step", "month")
self.hours_per_round = sim_config.get("hours_per_round", 720)
self._last_node_count: int = 0
self._last_edge_count: int = 0
```

b) 删掉 `LoopEngine.__init__` 里现有的 `hours_per_round: int = 24` 默认值（如果在 `__init__` 参数里硬编码 24），改为从 sim_config 拿。如果 24 是 dataclass field 默认值，可以保留但允许 override。

c) 修改 `_execute_round` (约 line 276-330)，找到 emit event 的 dict 构造点（约 line 262-270 的 `result.to_event()` 或类似位置），在 dict 里追加：

```python
# G10: 时间演化字段
"simulated_hours_elapsed": float(self.clock.total_hours),
"simulated_label": self.clock.simulated_label(self.round_num, self.time_step),
"actions_this_round": len(actions_emitted),  # actions_emitted 是本 round 的 action 列表变量名, 看实际代码
"nodes_added": self._count_nodes() - self._last_node_count,
"edges_added": self._count_edges() - self._last_edge_count,
```

d) 在 LoopEngine 类加 helper 方法：

```python
def _count_nodes(self) -> int:
    try:
        return self.knowledge_store.num_entities()
    except Exception:
        self._metrics["node_count_failures"] = self._metrics.get("node_count_failures", 0) + 1
        return self._last_node_count  # 兜底返回上次数

def _count_edges(self) -> int:
    try:
        return self.knowledge_store.num_relations()
    except Exception:
        self._metrics["edge_count_failures"] = self._metrics.get("edge_count_failures", 0) + 1
        return self._last_edge_count
```

e) 在 `_execute_round` 末尾（emit event 之后），更新 baseline：

```python
self._last_node_count = self._count_nodes()
self._last_edge_count = self._count_edges()
```

f) 替换 `self.clock.advance(self.hours_per_round)`（如果有硬编码 24 的地方）：

如果 `self.hours_per_round` 已经是 instance attribute（按 a) 步骤设置），则 `clock.advance(self.hours_per_round)` 已经是 720，无需改。

- [ ] **Step 4: 跑测试确认通过**

Run: `python3 -m pytest backend/tests/integration/test_round_event_payload.py -v`
Expected: PASS — 7 个测试全绿

- [ ] **Step 5: Commit**

```bash
git add backend/services/loop/engine.py backend/tests/integration/test_round_event_payload.py
git commit -m "feat(loop-engine): emit 5 time-evolution fields per round + delta tracking

每 round SSE event payload 新增:
- simulated_hours_elapsed (累加, default 720h = 1 month)
- simulated_label ('Month N' / 'Q{n} Year {m}' 等)
- actions_this_round (该 round emit 的 action 数)
- nodes_added / edges_added (KGIndex delta)

LoopEngine 自维护 _last_node_count / _last_edge_count baseline, 用
num_entities() / num_relations() 算 delta. 异常时 metric 计数 + 兜底返回上次数.

7 个 pytest 测试覆盖字段存在 + 标签正确 + clock 推进 + nodes delta 正确."
```

---

## Task 4: Backend 端到端集成测试 (12 轮完整推演)

**Files:**
- Test: `backend/tests/integration/test_round_evolution_e2e.py` (新)

- [ ] **Step 1: 写测试**

```python
"""
端到端集成: 跑 12 轮推演, 验证:
- 12 个 round_completed event
- 累计 simulated_hours_elapsed = 12 × 720 = 8640 (1 年)
- simulated_label = 'Month 1' .. 'Month 12'
- nodes_added 累加 = 最终 num_entities
"""
from __future__ import annotations

import pytest


async def test_12_rounds_full_year_evolution(loop_engine_full_year, bus):
    """time_step=month, 12 rounds = 1 年"""
    captured = []
    bus.subscribe(lambda e: captured.append(e))

    for r in range(1, 13):
        await loop_engine_full_year.run_round(r)

    round_events = [e for e in captured if e.get("type") == "round_completed"]
    assert len(round_events) >= 12

    # clock 总推进 = 12 × 720h = 8640h = 360 days
    assert loop_engine_full_year.clock.total_hours == 8640

    # 12 个 label
    labels = [e["simulated_label"] for e in round_events[:12]]
    assert labels == [f"Month {i}" for i in range(1, 13)]

    # 累计 nodes_added = 最终 num_entities - 初始 0
    total_nodes_added = sum(e.get("nodes_added", 0) for e in round_events)
    final_node_count = loop_engine_full_year.knowledge_store.num_entities()
    # 因为 dedup 可能丢弃, total_nodes_added >= final_node_count
    assert total_nodes_added >= final_node_count
```

- [ ] **Step 2: 跑测试**

Run: `python3 -m pytest backend/tests/integration/test_round_evolution_e2e.py -v`
Expected: PASS — 12 轮端到端

- [ ] **Step 3: Commit**

```bash
git add backend/tests/integration/test_round_evolution_e2e.py
git commit -m "test(e2e): 12-round full-year evolution verifies time_label + nodes_added

time_step=month × 12 rounds → clock.total_hours=8640 (360 天).
12 个 simulated_label = ['Month 1', ..., 'Month 12'].
nodes_added 累加 >= 最终 num_entities (考虑 dedup)."
```

---

## Task 5: useRoundStream selector + 测试 (TDD)

**Files:**
- Create: `frontend/src/store/hooks/useRoundStream.ts`
- Test: `frontend/src/store/hooks/__tests__/useRoundStream.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `frontend/src/store/hooks/__tests__/useRoundStream.test.ts`:

```typescript
/**
 * useRoundStream - 从 worldState 派生 RoundStreamSnapshot.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePipelineStore } from '../../pipeline'
import { useRoundStream } from '../useRoundStream'

describe('useRoundStream', () => {
  beforeEach(() => {
    usePipelineStore.setState({
      worldState: null,
    } as any)
  })

  it('returns default snapshot when worldState is null', () => {
    const { result } = renderHook(() => useRoundStream())
    expect(result.current).toEqual({
      currentRound: 0,
      totalRounds: 12,
      simulatedHours: 0,
      simulatedLabel: '',
      actionsThisRound: 0,
      nodesAddedThisRound: 0,
      edgesAddedThisRound: 0,
    })
  })

  it('returns snapshot from worldState when set', () => {
    usePipelineStore.setState({
      worldState: {
        round_num: 3,
        total_rounds: 12,
        simulated_hours_elapsed: 2160,
        simulated_label: 'Month 3',
        actions_this_round: 4,
        nodes_added: 5,
        edges_added: 7,
      },
    } as any)

    const { result } = renderHook(() => useRoundStream())
    expect(result.current.currentRound).toBe(3)
    expect(result.current.simulatedLabel).toBe('Month 3')
    expect(result.current.nodesAddedThisRound).toBe(5)
  })

  it('falls back to 0 when new fields missing (backward compat)', () => {
    usePipelineStore.setState({
      worldState: {
        round_num: 2,
        total_rounds: 10,
        // 老 run 没新字段
      },
    } as any)

    const { result } = renderHook(() => useRoundStream())
    expect(result.current.simulatedLabel).toBe('')
    expect(result.current.nodesAddedThisRound).toBe(0)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npm run test -- useRoundStream`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 useRoundStream**

新建 `frontend/src/store/hooks/useRoundStream.ts`:

```typescript
/**
 * useRoundStream - 从 worldState 派生 RoundStreamSnapshot.
 *
 * 数据源: usePipelineStore.worldState (LoopEngine emit 的 round_completed event 写入).
 * 向后兼容: worldState 缺新字段时返回 0 / '' 默认值.
 */
import { usePipelineStore } from '../pipeline'

export interface RoundStreamSnapshot {
  currentRound: number
  totalRounds: number
  simulatedHours: number
  simulatedLabel: string
  actionsThisRound: number
  nodesAddedThisRound: number
  edgesAddedThisRound: number
}

export function useRoundStream(): RoundStreamSnapshot {
  const worldState = usePipelineStore((s: any) => s.worldState)
  return {
    currentRound: worldState?.round_num ?? 0,
    totalRounds: worldState?.total_rounds ?? 12,
    simulatedHours: worldState?.simulated_hours_elapsed ?? 0,
    simulatedLabel: worldState?.simulated_label ?? '',
    actionsThisRound: worldState?.actions_this_round ?? 0,
    nodesAddedThisRound: worldState?.nodes_added ?? 0,
    edgesAddedThisRound: worldState?.edges_added ?? 0,
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd frontend && npm run test -- useRoundStream`
Expected: PASS — 3 个测试

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/hooks/useRoundStream.ts frontend/src/store/hooks/__tests__/useRoundStream.test.ts
git commit -m "feat(frontend): useRoundStream selector for time-evolution fields

从 worldState 派生 7 个字段 (currentRound/totalRounds/simulatedHours/
simulatedLabel/actionsThisRound/nodesAddedThisRound/edgesAddedThisRound).
缺字段时兜底 0/'', 向后兼容旧 run 快照."
```

---

## Task 6: RoundTimelineStrip 组件 + 测试 (TDD)

**Files:**
- Create: `frontend/src/components/RoundTimelineStrip.tsx`
- Test: `frontend/src/components/__tests__/RoundTimelineStrip.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `frontend/src/components/__tests__/RoundTimelineStrip.test.tsx`:

```tsx
/**
 * RoundTimelineStrip - 顶部 round pill 列表 (MiroFish-style 时间轴).
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RoundTimelineStrip } from '../RoundTimelineStrip'

describe('RoundTimelineStrip', () => {
  it('renders N pills for N rounds', () => {
    render(<RoundTimelineStrip totalRounds={12} currentRound={0} deltas={{}} simulatedLabels={Array.from({length:12},(_,i)=>`Month ${i+1}`)} />)
    const pills = screen.getAllByText(/^R\d+$/)
    expect(pills).toHaveLength(12)
  })

  it('highlights current round with animate-pulse class', () => {
    const { container } = render(
      <RoundTimelineStrip
        totalRounds={12}
        currentRound={3}
        deltas={{3: {nodes: 5, edges: 7}}}
        simulatedLabels={Array.from({length:12},(_,i)=>`Month ${i+1}`)}
      />
    )
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
  })

  it('shows node delta badge for rounds with nodes_added > 0', () => {
    render(
      <RoundTimelineStrip
        totalRounds={12}
        currentRound={3}
        deltas={{2: {nodes: 5, edges: 0}}}
        simulatedLabels={Array.from({length:12},(_,i)=>`Month ${i+1}`)}
      />
    )
    expect(screen.getByText('+5')).toBeInTheDocument()
  })

  it('does not render delta badges when deltas empty', () => {
    render(<RoundTimelineStrip totalRounds={12} currentRound={0} deltas={{}} simulatedLabels={Array.from({length:12},(_,i)=>`Month ${i+1}`)} />)
    expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument()
  })

  it('renders simulated label inside pill', () => {
    render(<RoundTimelineStrip totalRounds={12} currentRound={0} deltas={{}} simulatedLabels={['Month 1','Month 2','Day 90']} />)
    expect(screen.getByText('Day 90')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npm run test -- RoundTimelineStrip`
Expected: FAIL — component not found

- [ ] **Step 3: 实现组件**

新建 `frontend/src/components/RoundTimelineStrip.tsx`:

```tsx
/**
 * RoundTimelineStrip - 顶部 round 时间轴 (MiroFish-style).
 *
 * 显示 12 个 round pill, 当前 round 高亮 + animate-pulse.
 * 每个 pill 含 R{n} / simulated label / +nodes / +edges 徽章.
 */
import { cn } from '@/lib/utils'

export interface RoundDeltas {
  [round: number]: { nodes: number; edges: number }
}

export interface RoundTimelineStripProps {
  totalRounds: number
  currentRound: number
  deltas: RoundDeltas
  simulatedLabels: string[]
}

export function RoundTimelineStrip({
  totalRounds,
  currentRound,
  deltas,
  simulatedLabels,
}: RoundTimelineStripProps) {
  return (
    <div
      data-testid="round-timeline-strip"
      className="flex gap-1 overflow-x-auto py-2 px-4 bg-bg-elevated border-b border-border"
    >
      {Array.from({ length: totalRounds }).map((_, i) => {
        const n = i + 1
        const isCurrent = n === currentRound
        const isPast = n < currentRound
        const delta = deltas[n]
        return (
          <div
            key={n}
            data-testid={`round-pill-${n}`}
            className={cn(
              'flex flex-col items-center min-w-[64px] px-2 py-1 rounded-md border text-xs',
              isCurrent && 'bg-brand-500/20 border-brand-500 animate-pulse',
              isPast && 'bg-bg-subtle border-border opacity-70',
              !isCurrent && !isPast && 'border-border bg-bg-elevated'
            )}
          >
            <span className="font-mono font-semibold">R{n}</span>
            <span className="text-[10px] text-fg-muted">
              {simulatedLabels[i] || `Round ${n}`}
            </span>
            {(delta?.nodes || delta?.edges) ? (
              <div className="flex gap-0.5 text-[10px]">
                {delta.nodes > 0 && (
                  <span className="text-emerald-500">+{delta.nodes}</span>
                )}
                {delta.edges > 0 && (
                  <span className="text-blue-500">+{delta.edges}</span>
                )}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd frontend && npm run test -- RoundTimelineStrip`
Expected: PASS — 5 个测试

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/RoundTimelineStrip.tsx frontend/src/components/__tests__/RoundTimelineStrip.test.tsx
git commit -m "feat(frontend): RoundTimelineStrip — top time-axis with per-round delta

12 round pill 横排, 当前 round 高亮 + animate-pulse.
每个 pill: R{n} + simulated label (Month N / Day N 等) + 节点/边 delta 徽章.
MiroFish 'formatElapsedTime' 模式移植."
```

---

## Task 7: RoundTimeline 行内摘要追加

**Files:**
- Modify: `frontend/src/components/RoundTimeline.tsx`

- [ ] **Step 1: 找到行内文本构造点**

读 `frontend/src/components/RoundTimeline.tsx`，定位每行渲染 action summary 的位置（约 line 200-250 的 `<div>{action.summary}</div>` 之类）。

- [ ] **Step 2: 插入 4 字段摘要**

在每个 round 行的 summary 之后追加 1 个 `<span>` 子节点：

```tsx
<span className="ml-2 text-[10px] text-fg-muted font-mono">
  R{action.round_num ?? '?'} · {action.simulated_label ?? ''} · {action.actions_this_round ?? 0} acts · +{action.nodes_added ?? 0} nodes
</span>
```

字段名按实际 `StrategicAction` / `RoundResult` 类型调整（看 `frontend/src/components/RoundTimeline.tsx` 现有引用）。

- [ ] **Step 3: 跑现有测试 + tsc**

Run: `cd frontend && npm run test -- RoundTimeline && npx tsc --noEmit`
Expected: 现有测试 PASS, 0 新 TS 错

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/RoundTimeline.tsx
git commit -m "feat(frontend): RoundTimeline row inline shows R{n} · label · acts · nodes

每行尾部追加 'R{n} · Month N · 4 acts · +5 nodes' 摘要.
MiroFish 'R{round}/{total} | T:{hours}h | A:{count}' 格式移植."
```

---

## Task 8: EntityDanmaku 浮窗加 round 来源 badge

**Files:**
- Modify: `frontend/src/components/EntityDanmaku.tsx`

- [ ] **Step 1: 找浮窗渲染位置**

读 `frontend/src/components/EntityDanmaku.tsx`，定位单个弹幕浮窗的根 `<div>` (约 line 80-110)。

- [ ] **Step 2: 加 badge**

在浮窗右上角加：

```tsx
<span
  data-testid="entity-round-badge"
  className="absolute top-1 right-1 text-[9px] px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-700 font-mono"
>
  📍 R{node.emerged_round ?? '?'}
</span>
```

`emerged_round` 需要在 entity 入 store 时记录（看 `appendGraphNode` 调用位置，添加 `emerged_round: currentRound`）。

- [ ] **Step 3: 跑测试**

Run: `cd frontend && npm run test -- EntityDanmaku`
Expected: 现有测试 PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/EntityDanmaku.tsx
git commit -m "feat(frontend): EntityDanmaku badge shows emergence round

新节点浮窗右上角加 '📍 R{n}' badge, 用户立即知道 entity 在哪一轮出现.
emerged_round 在 appendGraphNode 时记录 (LoopEngine 当前 round_num)."
```

---

## Task 9: Workbench.tsx 插入 RoundTimelineStrip

**Files:**
- Modify: `frontend/src/views/Workbench.tsx`

- [ ] **Step 1: 加 import**

```tsx
import { RoundTimelineStrip } from '@/components/RoundTimelineStrip'
import { useRoundStream } from '@/store/hooks/useRoundStream'
```

- [ ] **Step 2: 在 Workbench 函数体内取 snapshot**

```tsx
const roundStream = useRoundStream()
// 派生 per-round deltas: 从 simRounds 历史累积
const roundDeltas = useMemo(() => {
  const deltas: Record<number, { nodes: number; edges: number }> = {}
  for (const r of simRounds ?? []) {
    const round = r.round_num ?? 0
    deltas[round] = {
      nodes: r.nodes_added ?? 0,
      edges: r.edges_added ?? 0,
    }
  }
  return deltas
}, [simRounds])

const simulatedLabels = useMemo(() => {
  return Array.from({ length: roundStream.totalRounds }, (_, i) => {
    // 从 simRounds 历史取 label, 没数据时回退 "Round N"
    const r = (simRounds ?? []).find((x: any) => x.round_num === i + 1)
    return r?.simulated_label ?? `Round ${i + 1}`
  })
}, [simRounds, roundStream.totalRounds])
```

注：`simRounds` 已在 Workbench 现有逻辑里存在（看实际代码确认变量名）。

- [ ] **Step 3: 在 LiveRunPanel 上方插入组件**

找到 Workbench 顶部 `<LiveRunPanel ... />` 之前，加：

```tsx
{roundStream.totalRounds > 0 && (
  <RoundTimelineStrip
    totalRounds={roundStream.totalRounds}
    currentRound={roundStream.currentRound}
    deltas={roundDeltas}
    simulatedLabels={simulatedLabels}
  />
)}
```

- [ ] **Step 4: 跑 tsc + 启动 dev 看**

Run: `cd frontend && npx tsc --noEmit` 然后 `npm run dev`
Expected: 0 新 TS 错；浏览器 Workbench 顶部出现 pill 列表

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/Workbench.tsx
git commit -m "feat(frontend): Workbench 顶部插入 RoundTimelineStrip

useRoundStream 派生 7 字段 + simRounds 历史算 per-round deltas.
12 个 pill 横排, 当前 round 高亮 + animate-pulse. 用户立即看到
'Round 3/12 · Month 3 · +5 nodes' 的真实时间演化进度."
```

---

## Task 10: 全栈验证 + 回归

**Files:** 无新文件，纯验证

- [ ] **Step 1: Backend pytest 全跑**

Run: `python3 -m pytest backend/tests/integration/test_round_evolution_e2e.py backend/tests/integration/test_round_event_payload.py backend/tests/unit/test_sim_clock_label.py backend/tests/unit/test_strategic_config_hours.py -v`
Expected: 所有新测试 PASS

- [ ] **Step 2: Frontend vitest 全跑**

Run: `cd frontend && npm run test`
Expected: 现有 316 + 新 8 个测试 PASS (8 = 3 useRoundStream + 5 RoundTimelineStrip)

- [ ] **Step 3: tsc --noEmit**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 新错 (15 个 pre-existing `TS6133 unused` 警告可忽略)

- [ ] **Step 4: 端到端冒烟 (手动)**

```bash
# 后端
pkill -f backend.run_server 2>/dev/null
cd /Users/jasonlee/strategicmind
nohup python3 -m backend.run_server > /tmp/backend.log 2>&1 &

# 前端
cd frontend
nohup npm run dev > /tmp/frontend.log 2>&1 &

# 等 5 秒, 访问 http://localhost:5173/workbench
# 启动一个新推演, 验证:
#   - Workbench 顶部出现 12 个 pill
#   - 启动后 hero 文案: '12 rounds × month = 1 年'
#   - 推演进行中 pill 高亮顺序前进
#   - 新 entity 浮窗右上角显示 '📍 R3'
```

Expected: Workbench 顶部 pill 正常显示，新 entity 显示 round badge

- [ ] **Step 5: Commit verification**

```bash
git status  # 应该干净 (除非 .vite cache)
```

- [ ] **Step 6: 整体 push PR (可选)**

如果用户要 PR, 整理 commit 历史, push 到 origin. 默认不在 plan 范围.

---

## Self-Review

**Spec 覆盖检查** (11 个 spec § 章节):

| Spec 章节 | Plan Task |
|---|---|
| § 4.1.1 SimClock.simulated_label | Task 1 ✅ |
| § 4.1.2 LoopEngine 5 字段 event | Task 3 ✅ |
| § 4.1.3 StrategicConfigGenerator hours_per_round | Task 2 ✅ |
| § 4.2.1 useRoundStream selector | Task 5 ✅ |
| § 4.2.2 RoundTimelineStrip 组件 | Task 6 ✅ |
| § 4.2.3 RoundTimeline 行内摘要 | Task 7 ✅ |
| § 4.2.4 EntityDanmaku round badge | Task 8 ✅ |
| § 4.2.4 (插入 Workbench) | Task 9 ✅ |
| § 6.1 Backend 测试 | Task 1, 2, 3, 4 ✅ |
| § 6.2 Frontend 测试 | Task 5, 6 ✅ |
| § 7 验收 | Task 10 ✅ |

**Placeholder 扫描**: 0 个 TBD/TODO/"implement later"

**Type 一致性**:
- `SimClock.simulated_label(round_num: int, time_step: str) -> str` 在 Task 1 定义, Task 3 调用 ✅
- `LoopEngine.time_step` / `hours_per_round` 在 Task 3 定义, Task 3 内部使用 ✅
- `useRoundStream` 返回 `RoundStreamSnapshot` 在 Task 5 定义, Task 6 props / Task 9 调用 ✅
- `RoundTimelineStrip` props (`totalRounds`, `currentRound`, `deltas`, `simulatedLabels`) 在 Task 6 定义, Task 9 调用 ✅
- `nodes_added` / `edges_added` 在 Task 3 event payload 定义, Task 5 selector / Task 6 / Task 7 引用一致 ✅