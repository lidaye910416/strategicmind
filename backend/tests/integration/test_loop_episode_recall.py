"""
Step 6 feedback loop B1 — LLM decision context with episode recall.

This test closes the architectural gap identified as the #1 issue in
the Step 6 review: the loop engine's :class:`LoopEngine` was
unilaterally a "single-arrow dead end" — agents decided an action,
the action was persisted as an Episode, and *no future decision ever
consulted the Episode store*. The LLM was structurally blind to its
own history.

The fix has two structural halves that the test pins down:

1. :meth:`EpisodicMemory.recent_episodes` returns the most recent N
   Episode nodes (newest first), optionally filtered by agent.
2. :class:`LLMClient` protocol now requires ``recent_episodes`` and
   :class:`LoopEngine._decide_action` populates it from the Episodic
   store *before* calling the LLM.

Acceptance (per docs/superpowers/specs/loop-engine-v2-implementation.md
§Step 6 B1):

* 3 rounds, each agent produces 1 action per round.
* On round 3, ``recent_episodes(limit=5, agent_id=...)`` returns
  exactly 2 Episode nodes — one per prior round — for the same
  actor.
* The ``LLMClient.generate_action`` call is observed to receive a
  non-empty ``recent_episodes`` list (the protocol is honored end
  to end).
* Round 1 sees an empty list (no prior history).
* The defensive ``memory_writer is None`` path skips the recall
  without crashing the engine.
"""
from __future__ import annotations

import shutil
import tempfile
from typing import Any, Dict, List

import pytest

from backend.models.action_type import ActionType, PropagationChannel, StrategicAction
from backend.models.strategic_agent import AgentType, StrategicAgent
from backend.models.world_state import WorldState
from backend.services.event_bus import EventBus
from backend.services.loop.action_taxonomy import BusinessActionType, set_business_type
from backend.services.loop.clock import SimClock
from backend.services.loop.engine import LoopEngine
from backend.services.loop.event_injector import EventInjector
from backend.services.loop.memory_writeback import (
    EPISODE_NODE_TYPE,
    EpisodicMemory,
    MemoryWriteback,
)
from backend.services.loop.scheduler import AgentScheduler


# ---------------------------------------------------------------------------
# Recording LLM stub — implements the LLMClient protocol and captures
# every (recent_episodes, agent) pair we receive.
# ---------------------------------------------------------------------------


class _RecordingLLM:
    """Stub LLM that records the ``recent_episodes`` it received.

    Each call produces a deterministic MAKE_STATEMENT whose post_content
    echoes the number of prior episodes the engine recalled. That
    makes the "did the recall happen" property observable from the
    emitted actions as well as from the recorded calls.
    """

    def __init__(self) -> None:
        self.call_count: int = 0
        # One entry per (call_index, agent_id, recent_episodes)
        self.calls: List[Dict[str, Any]] = []

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
        # Convert to list-of-dicts for storage; Sequence may be a tuple.
        recents = list(recent_episodes or [])
        self.calls.append(
            {
                "call_index": self.call_count,
                "agent_id": agent.agent_id,
                "agent_name": agent.name,
                "round_num": int(getattr(clock, "day_index", 0)) + 1,
                "recent_episodes": recents,
                "recent_count": len(recents),
            }
        )
        a = StrategicAction(
            action_type=ActionType.MAKE_STATEMENT,
            actor_id=agent.agent_id,
            round_num=0,
            propagation_channels=[PropagationChannel.OFFICIAL],
        )
        # v2 fields live on the action as ad-hoc attributes since
        # the legacy StrategicAction dataclass doesn't declare them.
        a.post_content = (
            f"call#{self.call_count} agent={agent.name} "
            f"prior_episodes={len(recents)}"
        )
        a.post_author_name = agent.name or agent.agent_id
        a.evidence = []
        set_business_type(a, BusinessActionType.MAKE_STATEMENT)
        return a


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def tmp_path_dir():
    d = tempfile.mkdtemp(prefix="episode_recall_")
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def three_agents() -> List[StrategicAgent]:
    out: List[StrategicAgent] = []
    for i in range(3):
        a = StrategicAgent(
            name=f"RecallAgent_{i}",
            agent_type=AgentType.ANALYST,
        )
        a.agent_id = f"recall_agent_{i}"
        # The AgentScheduler accesses these as ad-hoc attributes, so
        # set them after construction (the legacy StrategicAgent
        # dataclass doesn't declare them as fields).
        a.active_hours = list(range(0, 24))
        a.activity_level = 1.0
        a.department = "销售" if i % 2 == 0 else "财务"
        a.role = ""
        a.timezone_offset = 0
        out.append(a)
    return out


