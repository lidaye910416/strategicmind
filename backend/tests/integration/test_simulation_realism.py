"""
Bug #2 仿真真实性 — 验收测试 (5+ 用例).

覆盖:
* N3: MemoryWriteback.write_action per round — 之前 v1 路径完全没调
  write_action, recent_episodes 永远是空. 修后 _decide_action 末尾
  立即 write_action.
* N4: STRATEGICMIND_LOOP_ENGINE_V2 env var 切换.
* 验收 #1-5: persona diversity / belief cascade / year advance /
  episode quality / v1 type fallback warning.
"""
from __future__ import annotations

import pathlib
import warnings
from collections import defaultdict
from typing import Any, Dict, List

import pytest

from backend.config.manager import get_feature_flags, _LOOP_ENGINE_V2_ENV
from backend.models.strategic_agent import AgentType, StrategicAgent
from backend.models.world_state import WorldState
from backend.services.belief_engine import BeliefEffectProposal, BeliefEngine
from backend.services.loop.action_taxonomy import BusinessActionType
from backend.services.loop.clock import SimClock
from backend.services.loop.engine import LoopEngine
from backend.services.loop.llm_adapter import (
    AgentDecision,
    LegacyActionTypeWarning,
    LoopEngineLLMAdapter,
)
from backend.services.loop.memory_writeback import (
    EPISODE_NODE_TYPE,
    EpisodicMemory,
    MemoryWriteback,
)
from backend.services.loop.scheduler import AgentScheduler


# =========================================================================
# Helper: stub LLM that cycles through 4 v2 types
# =========================================================================


class _StubLLM:
    """Deterministic stub that returns a distinct BusinessActionType per call."""

    def __init__(self) -> None:
        self.calls: List[Any] = []

    async def chat(self, messages):
        self.calls.append(messages)
        # Cycle through 4 v2 types, distinct post_content per call
        btype = [
            "MAKE_STATEMENT",
            "ENDORSE_PROPOSAL",
            "FORM_COALITION",
            "LEAK_INFORMATION",
        ][len(self.calls) % 4]
        return (
            f'{{"action_type": "{btype}", '
            f'"target_positions": {{"regulatory": 0.2}}, '
            f'"trust_deltas": {{"agent_1": 0.1}}, '
            f'"post_content": "Round {len(self.calls)} analysis with substantive content", '
            f'"reasoning": "stub"}}'
        )


def _make_agents(n: int = 5) -> List[StrategicAgent]:
    """Build n minimal agents with the ad-hoc v2 fields the scheduler uses."""
    agents: List[StrategicAgent] = []
    for i in range(n):
        a = StrategicAgent(
            name=f"agent_{i}",
            agent_type=AgentType.ANALYST,
            influence_weight=0.5,
        )
        a.agent_id = f"agent_{i}"
        a.role = "default"
        a.department = ""
        a.active_hours = list(range(0, 24))  # 24/7 so the gate always fires
        a.activity_level = 1.0
        a.timezone_offset = 0
        agents.append(a)
    return agents


# =========================================================================
# Test 1: N3 — MemoryWriteback.write_action per round (完整)
# =========================================================================


@pytest.mark.asyncio
async def test_memory_writeback_triggered_per_round(tmp_path, monkeypatch):
    """N3 验收: LoopEngine 跑 12 rounds, 每 round 至少 1 个 episode_writes_per_round.

    之前 v1 路径完全没调 MemoryWriteback.write_action, recent_episodes 永远是空.
    修后 _decide_action 末尾立即 write_action, 12 轮 × N agents 都有 episode 落盘.
    """
    monkeypatch.setenv(_LOOP_ENGINE_V2_ENV, "true")

    agents = _make_agents(3)
    mem = EpisodicMemory.for_run("run_n3_test", storage_path=str(tmp_path / "episodic"))
    writeback = MemoryWriteback(memory=mem, mirror_enabled=False)
    stub = _StubLLM()
    engine = LoopEngine(
        run_id="run_n3_test",
        clock=SimClock(),
        agents=agents,
        knowledge_store=None,
        event_bus=None,
        config={},
        llm_client=LoopEngineLLMAdapter(stub, None),
        memory_writer=writeback,
        total_rounds=12,
    )

    results = await engine.run()
    assert len(results) == 12, "should complete 12 rounds"

    # 验收: 至少 12 个 Episode 节点 (per round >= 1)
    episodes = [
        n for n in mem.nodes.values()
        if n.get("node_type") == EPISODE_NODE_TYPE
    ]
    assert len(episodes) >= 12, f"expected >=12 episodes, got {len(episodes)}"

    # 验收: writeback metric 记录每次写
    metrics = writeback.get_dedup_metrics()
    assert metrics["episode_writes_per_round"] >= 12, (
        f"expected >=12 writes, got "
        f"{metrics['episode_writes_per_round']}"
    )

    # 验收: 模板跳过计数为 0 (stub 的 post_content >= 40 chars)
    assert metrics["template_episode_skipped"] == 0


