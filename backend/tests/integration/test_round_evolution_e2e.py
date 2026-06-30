"""
端到端集成: 跑 12 轮推演, 验证:
- 12 个 round_completed event (1 年 × month)
- 最终 clock.total_hours = 12 × 720 = 8640 (1 年)
- simulated_label = 'Month 1' .. 'Month 12'
- simulated_hours_elapsed 序列在 emit 时 = [0, 720, ..., 7920]
  (engine.run() 先 emit 再 advance, 所以 emit-time 是上一轮 advance 后)
- nodes_added 每个 round 都 >= 0
"""
from __future__ import annotations

import pytest

from backend.services.event_bus import EventBus
from backend.services.loop.clock import SimClock
from backend.services.loop.engine import LoopEngine
from backend.services.loop.action_resolver import ActionResolver
from backend.services.loop.memory_writeback import MemoryWriteback
from backend.services.loop.event_injector import EventInjector
from backend.services.loop.scheduler import AgentScheduler
from backend.services.kg_engine.graph_index import KGIndex
from backend.models.world_state import WorldState


# ---------------------------------------------------------------------------
# Stub LLM — 返回 no-op StrategicAction 让 engine 能跑完
# ---------------------------------------------------------------------------


class _StubLLM:
    """Minimal no-op LLM client; satisfies LLMClient protocol."""

    async def generate_action(
        self,
        *,
        agent,
        clock,
        world_state,
        candidates,
        recent_episodes=(),
    ):
        from backend.models.action_type import (
            ActionType,
            PropagationChannel,
            StrategicAction,
        )

        action = StrategicAction(
            action_type=ActionType.MAKE_STATEMENT,
            actor_id=agent.agent_id,
            round_num=0,
            propagation_channels=[PropagationChannel.OFFICIAL],
        )
        action.post_content = "noop"
        action.post_author_name = agent.name or agent.agent_id
        action.evidence = []
        return action


def _round_event_data(bus: EventBus, run_id: str):
    """从 bus history 提取所有 round_completed event 的 data dict."""
    out = []
    for frame in bus.get_history(run_id):
        evt = frame.get("event") or {}
        if evt.get("type") == "round_completed":
            out.append(evt.get("data") or {})
    return out


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def bus():
    return EventBus()


@pytest.fixture
def knowledge_store():
    """KGIndex 是 G7 切的 nano-graphRAG 替身, 提供 num_entities()/num_relations()."""
    return KGIndex()


@pytest.fixture
def world_state():
    return WorldState()