def _build_engine(
    run_id: str,
    storage_path: str,
    agents: List[StrategicAgent],
    llm: _RecordingLLM,
    total_rounds: int = 3,
):
    bus = EventBus()
    clock = SimClock()
    mem = EpisodicMemory.for_run(run_id, storage_path=storage_path)
    writer = MemoryWriteback(memory=mem)
    engine = LoopEngine(
        run_id=run_id,
        clock=clock,
        agents=agents,
        knowledge_store=mem,
        event_bus=bus,
        config={"user_params": {"external_factors": []}},
        llm_client=llm,
        world_state=WorldState(),
        memory_writer=writer,
        scheduler=AgentScheduler(force_one_action_per_round_minimum=True),
        # Suppress shocks so the only Episodes in the graph are
        # agent-driven, giving us a clean count.
        event_injector=EventInjector(seed=0, base_probability=0.0),
        total_rounds=total_rounds,
        hours_per_round=24,
        seed=42,
    )
    return engine, bus, mem, writer


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_episodic_memory_recent_episodes_helper_basic(tmp_path_dir):
    """Unit-ish check on the EpisodicMemory.recent_episodes helper.

    Three Episodes with monotonically increasing created_at values
    plus one IN_REPLY_TO predecessor that has no created_at.
    We expect:

    * Newest-first ordering.
    * The no-timestamp predecessor sorts to the end.
    * ``agent_id`` filter restricts results to that actor only.
    * ``limit`` is respected.
    """
    mem = EpisodicMemory.for_run("basic_recall", storage_path=tmp_path_dir)
    # Episode A by agent_1
    mem.upsert_node(
        "ep_a", EPISODE_NODE_TYPE, actor_id="agent_1",
        text="A", created_at=100.0, round_num=1,
    )
    # Episode B by agent_2 — newer
    mem.upsert_node(
        "ep_b", EPISODE_NODE_TYPE, actor_id="agent_2",
        text="B", created_at=200.0, round_num=2,
    )
    # Episode C by agent_1 — newest
    mem.upsert_node(
        "ep_c", EPISODE_NODE_TYPE, actor_id="agent_1",
        text="C", created_at=300.0, round_num=3,
    )
    # A predecessor that has no created_at
    mem.upsert_node(
        "ep_pre", EPISODE_NODE_TYPE, actor_id="agent_x",
        text="(predecessor)", round_num=0,
    )

    # All-actor recall, newest first
    all_recents = mem.recent_episodes(limit=5)
    ids = [e["id"] for e in all_recents]
    # The no-timestamp predecessor should sort last
    assert ids[-1] == "ep_pre"
    # The first three are time-stamped, newest first
    assert ids[:3] == ["ep_c", "ep_b", "ep_a"]

    # Filter by agent_id=agent_1
    by_agent = mem.recent_episodes(limit=5, agent_id="agent_1")
    assert [e["id"] for e in by_agent] == ["ep_c", "ep_a"]

    # Limit honoured
    limited = mem.recent_episodes(limit=1)
    assert [e["id"] for e in limited] == ["ep_c"]

    # Defensive: limit<=0 yields empty list
    assert mem.recent_episodes(limit=0) == []
    assert mem.recent_episodes(limit=-3) == []


