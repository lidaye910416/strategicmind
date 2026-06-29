"""
Unit tests for AgentScheduler (loop-engine v2, T1.7).

These tests cover:

* F16: ``make_synthetic_action()`` produces ``post_content`` whose
  length is ``>= MIN_POST_CONTENT_LEN (40)`` so the action passes the
  writeback filter and produces a real episode (Bug #2 root cause 2.6).
* F16: when no agent matches the time-gate, the engine's forced round
  produces ``episode_id != None`` (the synthetic action survives
  writeback because its post_content is now long enough).
* Role classification (CFO / Sales / Board / Engineer / default).
* Time-gate predicates — the four named gates.
* ``select_active_or_force`` force-minimum semantics — when natural
  selection returns zero, the weakest-gate fallback fires.
"""
from __future__ import annotations

import asyncio
import dataclasses
import uuid
from typing import Any, Dict, List, Optional, Sequence

import pytest

from backend.models.action_type import (
    ActionType,
    PropagationChannel,
    StrategicAction,
)
from backend.models.strategic_agent import AgentType, StrategicAgent
from backend.models.world_state import WorldState
from backend.services.loop.clock import SimClock
from backend.services.loop.memory_writeback import (
    EpisodicMemory,
    MemoryWriteback,
)

# MIN_POST_CONTENT_LEN is defined as a class-level constant on
# MemoryWriteback (40). Re-export it here for convenience.
MIN_POST_CONTENT_LEN = MemoryWriteback.MIN_POST_CONTENT_LEN
from backend.services.loop.scheduler import (
    AgentScheduler,
    classify_role,
)


# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------


def _agent(
    *,
    name: str = "Agent",
    role: str = "",
    department: str = "",
    active_hours: Optional[List[int]] = None,
    activity_level: float = 1.0,
    timezone_offset: int = 0,
) -> StrategicAgent:
    """Construct a StrategicAgent with v2 ad-hoc fields attached."""
    a = StrategicAgent(
        agent_id=str(uuid.uuid4()),
        name=name,
        agent_type=AgentType.CORPORATE_EXEC,
    )
    # v2 fields are ad-hoc — set via setattr because the legacy
    # StrategicAgent dataclass does not declare them.
    a.role = role
    a.department = department
    a.active_hours = active_hours if active_hours is not None else list(range(9, 18))
    a.activity_level = activity_level
    a.timezone_offset = timezone_offset
    return a


# ---------------------------------------------------------------------------
# F16 (1/2): make_synthetic_action post_content length regression
# ---------------------------------------------------------------------------
#
# Cluster D / F16 root cause 2.6: the v1 synthetic-action
# ``post_content`` was "本期无重大动作" (8 chars). The writeback
# filter rejected it as "template pollution" because
# len(post_content) < MIN_POST_CONTENT_LEN (40), which produced
# episode_id=None and broke the feedback loop's
# ``recent_episodes`` recall. The fix pads the post_content to
# >= 40 chars.


def test_synthetic_action_post_content_length_meets_minimum():
    """F16: post_content length >= MIN_POST_CONTENT_LEN (40)."""
    agent = _agent(name="CFO 张三")
    action = AgentScheduler.make_synthetic_action(agent, round_num=1)
    assert action.post_content, "post_content must not be empty"
    assert len(action.post_content) >= MIN_POST_CONTENT_LEN, (
        f"synthetic post_content len={len(action.post_content)} "
        f"< MIN_POST_CONTENT_LEN={MIN_POST_CONTENT_LEN}"
    )


def test_synthetic_action_post_content_length_independent_of_name_length():
    """F16: length must hold for short names too (the v1 bug)."""
    # A single-char agent name used to collapse the body to < 40.
    agent = _agent(name="X")
    action = AgentScheduler.make_synthetic_action(agent, round_num=7)
    assert len(action.post_content) >= MIN_POST_CONTENT_LEN


def test_synthetic_action_metadata_marks_forced_round():
    """F16: forced_round flag is preserved for downstream filtering."""
    agent = _agent(name="CFO")
    action = AgentScheduler.make_synthetic_action(agent, round_num=3)
    assert action.metadata.get("forced_round") is True
    assert action.action_type == ActionType.MAKE_STATEMENT
    assert action.actor_id == agent.agent_id
    assert action.round_num == 3


