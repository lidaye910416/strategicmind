"""
Integration tests for LoopEngine (T1.8 acceptance).

Acceptance (per docs/superpowers/specs/loop-engine-v2-implementation.md §T1.8):

* Instantiate LoopEngine with a stub LLM.
* Run 3 rounds; assert:
  * clock advanced 3×24h,
  * 3 Episode nodes in knowledge store,
  * 3 round_completed events emitted,
  * every action has a unique action_id, and in_reply_to is None
    when the agent has no prior action.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from typing import Any, Dict, List

import pytest

from backend.models.action_type import ActionType, StrategicAction
from backend.models.strategic_agent import AgentType, StrategicAgent
from backend.models.world_state import WorldState
from backend.services.event_bus import EventBus
from backend.services.loop.action_taxonomy import BusinessActionType
from backend.services.loop.clock import SimClock
from backend.services.loop.engine import LoopEngine, RoundResult
from backend.services.loop.event_injector import EventInjector
from backend.services.loop.scheduler import AgentScheduler


# ---------------------------------------------------------------------------
# Stub LLM — implements the LLMClient protocol
# ---------------------------------------------------------------------------


class _StubLLM:
    """Returns a deterministic MAKE_STATEMENT per call, with a unique action_id.

    The stub also rotates the post_content so we can detect duplicates
    (the engine should not collapse them).
    """

    def __init__(self) -> None:
        self.call_count = 0

    async def generate_action(
        self,
        *,
        agent: StrategicAgent,
        clock: SimClock,
        world_state: WorldState,
        candidates,
        recent_episodes=(),
    ) -> StrategicAction:
        self.call_count += 1
        a = StrategicAction(
            action_type=ActionType.MAKE_STATEMENT,
            actor_id=agent.agent_id,
            round_num=0,
            propagation_channels=[],
        )
        # v2 fields live as ad-hoc attributes on the legacy
        # StrategicAction dataclass.
        # Bug #2: post_content >= 40 chars to avoid template pollution.
        a.post_content = f"Round {clock.day_index} — {agent.name} 发言 #{self.call_count}: 战略分析与决策建议"
        a.post_author_name = agent.name or agent.agent_id
        a.evidence = []
        # Force v2 type.
        from backend.services.loop.action_taxonomy import set_business_type
        set_business_type(a, BusinessActionType.MAKE_STATEMENT)
        return a


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def tmp_dir(monkeypatch):
    d = tempfile.mkdtemp(prefix="loop_engine_")
    monkeypatch.setenv("EPISODIC_PATH", d)
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def three_agents() -> List[StrategicAgent]:
    out: List[StrategicAgent] = []
    for i, (name, atype, dept) in enumerate([
        ("Stakeholder_1", AgentType.CORPORATE_EXEC, "销售"),
        ("Stakeholder_2", AgentType.ANALYST, "财务"),
        ("Stakeholder_3", AgentType.MEDIA, "技术"),
    ]):
        a = StrategicAgent(name=name, agent_type=atype)
        a.active_hours = list(range(0, 24))
        a.activity_level = 1.0  # always eligible
        a.department = dept
        a.timezone_offset = 0
        out.append(a)
    return out


# ---------------------------------------------------------------------------
# T1.8 acceptance — 3-round integration test with stub LLM
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_loop_engine_runs_three_rounds_with_stub_llm(tmp_dir, three_agents):
    """T1.8 acceptance: 3 rounds, clock advances 3x24h, episodes = agents * rounds, 3 events."""
    bus = EventBus()
    clock = SimClock()
    llm = _StubLLM()
    ws = WorldState()
    # Use a unique episodic memory per test to avoid on-disk cross-test pollution.
    from backend.services.loop.memory_writeback import EpisodicMemory, MemoryWriteback
    mem = EpisodicMemory.for_run("run_acceptance_3r_" + tmp_dir[-12:], storage_path=tmp_dir)
    engine = LoopEngine(
        run_id="run_acceptance_3r_" + tmp_dir[-12:],
        clock=clock,
        agents=three_agents,
        knowledge_store=None,
        event_bus=bus,
        config={"user_params": {"external_factors": []}},
        llm_client=llm,
        world_state=ws,
        total_rounds=3,
        hours_per_round=24,
        seed=42,
        scheduler=AgentScheduler(force_one_action_per_round_minimum=True),
        event_injector=EventInjector(seed=0, base_probability=0.0),
        memory_writer=MemoryWriteback(memory=mem),
    )

    results: List[RoundResult] = await engine.run()

    assert len(results) == 3
    # Clock advanced 3 × 24h
    assert clock.total_hours == 3 * 24
    # Every action has a unique action_id
    action_ids = [a.action_id for r in results for a in r.actions]
    assert len(action_ids) == len(set(action_ids)), "action_ids must be unique"

    # At least one action per round (force-minimum)
    for r in results:
        assert r.actions, f"round {r.round_num} produced no actions"

    # First-round actions have in_reply_to = None (no prior action).
    # v2 field is an ad-hoc attribute on the legacy dataclass.
    for a in results[0].actions:
        assert getattr(a, "in_reply_to", None) is None

    # Round 2+ actions by the same actor have in_reply_to pointing to round N-1
    for r_idx in range(1, 3):
        for a2 in results[r_idx].actions:
            prior = next(
                (a for a in results[r_idx - 1].actions if a.actor_id == a2.actor_id),
                None,
            )
            if prior is not None:
                assert getattr(a2, "in_reply_to", None) == prior.action_id, (
                    f"round {r_idx + 1} action by {a2.actor_id} should reply to {prior.action_id}"
                )

    # 3 round_completed events emitted
    rc_frames = [f for f in bus.get_history(engine.run_id) if f.get("event", {}).get("type") == "round_completed"]
    assert len(rc_frames) == 3

    # Episode count = sum of actions per round (= 3 rounds × N agents/round)
    from backend.services.loop.memory_writeback import EPISODE_NODE_TYPE
    episodes = [n for n in engine.memory_writer.memory.nodes.values() if n.get("node_type") == EPISODE_NODE_TYPE]
    expected_episodes = sum(len(r.actions) for r in results)
    assert len(episodes) == expected_episodes, (
        f"expected {expected_episodes} Episode nodes, got {len(episodes)}"
    )


@pytest.mark.asyncio
async def test_loop_engine_round_completed_payload_includes_v2_fields(tmp_dir, three_agents):
    bus = EventBus()
    llm = _StubLLM()
    from backend.services.loop.memory_writeback import EpisodicMemory, MemoryWriteback
    mem = EpisodicMemory.for_run("run_payload_" + tmp_dir[-12:], storage_path=tmp_dir)
    engine = LoopEngine(
        run_id="run_payload_" + tmp_dir[-12:],
        clock=SimClock(),
        agents=three_agents,
        knowledge_store=None,
        event_bus=bus,
        config={"user_params": {}},
        llm_client=llm,
        total_rounds=1,
        hours_per_round=24,
        seed=1,
        scheduler=AgentScheduler(force_one_action_per_round_minimum=True),
        event_injector=EventInjector(seed=0, base_probability=0.0),
        memory_writer=MemoryWriteback(memory=mem),
    )
    results = await engine.run()
    payload = results[0].to_event()
    # v2 fields
    assert payload["round"] == 1
    assert payload["actions"]
    for a in payload["actions"]:
        for k in (
            "action_id", "in_reply_to", "post_content",
            "post_author_name", "propagation_channels", "evidence",
        ):
            assert k in a, f"missing key {k} in action payload"


@pytest.mark.asyncio
async def test_loop_engine_uses_explicit_llm_client_no_fallback(tmp_dir, three_agents):
    """The engine never instantiates an LLM; it requires the injected one.

    We verify by inspecting the engine source for any ``os.environ`` /
    module-level LLM singleton lookup in the hot path.
    """
    import inspect
    from backend.services.loop.engine import LoopEngine
    src = inspect.getsource(LoopEngine)
    forbidden = ("os.environ", "create_llm_provider", "BailianAdapter")
    for term in forbidden:
        assert term not in src, (
            f"LoopEngine source must not contain '{term}' (explicit-injection invariant)"
        )