@pytest.mark.asyncio
async def test_engine_round_three_sees_two_prior_episodes(
    tmp_path_dir, three_agents
):
    """End-to-end B1 acceptance.

    Run 3 rounds. The scheduler's force-minimum policy picks one
    agent per round, and the same agent tends to be the "weakest
    gate" winner across rounds 1/2/3 (the active agents all have
    activity_level=1.0, so the first one is selected deterministi-
    cally with the same seed). This is exactly the right shape for
    the recall test: a *single* agent accumulates 3 episodes over
    3 rounds and the round-3 LLM call must see the 2 prior ones.

    Acceptance:

    * Round 1 -> 0 prior episodes (empty list).
    * Round 2 -> 1 prior episode.
    * Round 3 -> 2 prior episodes.
    * Per-agent filter: the prior episodes are all by the *same*
      actor as the one currently being queried.
    * Newest-first ordering: the round-3 recall's timestamps are
      monotonically decreasing.
    * The LLMClient protocol is honoured: every generate_action
      invocation received a ``recent_episodes`` keyword argument.
    """
    llm = _RecordingLLM()
    engine, bus, mem, writer = _build_engine(
        "recall_3r", tmp_path_dir, three_agents, llm, total_rounds=3,
    )

    results = await engine.run()
    assert len(results) == 3, f"expected 3 rounds, got {len(results)}"

    # ---- The force-minimum policy picks exactly one agent per round ----
    # (the activity_level=1.0 / same active_hours agents are tied, so
    # the first one wins deterministically with the same seed).
    actions_per_round = [len(r.actions) for r in results]
    assert actions_per_round == [1, 1, 1], (
        f"expected 1 action per round, got {actions_per_round}"
    )

    # ---- The LLM was called 3 times (one per round) ----
    assert llm.call_count == 3
    assert len(llm.calls) == 3

    # ---- Round 1: empty recall ----
    c1 = llm.calls[0]
    assert c1["round_num"] == 1
    assert c1["recent_count"] == 0, (
        f"round 1 must have 0 prior episodes, got {c1['recent_count']}"
    )
    assert c1["recent_episodes"] == []

    # ---- Round 2: 1 prior episode, by the same agent ----
    c2 = llm.calls[1]
    assert c2["round_num"] == 2
    assert c2["recent_count"] == 1, (
        f"round 2 must have 1 prior episode, got {c2['recent_count']}"
    )
    assert c2["recent_episodes"][0]["actor_id"] == c2["agent_id"]
    # That single recalled episode is one of the round-1 Episode nodes
    # in the EpisodicMemory — i.e. the engine actually pulled from the
    # store rather than fabricating context.
    round1_episode_id = results[0].actions[0].action_id
    assert c2["recent_episodes"][0]["id"] == round1_episode_id, (
        f"round 2 recall must be the round-1 episode "
        f"({round1_episode_id}), got {c2['recent_episodes'][0]['id']}"
    )

    # ---- Round 3: 2 prior episodes, all by the same agent, newest first ----
    c3 = llm.calls[2]
    assert c3["round_num"] == 3
    assert c3["recent_count"] == 2, (
        f"round 3 must have 2 prior episodes, got {c3['recent_count']}"
    )
    # Per-agent filter: all recents belong to this actor.
    actor_ids = {ep.get("actor_id") for ep in c3["recent_episodes"]}
    assert actor_ids == {c3["agent_id"]}, (
        f"per-agent filter broken: {actor_ids}"
    )
    # Newest-first ordering: created_at desc.
    timestamps = [ep.get("created_at", 0.0) for ep in c3["recent_episodes"]]
    assert timestamps == sorted(timestamps, reverse=True), (
        f"episodes must be newest first, got {timestamps}"
    )

    # ---- The same agent acted all 3 rounds ----
    # (we don't *require* this, but it is the expected shape with
    # activity_level=1.0 + identical active_hours + same seed; this
    # is what makes the B1 closure test trivially observable).
    acting_agents = {c["agent_id"] for c in llm.calls}
    assert len(acting_agents) == 1, (
        f"expected a single acting agent across 3 rounds, got {acting_agents}"
    )
    persistent_actor = next(iter(acting_agents))

    # ---- Memory store: 3 episodes written, all by the same actor ----
    episodes = [
        n for n in mem.nodes.values() if n.get("node_type") == EPISODE_NODE_TYPE
    ]
    assert len(episodes) == 3, f"expected 3 Episodes, got {len(episodes)}"
    for ep in episodes:
        assert ep["actor_id"] == persistent_actor

    # ---- Direct recent_episodes query from outside the engine ----
    # (proves the helper is reusable, not just an internal detail)
    # Note: by the time the run finishes there are 3 Episodes in the
    # store (one per round). The helper returns the 2 we asked for via
    # limit=2 — i.e. the *most recent 2* — which corresponds to the
    # round-2 and round-3 episodes.
    recents = mem.recent_episodes(limit=2, agent_id=persistent_actor)
    assert len(recents) == 2, (
        f"agent {persistent_actor}: limit=2 should return 2 most recent, "
        f"got {len(recents)}"
    )
    # Newest first — round-3 was written last.
    round3_ep_id = results[2].actions[0].action_id
    assert recents[0]["id"] == round3_ep_id, (
        f"newest episode should be round-3 ({round3_ep_id}), got {recents[0]['id']}"
    )
    for ep in recents:
        assert ep["node_type"] == EPISODE_NODE_TYPE
        assert ep["actor_id"] == persistent_actor