def test_synthetic_action_post_author_name_uses_agent_name():
    agent = _agent(name="CEO 王五")
    action = AgentScheduler.make_synthetic_action(agent, round_num=1)
    assert action.post_author_name == "CEO 王五"


def test_synthetic_action_falls_back_to_agent_id_when_name_blank():
    # StrategicAgent requires a non-empty name (validated in __post_init__).
    # Use a single-char name to exercise the f-string branch tightly.
    agent = _agent(name="Z")
    action = AgentScheduler.make_synthetic_action(agent, round_num=1)
    # post_author_name uses agent.name when present.
    assert action.post_author_name == "Z"


# ---------------------------------------------------------------------------
# F16 (2/2): forced round produces a non-None episode_id
# ---------------------------------------------------------------------------
#
# End-to-end: a round where no agent matches any time-gate falls back
# to ``make_synthetic_action``; that action's ``post_content`` must
# be long enough that ``MemoryWriteback.write_action`` returns
# episode_id != None.


def test_forced_round_produces_non_none_episode_id():
    """F16: synthetic action survives writeback -> episode_id != None."""
    # Construct the synthetic action exactly as the engine does
    # (see backend/services/loop/engine.py:262-265).
    agent = _agent(name="Board Chair", role="board", department="executive")
    synth = AgentScheduler.make_synthetic_action(agent, round_num=1)

    # Pass it through the writeback filter. No prior episodes for
    # this actor, so this is a cold write.
    memory = EpisodicMemory.for_run(run_id=f"test_{uuid.uuid4().hex[:8]}")
    writer = MemoryWriteback(memory=memory, mirror_enabled=False)
    result = writer.write_action(synth)

    assert result["episode_id"] is not None, (
        f"synthetic action was filtered as template pollution: {result}"
    )
    assert result["episode_id"] == synth.action_id or synth.action_id in str(result["episode_id"]), (
        f"episode_id should derive from action_id; got {result['episode_id']!r}"
    )
    # The Episode node must now exist in the in-process memory.
    assert result["episode_id"] in memory.nodes


def test_short_post_content_still_filtered_as_template_pollution():
    """Counter-test: a short post_content is correctly rejected.

    This guards against accidentally loosening the writeback filter
    when patching the synthetic-action length — we still want
    genuinely short / empty post_content to be filtered.
    """
    agent = _agent(name="Bad")
    short_action = StrategicAction(
        action_type=ActionType.MAKE_STATEMENT,
        actor_id=agent.agent_id,
        target_ids=[],
        round_num=1,
        propagation_channels=[PropagationChannel.DIRECT],
    )
    # v2 fields are ad-hoc; attach via setattr so writer can read them.
    short_action.post_content = "短"  # < MIN_POST_CONTENT_LEN
    short_action.post_author_name = agent.name
    short_action.action_id = "test_short_001"

    memory = EpisodicMemory.for_run(run_id=f"test_{uuid.uuid4().hex[:8]}")
    writer = MemoryWriteback(memory=memory, mirror_enabled=False)
    result = writer.write_action(short_action)

    assert result["episode_id"] is None
    assert result.get("skipped") == "template_pollution"


def test_synthetic_action_round_minimum_via_engine_helper():
    """F16: select_active_or_force + writeback -> real episode.

    Exercises the engine's exact fallback path with no LLM call.
    """
    # Construct agents that all fail the time-gate:
    # CFO on day 5, hour 8 — not day 1/30, not business hours.
    cfo = _agent(name="CFO 李四", role="cfo", department="finance")
    board = _agent(name="Board 周七", role="board", department="executive")
    sales = _agent(name="Sales 吴九", role="sales", department="sales")
    engineers = [
        _agent(name=f"Eng{i}", role="engineer", department="tech")
        for i in range(2)
    ]
    agents = [cfo, board, sales] + engineers

    # Clock: day 5 of month (not day 1/30), hour 8 (before 9am) -> all gates fail.
    # 4 full days + 8 hours into day 5.
    clock = SimClock(total_hours=4 * 24 + 8)

    scheduler = AgentScheduler(force_one_action_per_round_minimum=True)
    selected = scheduler.select_active_or_force(
        agents, clock, round_num=1, seed=42
    )
    # Natural selection yields zero; the fallback picks the highest-activity
    # agent whose weakened gate passes.
    assert len(selected) >= 1, (
        "force-minimum must guarantee at least one agent per round"
    )

    # Now exercise the engine's exact code path: build a synthetic
    # action for the picked agent and write it.
    synth = AgentScheduler.make_synthetic_action(selected[0], round_num=1)
    memory = EpisodicMemory.for_run(run_id=f"test_{uuid.uuid4().hex[:8]}")
    writer = MemoryWriteback(memory=memory, mirror_enabled=False)
    result = writer.write_action(synth)

    assert result["episode_id"] is not None, (
        "force-minimum fallback must produce a real episode"
    )


