"""
LoopEngine — 每 round 的 SSE event payload 必含 5 个新字段.

新字段: simulated_hours_elapsed / simulated_label / actions_this_round /
        nodes_added / edges_added
"""
from __future__ import annotations

import pytest

from backend.services.event_bus import EventBus
from backend.services.loop.clock import SimClock
from backend.services.loop.engine import LoopEngine, RoundResult
from backend.services.loop.memory_writeback import EpisodicMemory
from backend.services.loop.action_resolver import ActionResolver
from backend.services.loop.scheduler import AgentScheduler
from backend.services.loop.event_injector import EventInjector
from backend.models.world_state import WorldState


# ---------------------------------------------------------------------------
# Stub LLM — empty action so the engine has nothing to do.
# ---------------------------------------------------------------------------


class _StubLLM:
    """Returns a minimal no-op action — never crashes."""

    async def generate_action(
        self,
        *,
        agent,
        clock,
        world_state,
        candidates,
        recent_episodes=(),
    ):
        from backend.models.action_type import ActionType, PropagationChannel, StrategicAction

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


def _round_events(bus: EventBus, run_id: str):
    """Extract round_completed data dicts from bus history."""
    out = []
    for frame in bus.get_history(run_id):
        evt = frame.get("event") or {}
        if evt.get("type") == "round_completed":
            out.append(evt.get("data") or {})
    return out


@pytest.fixture
def bus():
    return EventBus()


@pytest.fixture
def knowledge_store(tmp_path):
    return EpisodicMemory.for_run("test_run", storage_path=str(tmp_path / "ep"))


@pytest.fixture
def world_state():
    return WorldState()


@pytest.fixture
def loop_engine(bus, knowledge_store, world_state):
    """最小可行 LoopEngine: 不依赖外部 LLM."""
    return LoopEngine(
        run_id="test_run",
        clock=SimClock(),
        agents=[],
        knowledge_store=knowledge_store,
        event_bus=bus,
        config={"time_step": "month", "hours_per_round": 720, "max_rounds": 3, "user_params": {}},
        llm_client=_StubLLM(),  # type: ignore
        scheduler=AgentScheduler(),
        action_resolver=ActionResolver(),
        memory_writer=None,
        event_injector=EventInjector(),
        world_state=world_state,
        hours_per_round=720,
        total_rounds=3,
        seed=0,
    )


# ---------------------------------------------------------------------------
# Tests — every test calls engine.run() because that is where the
# round_completed event is actually emitted to the bus.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_event_payload_has_simulated_hours_elapsed(loop_engine, bus):
    """每 round SSE event payload 必含 simulated_hours_elapsed"""
    await loop_engine.run()
    round_events = _round_events(bus, "test_run")
    assert len(round_events) >= 3
    for e in round_events:
        assert "simulated_hours_elapsed" in e
        assert e["simulated_hours_elapsed"] >= 0


@pytest.mark.asyncio
async def test_event_payload_has_simulated_label_month(loop_engine, bus):
    """time_step=month → simulated_label = 'Month N'"""
    await loop_engine.run()
    round_events = _round_events(bus, "test_run")
    assert len(round_events) >= 1
    assert round_events[0]["simulated_label"] == "Month 1"


@pytest.mark.asyncio
async def test_event_payload_has_actions_count(loop_engine, bus):
    """actions_this_round >= 0"""
    await loop_engine.run()
    round_events = _round_events(bus, "test_run")
    assert "actions_this_round" in round_events[0]
    assert round_events[0]["actions_this_round"] >= 0


@pytest.mark.asyncio
async def test_event_payload_has_nodes_added_field(loop_engine, bus):
    """nodes_added 字段存在, 初始为 0"""
    await loop_engine.run()
    round_events = _round_events(bus, "test_run")
    assert "nodes_added" in round_events[0]
    assert round_events[0]["nodes_added"] >= 0


@pytest.mark.asyncio
async def test_event_payload_has_edges_added_field(loop_engine, bus):
    """edges_added 字段存在"""
    await loop_engine.run()
    round_events = _round_events(bus, "test_run")
    assert "edges_added" in round_events[0]
    assert round_events[0]["edges_added"] >= 0


@pytest.mark.asyncio
async def test_clock_advances_by_hours_per_round(loop_engine):
    """每 round clock.advance(hours_per_round=720) → 累计正确"""
    await loop_engine.run()
    # After 3 rounds * 720h = 2160h
    assert loop_engine.clock.total_hours == 2160


@pytest.mark.asyncio
async def test_simulated_hours_elapsed_progresses(loop_engine, bus):
    """每 round 的 simulated_hours_elapsed 累加正确 (0, 720, 1440)"""
    await loop_engine.run()
    round_events = _round_events(bus, "test_run")
    assert len(round_events) >= 3
    # The clock advances AFTER each round's event is emitted, so:
    # - round 1 emits at total_hours=0
    # - round 2 emits at total_hours=720 (after advance from round 1)
    # - round 3 emits at total_hours=1440 (after advance from round 2)
    # The final 2160h is reached AFTER all emits complete.
    expected_hours = [0.0, 720.0, 1440.0]
    for i, expected in enumerate(expected_hours):
        actual = round_events[i]["simulated_hours_elapsed"]
        assert actual == expected, (
            f"round {i+1} expected {expected}h, got {actual}h"
        )


@pytest.mark.asyncio
async def test_nodes_added_increments_after_knowledge_update(loop_engine, bus, knowledge_store):
    """第 2 round 添加 1 个 entity 后, 第 2 round event 的 nodes_added 应 >= 1"""
    await loop_engine.run()
    # The first round's payload is the first round_completed event.
    # Add an entity *after* the run finishes — but the engine only
    # writes payloads during run(). So instead: directly construct a
    # synthetic second run after seeding the knowledge store.
    knowledge_store.upsert_node("e1", "COMPETITOR", name="NewCo")
    # Reset baselines so the engine recomputes delta on its next run.
    loop_engine._last_node_count = len(knowledge_store.nodes) - 1
    loop_engine._last_edge_count = len(knowledge_store.edges)

    await loop_engine.run()
    round_events = _round_events(bus, "test_run")
    # The 2nd run's first round payload should reflect nodes_added >= 1.
    second_run_first_round = round_events[3]
    assert second_run_first_round["nodes_added"] >= 1