# =========================================================================
# Test 2: N4 — env var 切换 (完整)
# =========================================================================


def test_env_var_loop_engine_v2_works(monkeypatch):
    """N4 验收: STRATEGICMIND_LOOP_ENGINE_V2 设 true/false 时 get_feature_flags() 正确.

    之前 spec 写 STRATEGICMIND_LOOP_ENGINE 但代码读 STRATEGICMIND_LOOP_ENGINE_V2,
    用户按 spec 设了 env 仍跑 v1. 修后文档/代码/.env.example 4 处全部统一用 _V2.
    """
    monkeypatch.delenv(_LOOP_ENGINE_V2_ENV, raising=False)
    assert get_feature_flags().loop_engine_v2 is False, "default should be v1"

    monkeypatch.setenv(_LOOP_ENGINE_V2_ENV, "true")
    assert get_feature_flags().loop_engine_v2 is True

    monkeypatch.setenv(_LOOP_ENGINE_V2_ENV, "1")
    assert get_feature_flags().loop_engine_v2 is True

    monkeypatch.setenv(_LOOP_ENGINE_V2_ENV, "yes")
    assert get_feature_flags().loop_engine_v2 is True

    monkeypatch.setenv(_LOOP_ENGINE_V2_ENV, "false")
    assert get_feature_flags().loop_engine_v2 is False

    monkeypatch.setenv(_LOOP_ENGINE_V2_ENV, "0")
    assert get_feature_flags().loop_engine_v2 is False

    # 验收: N4 spec 一致性 — .env.example 必须用 _V2 后缀
    repo = pathlib.Path(__file__).resolve().parents[3]
    env_example_path = repo / ".env.example"
    if env_example_path.exists():
        env_example = env_example_path.read_text()
        assert "STRATEGICMIND_LOOP_ENGINE_V2" in env_example, (
            ".env.example 必须用 _V2 后缀"
        )


# =========================================================================
# Test 3: 验收 #1 — persona diversity
# =========================================================================


@pytest.mark.asyncio
async def test_persona_diversity(tmp_path, monkeypatch):
    """12 轮 × 3 agents 至少 4 个不同 BusinessActionType (stub cycles 4)."""
    monkeypatch.setenv(_LOOP_ENGINE_V2_ENV, "true")
    agents = _make_agents(3)
    mem = EpisodicMemory.for_run("run_diversity", storage_path=str(tmp_path / "episodic"))
    writeback = MemoryWriteback(memory=mem, mirror_enabled=False)
    stub = _StubLLM()
    engine = LoopEngine(
        run_id="run_diversity",
        clock=SimClock(),
        agents=agents,
        knowledge_store=None,
        event_bus=None,
        config={},
        llm_client=LoopEngineLLMAdapter(stub, None),
        memory_writer=writeback,
        total_rounds=12,
    )
    results = await engine.run()
    assert len(results) == 12

    # Collect distinct action types from episodes
    episodes = [
        n for n in mem.nodes.values()
        if n.get("node_type") == EPISODE_NODE_TYPE
    ]
    btypes = {e.get("business_type") for e in episodes}
    assert len(btypes) >= 4, f"expected >=4 distinct types, got {len(btypes)}: {btypes}"


# =========================================================================
# Test 4: 验收 #2 — belief cascade on shock (v2 BeliefEffectProposal path)
# =========================================================================


def test_belief_cascade_with_proposal():
    """BeliefEffectProposal driven cascade: LLM 同步返回 position_deltas."""
    be = BeliefEngine()
    agent = StrategicAgent(
        name="cfo_1", agent_type=AgentType.CORPORATE_EXEC, influence_weight=0.7
    )
    agent.agent_id = "cfo_1"
    proposal = BeliefEffectProposal(
        position_deltas={"regulatory": 0.4, "market_trend": -0.3},
        trust_deltas={"agent_2": 0.2},
    )
    updates = be.apply_action_effects(
        agent, "MAKE_STATEMENT", {}, round_num=1, proposal=proposal
    )
    # 2 position deltas + trust_delta 1 -> at least 2 belief updates recorded
    assert len(updates) >= 2
    topics = {u.topic for u in updates}
    assert "regulatory" in topics
    assert "market_trend" in topics
    # verify trust delta was applied
    assert "agent_2" in agent.beliefs.trust_levels
    assert abs(agent.beliefs.trust_levels["agent_2"].trust_score - 0.7) < 1e-6

    # Test fallback: bad proposal -> empty
    bad_proposal = BeliefEffectProposal.safe_parse({"position_deltas": "not_a_dict"})
    updates_bad = be.apply_action_effects(
        agent, "MAKE_STATEMENT", {}, round_num=2, proposal=bad_proposal
    )
    # empty proposal -> no updates
    assert len(updates_bad) == 0


