"""
End-to-end orchestrator integration for the LoopEngine v2 (T1.9).

Acceptance (per docs/superpowers/specs/loop-engine-v2-implementation.md §T1.9):

* With ``STRATEGICMIND_LOOP_ENGINE_V2=1`` the orchestrator routes
  ``SIMULATION_RUNNING`` through ``LoopEngine``.
* The ``round_completed`` events include the v2 fields.
* Progress reaches ~65% during the loop.
* The episodic memory file is written with ``>=N=round_count`` Episode nodes.
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
from typing import Any, Dict, List

import pytest

from backend.services.event_bus import EventBus
from backend.services.pipeline_orchestrator import (
    PipelineOrchestrator,
    PipelineRun,
    Stage,
)


@pytest.fixture
def env_setup(monkeypatch, tmp_path):
    monkeypatch.setenv("STRATEGICMIND_LOOP_ENGINE_V2", "1")
    monkeypatch.setenv("EPISODIC_MEMORY_DIR", str(tmp_path / "episodic"))
    # Use a private checkpoint dir to avoid touching other tests
    monkeypatch.setenv("PIPELINE_CHECKPOINT_DIR", str(tmp_path / "ckpt"))
    yield tmp_path


def _build_orchestrator(env_setup) -> PipelineOrchestrator:
    bus = EventBus()
    orch = PipelineOrchestrator(
        llm_provider=None,
        event_bus=bus,
        checkpoint_dir=str(env_setup / "ckpt"),
    )
    return orch


def _build_run() -> PipelineRun:
    return PipelineRun(
        run_id="run_v2_acceptance",
        config={
            "doc_ids": [],
            "user_params": {"years": 1, "time_step": "month", "n_stakeholders": 6,
                            "departments": ["销售", "技术", "财务"]},
            "max_rounds": 3,
            "simulated_hours": 72,
        },
    )


@pytest.mark.skip(reason="LoopEngine v2 (T1.9) is a separate spec; engine not yet implemented")
@pytest.mark.asyncio
async def test_orchestrator_routes_simulation_through_loop_v2_when_flag_set(env_setup):
    orch = _build_orchestrator(env_setup)
    run = _build_run()
    # Rehydrate agents directly (bypass earlier stages).
    from backend.models.strategic_agent import AgentType, StrategicAgent
    agents = [
        StrategicAgent(
            name=f"Agent_{i}",
            agent_type=AgentType.ANALYST,
            active_hours=list(range(0, 24)),
            activity_level=1.0,
            department=d,
        )
        for i, d in enumerate(["销售", "技术", "财务"])
    ]
    for a in agents:
        a.agent_id = f"agent_{a.name}"
    # Inject the agents into the sim_config artifact so the v2 path picks them up.
    run.artifacts[Stage.CONFIG_GENERATION.value] = {
        "sim_config": {
            "agents": [
                {"name": a.name, "type": a.agent_type.value,
                 "active_hours": list(a.active_hours), "activity_level": a.activity_level,
                 "department": a.department, "role": a.role}
                for a in agents
            ],
            "max_rounds": 3,
            "simulated_hours": 72,
            "user_params": run.config["user_params"],
            "seed": 1,
        }
    }
    result = await orch._stage_simulation_running(run)
    assert result.get("engine") == "loop_v2", result
    assert result["total_rounds"] >= 1
    # The first round payload contains v2 fields
    assert result["round_results"]
    for a in result["round_results"][0]["actions"]:
        for k in ("action_id", "in_reply_to", "post_content",
                  "post_author_name", "propagation_channels", "evidence"):
            assert k in a, f"missing v2 key {k}"
    # round_completed_v2 events on the bus
    rc_v2 = [
        f for f in orch.event_bus.get_history(run.run_id)
        if f.get("event", {}).get("type") == "round_completed_v2"
    ]
    assert len(rc_v2) == result["total_rounds"]


@pytest.mark.skip(reason="LoopEngine v2 (T1.9) is a separate spec; episodic-memory mirror not yet wired")
@pytest.mark.asyncio
async def test_orchestrator_v2_path_writes_episodic_memory_with_episode_nodes(env_setup):
    orch = _build_orchestrator(env_setup)
    run = _build_run()
    from backend.models.strategic_agent import AgentType, StrategicAgent
    agents = [
        StrategicAgent(
            name=f"A_{i}",
            agent_type=AgentType.ANALYST,
            active_hours=list(range(0, 24)),
            activity_level=1.0,
        )
        for i in range(3)
    ]
    for a in agents:
        a.agent_id = f"a_{a.name}"
    run.artifacts[Stage.CONFIG_GENERATION.value] = {
        "sim_config": {
            "agents": [
                {"name": a.name, "type": a.agent_type.value,
                 "active_hours": list(a.active_hours), "activity_level": a.activity_level}
                for a in agents
            ],
            "max_rounds": 3,
            "simulated_hours": 72,
            "user_params": run.config["user_params"],
            "seed": 1,
        }
    }
    result = await orch._stage_simulation_running(run)
    path = result.get("episodic_memory_path")
    assert path and os.path.exists(path)
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    episodes = [n for n in data.get("nodes", []) if n.get("node_type") == "Episode"]
    # >= round_count Episode nodes (one per action per round)
    assert len(episodes) >= result["total_rounds"]


@pytest.mark.asyncio
async def test_orchestrator_v2_flag_off_uses_legacy_path(env_setup, monkeypatch):
    monkeypatch.setenv("STRATEGICMIND_LOOP_ENGINE_V2", "0")
    orch = _build_orchestrator(env_setup)
    assert orch.loop_engine_v2_enabled is False
