"""
G5 (P4-LOOP) 多年循环 — 扩展 test_p4_loop.py，验证:
- 12 轮 → >=3 个 market_event (每 4 轮 1 次)
- external_factors=[X] → >=4 个 shock_injected (每 3 轮 1 次)
- 已 completed run, POST /advance-year → 跑 12 rounds
- POST /advance-year on 不存在 run → 404
- POST /advance-year on 仍 running run → 400

设计：复用 P4 的 _StubLLM + event_collector，HTTP 路径用 Flask test client
隔离 app context。
"""
import asyncio
import os
import sys
import time
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "..", ".."
)))

from backend.app import create_app
from backend.services.pipeline_orchestrator import (
    PipelineOrchestrator,
    PipelineRun,
)
from backend.services.event_bus import EventBus


# ---- 替身 LLM ----
class _StubLLM:
    async def chat(self, messages, **kwargs):
        return '{"action_type": "MAKE_STATEMENT", "public_description": "stub", "target_ids": [], "is_hidden": false, "private_intent": "stub"}'


@pytest.fixture
def stub_llm():
    return _StubLLM()


@pytest.fixture
def event_collector():
    bus = EventBus()
    captured: List[Dict[str, Any]] = []
    orig_emit = bus.emit

    def spy_emit(run_id, event_type, data, stage=None):
        captured.append({
            "run_id": run_id, "type": event_type,
            "data": dict(data), "stage": stage,
        })
        return orig_emit(run_id, event_type, data, stage=stage)

    bus.emit = spy_emit  # type: ignore[assignment]
    return bus, captured


def _make_run(cfg: Dict[str, Any], max_rounds: int = 12) -> PipelineRun:
    run = PipelineRun(run_id="g5t", config=cfg, status="running")
    run.artifacts = {
        "CONFIG_GENERATION": {
            "sim_config": {
                "agents": [
                    {"name": "Exec", "type": "corporate_exec",
                     "influence_weight": 0.9},
                    {"name": "Investor", "type": "institutional_investor",
                     "influence_weight": 0.6},
                    {"name": "Regulator", "type": "regulator",
                     "influence_weight": 0.5},
                ],
                "max_rounds": max_rounds,
                "simulated_hours": max_rounds * 6,
            }
        }
    }
    return run


@pytest.mark.slow
def test_market_event_emitted_every_4_rounds(stub_llm, event_collector):
    """12 rounds → 至少 3 个 market_event (round 4, 8, 12)。"""
    bus, captured = event_collector
    orch = PipelineOrchestrator(llm_provider=stub_llm, event_bus=bus)
    cfg = {
        "industry": "digital_service",
        "max_rounds": 12,
        "user_params": {
            "years": 1, "time_step": "month", "external_factors": [],
        },
    }
    run = _make_run(cfg, max_rounds=12)
    asyncio.run(orch._stage_simulation_running(run))
    me = [c for c in captured if c["type"] == "market_event"]
    assert len(me) >= 3, f"expected >=3 market_event, got {len(me)}"
    # 验证 quarter 字段单调递增（4 → Q1, 8 → Q2, 12 → Q3）
    quarters = [c["data"]["quarter"] for c in me[:3]]
    assert quarters == sorted(quarters), f"quarters not monotonic: {quarters}"


@pytest.mark.slow
def test_shock_injected_every_3_rounds_with_external_factors(stub_llm, event_collector):
    """external_factors=[X] → 至少 4 个 shock_injected (round 3,6,9,12)。"""
    bus, captured = event_collector
    orch = PipelineOrchestrator(llm_provider=stub_llm, event_bus=bus)
    cfg = {
        "industry": "fintech",
        "max_rounds": 12,
        "user_params": {
            "years": 1, "time_step": "month",
            "external_factors": ["新竞争者"],
        },
    }
    run = _make_run(cfg, max_rounds=12)
    asyncio.run(orch._stage_simulation_running(run))
    shocks = [c for c in captured if c["type"] == "shock_injected"]
    assert len(shocks) >= 4, f"expected >=4 shock_injected, got {len(shocks)}"
    # 每个 shock 都引用 external_factors
    for s in shocks:
        assert s["data"]["factor"] == "新竞争者", (
            f"unexpected factor: {s['data']}"
        )


@pytest.mark.slow
def test_advance_year_dispatches_12_rounds(stub_llm, event_collector):
    """已 completed run, advance_year 应跑 12 rounds + emit year_advanced。"""
    bus, captured = event_collector
    orch = PipelineOrchestrator(llm_provider=stub_llm, event_bus=bus)
    run = PipelineRun(
        run_id="adv_year_1", status="completed",
        config={"user_params": {"years": 1, "time_step": "month",
                                "external_factors": []}},
    )
    run.artifacts = {
        "SIMULATION_RUNNING": {
            "current_round": 12, "total_rounds": 12,
            "round_results": [{"round_num": i} for i in range(1, 13)],
            "sim_config": {
                "agents": [
                    {"name": "E1", "type": "corporate_exec",
                     "influence_weight": 0.9},
                    {"name": "E2", "type": "analyst", "influence_weight": 0.5},
                ],
                "max_rounds": 12, "simulated_hours": 72,
            },
        }
    }
    orch._runs["adv_year_1"] = run
    result = orch.advance_year("adv_year_1", year_offset=1)
    assert result["status"] == "running"
    assert result["rounds_to_run"] == 12

    # 等待后台完成
    for _ in range(50):
        if run.status in ("completed", "failed"):
            break
        time.sleep(0.4)
    assert run.status == "completed", f"expected completed, got {run.status}"
    final = run.artifacts.get("SIMULATION_RUNNING", {})
    assert final.get("current_round") == 24, (
        f"expected 12+12=24 rounds, got {final.get('current_round')}"
    )

    # emit year_advanced 终态
    ya = [c for c in captured if c["type"] == "year_advanced"]
    assert len(ya) >= 2
    assert ya[-1]["data"]["status"] == "completed"


def test_advance_year_404_on_missing(stub_llm):
    """POST /advance-year on 不存在 run → 404。"""
    from backend.app.api import pipeline as pipeline_api
    pipeline_api._orch = None
    app = create_app()
    app.config["TESTING"] = True
    client = app.test_client()
    resp = client.post(
        "/api/pipeline/nonexistent_run_xyz/advance-year",
        json={"year_offset": 1},
    )
    assert resp.status_code == 404, f"expected 404, got {resp.status_code}: {resp.data!r}"


def test_advance_year_400_on_running(stub_llm, event_collector):
    """POST /advance-year on 仍 running run → 400。"""
    bus, _ = event_collector
    # 注入一个 running 状态的 run
    orch = PipelineOrchestrator(llm_provider=stub_llm, event_bus=bus)
    run = PipelineRun(run_id="still_running", status="running")
    orch._runs["still_running"] = run

    from backend.app.api import pipeline as pipeline_api
    pipeline_api._orch = orch
    app = create_app()
    app.config["TESTING"] = True
    client = app.test_client()
    resp = client.post(
        "/api/pipeline/still_running/advance-year",
        json={"year_offset": 1},
    )
    assert resp.status_code == 400, f"expected 400, got {resp.status_code}: {resp.data!r}"
    body = resp.get_json()
    assert "Cannot advance year" in body.get("error", "")