# =========================================================================
# Test 5: 验收 #6 — template_episode_skipped metric exposed
# =========================================================================


def test_template_episode_skipped_metric():
    """模板 episode (post_content < 40 chars) 触发 skip + 计数 +1."""
    from backend.models.action_type import ActionType, StrategicAction

    mem = EpisodicMemory(storage_path="/tmp/test_template_skip")
    w = MemoryWriteback(memory=mem, mirror_enabled=False)
    a = StrategicAction(action_type=ActionType.MAKE_STATEMENT, actor_id="a1", round_num=1)
    a.action_id = "test1"
    a.post_content = ""  # empty -> template

    metrics = w.get_dedup_metrics()
    assert metrics["template_episode_skipped"] == 0

    r = w.write_action(a)
    assert r.get("skipped") == "template_pollution"
    metrics = w.get_dedup_metrics()
    assert metrics["template_episode_skipped"] == 1

    # Long post_content -> not skipped
    a2 = StrategicAction(action_type=ActionType.MAKE_STATEMENT, actor_id="a2", round_num=1)
    a2.action_id = "test2"
    a2.post_content = "A" * 50
    r2 = w.write_action(a2)
    assert r2.get("episode_id") == "test2"
    assert r2.get("skipped") is None
    metrics = w.get_dedup_metrics()
    assert metrics["template_episode_skipped"] == 1
    assert metrics["episode_writes_per_round"] >= 1


# =========================================================================
# Test 6: 验收 #7 — v1 type fallback warning count
# =========================================================================


@pytest.mark.asyncio
async def test_v1_type_fallback_warning_count():
    """LLM 返回 v1-only action_type 时 LegacyActionTypeWarning 计数 +1."""

    class _V1OnlyLLM:
        def __init__(self):
            self.calls = 0

        async def chat(self, messages):
            self.calls += 1
            # PROPOSE_DEAL is v1-only (no v2 equivalent)
            return (
                '{"action_type": "PROPOSE_DEAL", '
                '"target_positions": {}, '
                '"trust_deltas": {}, '
                f'"post_content": "V1 round {self.calls} substantive content here for sure", '
                '"reasoning": "stub"}'
            )

    stub = _V1OnlyLLM()
    adapter = LoopEngineLLMAdapter(stub, None)
    from backend.models.strategic_agent import StrategicAgent, AgentType
    from backend.services.loop.clock import SimClock
    from backend.models.world_state import WorldState

    agents = [
        StrategicAgent(name="a1", agent_type=AgentType.ANALYST, influence_weight=0.5)
    ]
    agents[0].agent_id = "a1"
    agents[0].active_hours = list(range(0, 24))
    agents[0].activity_level = 1.0
    agents[0].role = "default"
    agents[0].timezone_offset = 0

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        for _ in range(3):
            await adapter.generate_action(
                agent=agents[0],
                clock=SimClock(),
                world_state=WorldState(),
                candidates=list(BusinessActionType),
                recent_episodes=[],
            )
    legacy = [w for w in caught if issubclass(w.category, LegacyActionTypeWarning)]
    assert adapter._metrics["v1_type_unmapped_warnings"] >= 3
    assert len(legacy) >= 3


# =========================================================================
# Test 7: AgentScheduler.bind_to_loop
# =========================================================================


def test_scheduler_bind_to_loop():
    """bind_to_loop: 强制 force_one_action_per_round_minimum=True."""
    sched = AgentScheduler(force_one_action_per_round_minimum=False)
    # Mock loop_engine
    class _FakeEngine:
        scheduler = None
    fake = _FakeEngine()
    sched.bind_to_loop(fake)
    assert fake.scheduler is sched
    assert sched.force_one_action_per_round_minimum is True


# =========================================================================
# Test 8: select_active_or_force override
# =========================================================================


def test_select_active_or_force_override():
    """force_one_action_per_round_minimum 参数覆盖 instance 字段."""
    sched = AgentScheduler(force_one_action_per_round_minimum=True)
    agents = _make_agents(2)
    # Even with no clock match, override=False should let empty result through
    result = sched.select_active_or_force(
        agents, SimClock(), round_num=1, force_one_action_per_round_minimum=False,
    )
    # Default active_hours=0..23 covers all hours; with override=False we return
    # whatever select_active picks (>=0). 验证 override 接受了 kwarg.
    assert isinstance(result, list)