@pytest.fixture
def loop_engine_full_year(bus, knowledge_store, world_state):
    """1 年 = 12 个月, 720h/round, 12 rounds 总.

    故意 agents=[] + LLM stub, 让 scheduler force_one_action_per_round_minimum 兜底:
    但因 agents 是 [], _execute_round 不会 select any agent,
    所以 actions 列表为空. 这刚好验证 engine 在空 agents 下仍能跑完 12 rounds
    (即使每 round 0 actions, round_completed 事件依然正常 emit).
    """
    return LoopEngine(
        run_id="e2e_test",
        clock=SimClock(),
        agents=[],
        knowledge_store=knowledge_store,
        event_bus=bus,
        config={
            "time_step": "month",
            "hours_per_round": 720,
            "max_rounds": 12,
            "user_params": {},
        },
        llm_client=_StubLLM(),  # type: ignore[arg-type]
        scheduler=AgentScheduler(),
        action_resolver=ActionResolver(),
        # memory_writer=None → engine.__post_init__ 自动构造一个 wired 的
        # MemoryWriteback (mirror_enabled=True, 接 knowledge_store).
        memory_writer=None,
        event_injector=EventInjector(),
        world_state=world_state,
        hours_per_round=720,
        total_rounds=12,
        seed=0,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_12_rounds_full_year_emits_12_round_completed_events(
    loop_engine_full_year, bus
):
    """time_step=month, 12 rounds → 12 个 round_completed event, label = Month 1..12."""
    await loop_engine_full_year.run()

    round_events = _round_event_data(bus, "e2e_test")
    assert len(round_events) == 12, (
        f"Expected 12 round_completed events, got {len(round_events)}"
    )

    labels = [e.get("simulated_label") for e in round_events]
    expected_labels = [f"Month {i}" for i in range(1, 13)]
    assert labels == expected_labels, (
        f"simulated_label mismatch.\n"
        f"  expected: {expected_labels}\n"
        f"  actual:   {labels}"
    )


@pytest.mark.asyncio
async def test_12_rounds_clock_advances_cumulatively_to_one_year(
    loop_engine_full_year, bus
):
    """12 × 720h = 8640h = 360 days = 1 年. run() 最后 clock.total_hours == 8640."""
    await loop_engine_full_year.run()

    # 最终 clock 已 advance 12 次, 累计 12 × 720 = 8640h
    assert loop_engine_full_year.clock.total_hours == 8640, (
        f"Expected final clock.total_hours == 8640, "
        f"got {loop_engine_full_year.clock.total_hours}"
    )

    # 同时 day_index = 8640 / 24 = 360 (整年)
    assert loop_engine_full_year.clock.day_index == 360
    # fiscal_year: day_index 0..359 → year 1; 360..719 → year 2.
    # 因 advance(720) 后 total_hours=720, day_index=30 → month=1 → year=1;
    # 最后 advance 后 total_hours=8640, day_index=360 → month=0 → year=2
    # (因为 fiscal_year = day_index // 360 + 1, 360 // 360 + 1 = 2)
    assert loop_engine_full_year.clock.fiscal_year == 2


@pytest.mark.asyncio
async def test_12_rounds_simulated_hours_elapsed_emit_time_sequence(
    loop_engine_full_year, bus
):
    """engine.run() 顺序: _execute_round → emit round_completed → advance.

    所以 emit 时 clock.total_hours 反映的是上一轮 advance 后的值:
      Round 1: emit @ total_hours=0
      Round 2: emit @ total_hours=720
      ...
      Round 12: emit @ total_hours=7920
    """
    await loop_engine_full_year.run()

    round_events = _round_event_data(bus, "e2e_test")
    assert len(round_events) == 12

    # 验证每 round 都有 simulated_hours_elapsed 字段
    hours_sequence = [
        e.get("simulated_hours_elapsed") for e in round_events
    ]

    # 期望 emit-time 序列: 上一轮 advance 后的 total_hours
    # round 1 emit 时 clock 还没 advance (初始 0)
    # round N emit 时 clock 已 advance (N-1) × 720
    expected = [720 * (i - 1) for i in range(1, 13)]  # i=1..12 → [0, 720, ..., 7920]
    assert hours_sequence == expected, (
        f"simulated_hours_elapsed mismatch at emit time.\n"
        f"  expected: {expected}\n"
        f"  actual:   {hours_sequence}"
    )

    # 最后一轮 emit 时 simulated_hours_elapsed=7920 (因为 12 轮 advance 在 emit 之后)
    assert round_events[-1]["simulated_hours_elapsed"] == 7920


@pytest.mark.asyncio
async def test_12_rounds_cumulative_hours_equals_one_year_via_labels(
    loop_engine_full_year, bus
):
    """验证从 label 'Month 12' 反推: 12 个月 × 30 天/月 × 24h/天 = 8640h."""
    await loop_engine_full_year.run()
    round_events = _round_event_data(bus, "e2e_test")

    # 最后一个 label 必须是 'Month 12'
    assert round_events[-1]["simulated_label"] == "Month 12"

    # 反推累计小时: month_index 在 emit time 应反映 (round_num - 1) 个月
    # round 12 emit 时 month_index = ((day_index=330) // 30) % 12 = 11 → 第 12 个月
    # clock.day_index 在 round 12 emit 时 = (7920 // 24) = 330 → 0-based 第 330 天
    # month_index = (330 // 30) % 12 = 11
    assert loop_engine_full_year.clock.day_index == 360  # final after last advance


@pytest.mark.asyncio
async def test_12_rounds_nodes_added_non_negative(loop_engine_full_year, bus):
    """所有 round 的 nodes_added 都 >= 0 (delta 计算可能为 0 但不应为负)."""
    await loop_engine_full_year.run()

    round_events = _round_event_data(bus, "e2e_test")
    assert len(round_events) == 12

    for i, e in enumerate(round_events, start=1):
        assert "nodes_added" in e, f"round {i} missing nodes_added field"
        n = e["nodes_added"]
        assert n >= 0, f"round {i} nodes_added should be >= 0, got {n}"
        # edges_added 同理
        assert "edges_added" in e, f"round {i} missing edges_added field"
        assert e["edges_added"] >= 0


@pytest.mark.asyncio
async def test_12_rounds_actions_count_field_present(loop_engine_full_year, bus):
    """每 round event 都有 actions_this_round 字段. 空 agents 下应为 0."""
    await loop_engine_full_year.run()

    round_events = _round_event_data(bus, "e2e_test")
    assert len(round_events) == 12
    for i, e in enumerate(round_events, start=1):
        assert "actions_this_round" in e, (
            f"round {i} missing actions_this_round"
        )
        # agents=[] → scheduler 不 select → actions 列表空 → actions_this_round == 0
        assert e["actions_this_round"] == 0, (
            f"round {i} expected 0 actions (empty agents), "
            f"got {e['actions_this_round']}"
        )