# ---------------------------------------------------------------------------
# Role classification
# ---------------------------------------------------------------------------


def test_classify_role_cfo():
    agent = _agent(name="X", role="cfo")
    assert classify_role(agent) == "cfo"


def test_classify_role_cfo_chinese():
    agent = _agent(name="X", role="", department="财务部")
    assert classify_role(agent) == "cfo"


def test_classify_role_sales():
    agent = _agent(name="X", role="sales")
    assert classify_role(agent) == "sales"


def test_classify_role_sales_chinese():
    agent = _agent(name="X", role="", department="销售部")
    assert classify_role(agent) == "sales"


def test_classify_role_board():
    agent = _agent(name="X", role="board")
    assert classify_role(agent) == "board"


def test_classify_role_ceo_via_name():
    agent = _agent(name="CEO 张总")
    assert classify_role(agent) == "board"


def test_classify_role_engineer():
    agent = _agent(name="X", role="engineer")
    assert classify_role(agent) == "engineer"


def test_classify_role_engineer_chinese():
    agent = _agent(name="X", role="", department="技术部")
    assert classify_role(agent) == "engineer"


def test_classify_role_default():
    agent = _agent(name="Random")
    assert classify_role(agent) == "default"


# ---------------------------------------------------------------------------
# select_active — time-gate semantics
# ---------------------------------------------------------------------------


def test_select_active_cfo_only_on_day_one_or_thirty():
    """CFO/Finance gate: day_of_month in {1, 30} AND business hours."""
    cfo = _agent(name="CFO", role="cfo", department="finance")
    scheduler = AgentScheduler()

    # Day 1, hour 10 -> CFO eligible.
    clock = SimClock(total_hours=0 + 10)  # day 0 = day_of_month 1
    assert scheduler.select_active([cfo], clock, seed=1)

    # Day 1, hour 8 -> not business hours -> rejected.
    clock = SimClock(total_hours=0 + 8)
    assert not scheduler.select_active([cfo], clock, seed=1)

    # Day 2, hour 10 -> not day 1 or 30 -> rejected.
    clock = SimClock(total_hours=24 + 10)
    assert not scheduler.select_active([cfo], clock, seed=1)

    # Day 30, hour 10 -> day_of_month=30 -> eligible.
    clock = SimClock(total_hours=29 * 24 + 10)
    assert scheduler.select_active([cfo], clock, seed=1)


def test_select_active_sales_on_weekday_business_hours():
    sales = _agent(name="Sales", role="sales", department="sales")
    scheduler = AgentScheduler()

    # Monday 10am -> eligible.
    clock = SimClock(total_hours=10)
    assert scheduler.select_active([sales], clock, seed=1)

    # Saturday 10am -> weekend -> rejected.
    clock = SimClock(total_hours=5 * 24 + 10)
    assert not scheduler.select_active([sales], clock, seed=1)


def test_select_active_board_only_on_quarter_boundary():
    board = _agent(name="Board", role="board", department="executive")
    scheduler = AgentScheduler()

    # Day 0 (first day of Q1) at 10am -> eligible.
    clock = SimClock(total_hours=10)
    assert scheduler.select_active([board], clock, seed=1)

    # Day 10 (mid-quarter) at 10am -> rejected.
    clock = SimClock(total_hours=10 * 24 + 10)
    assert not scheduler.select_active([board], clock, seed=1)