@pytest.mark.asyncio
async def test_engine_handles_missing_memory_writer_defensively(
    tmp_path_dir, three_agents
):
    """Defensive: if ``memory_writer`` is None, the engine must still run
    and pass an empty ``recent_episodes`` to the LLM (no exception,
    no fallback to module-level state).
    """
    llm = _RecordingLLM()
    bus = EventBus()
    clock = SimClock()
    engine = LoopEngine(
        run_id="recall_no_writer",
        clock=clock,
        agents=three_agents,
        knowledge_store=None,
        event_bus=bus,
        config={"user_params": {}},
        llm_client=llm,
        world_state=WorldState(),
        memory_writer=None,  # <-- the defensive path
        scheduler=AgentScheduler(force_one_action_per_round_minimum=True),
        event_injector=EventInjector(seed=0, base_probability=0.0),
        total_rounds=2,
        hours_per_round=24,
        seed=1,
    )

    # The engine's __post_init__ wires a default writer; for the
    # defensive path we manually clear it AFTER construction.
    engine.memory_writer = None

    results = await engine.run()
    assert len(results) == 2

    # Every LLM call must have received an empty recent_episodes.
    for c in llm.calls:
        assert c["recent_count"] == 0
        assert c["recent_episodes"] == []


@pytest.mark.asyncio
async def test_llm_client_protocol_signature_accepts_recent_episodes(
    tmp_path_dir, three_agents
):
    """Structural check: the LLMClient protocol signature exposes
    ``recent_episodes`` as a keyword-only parameter with a default
    of an empty tuple. This guards against accidental regressions
    where a future change drops the new parameter.
    """
    import inspect
    from backend.services.loop.engine import LLMClient

    src = inspect.getsource(LLMClient)
    assert "recent_episodes" in src, (
        "LLMClient protocol must declare recent_episodes (Step 6 B1)"
    )
    assert "Sequence[Dict[str, Any]]" in src or "Sequence[dict]" in src, (
        "LLMClient protocol should type-annotate recent_episodes as a "
        "Sequence of dict-like Episode nodes"
    )
    # And the engine actually passes it through.
    engine_src = inspect.getsource(LoopEngine._decide_action)
    assert "recent_episodes=recent_episodes" in engine_src, (
        "LoopEngine._decide_action must forward recent_episodes to the LLM"
    )