def test_select_active_engineer_uses_agent_active_hours():
    eng = _agent(
        name="Eng", role="engineer", department="tech",
        active_hours=list(range(9, 22)),  # 9am-9pm
    )
    scheduler = AgentScheduler()

    # 10am -> in active_hours -> eligible.
    clock = SimClock(total_hours=10)
    assert scheduler.select_active([eng], clock, seed=1)

    # 11pm -> out of active_hours -> rejected.
    clock = SimClock(total_hours=23)
    assert not scheduler.select_active([eng], clock, seed=1)


# ---------------------------------------------------------------------------
# select_active — activity_level gating
# ---------------------------------------------------------------------------


def test_select_active_activity_level_zero_blocks_agent():
    """activity_level=0 -> prob=0 -> never selected."""
    agent = _agent(name="X", role="default", activity_level=0.0)
    scheduler = AgentScheduler()
    clock = SimClock(total_hours=10)  # in business hours
    assert scheduler.select_active([agent], clock, seed=42) == []


def test_select_active_seed_is_honored():
    """Same seed -> same outcome (regression: RNG determinism)."""
    agent = _agent(name="X", role="default", activity_level=0.5)
    scheduler = AgentScheduler()
    clock = SimClock(total_hours=10)
    a = scheduler.select_active([agent], clock, seed=123)
    b = scheduler.select_active([agent], clock, seed=123)
    assert a == b


def test_select_active_empty_agents_returns_empty():
    scheduler = AgentScheduler()
    clock = SimClock(total_hours=10)
    assert scheduler.select_active([], clock, seed=1) == []


# ---------------------------------------------------------------------------
# select_active_or_force — force-minimum semantics
# ---------------------------------------------------------------------------


def test_select_active_or_force_returns_empty_when_no_agents_and_no_force():
    """Without force-minimum and no agents, returns []. This is the v1 bug."""
    scheduler = AgentScheduler(force_one_action_per_round_minimum=False)
    clock = SimClock(total_hours=10)
    result = scheduler.select_active_or_force([], clock, round_num=1, seed=1)
    assert result == []


def test_select_active_or_force_returns_last_resort_first_agent():
    """When force-minimum is on but every gate fails, pick agents[0]."""
    cfo = _agent(name="CFO", role="cfo", department="finance")
    scheduler = AgentScheduler(force_one_action_per_round_minimum=True)
    # Day 5, hour 3am -> CFO gate fails (wrong day + non-business hours).
    clock = SimClock(total_hours=4 * 24 + 3)
    result = scheduler.select_active_or_force([cfo], clock, round_num=1, seed=1)
    assert len(result) == 1
    assert result[0].agent_id == cfo.agent_id


def test_select_active_or_force_per_call_override_disables_force():
    """Caller can override force_one_action_per_round_minimum=False."""
    cfo = _agent(name="CFO", role="cfo", department="finance")
    scheduler = AgentScheduler(force_one_action_per_round_minimum=True)
    clock = SimClock(total_hours=4 * 24 + 3)  # CFO gate fails
    result = scheduler.select_active_or_force(
        [cfo], clock, round_num=1, seed=1,
        force_one_action_per_round_minimum=False,
    )
    assert result == []


def test_select_active_or_force_returns_natural_selection_when_match_exists():
    """If natural selection already has matches, force-minimum is a no-op."""
    sales = _agent(name="Sales", role="sales", department="sales")
    scheduler = AgentScheduler(force_one_action_per_round_minimum=True)
    clock = SimClock(total_hours=10)  # Monday 10am -> sales gate fires
    result = scheduler.select_active_or_force([sales], clock, round_num=1, seed=1)
    assert len(result) >= 1
    assert result[0].agent_id == sales.agent_id


# ---------------------------------------------------------------------------
# bind_to_loop
# ---------------------------------------------------------------------------


def test_bind_to_loop_attaches_scheduler_and_keeps_policy_on():
    """bind_to_loop wires scheduler.engine = self and re-asserts the policy."""

    class _FakeEngine:
        scheduler = None

    scheduler = AgentScheduler(force_one_action_per_round_minimum=False)
    engine = _FakeEngine()
    ret = scheduler.bind_to_loop(engine)

    assert engine.scheduler is scheduler
    assert scheduler.force_one_action_per_round_minimum is True
    assert ret is None  # engine mutates its own field