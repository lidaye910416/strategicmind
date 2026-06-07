"""
P4 LOOP (G5) — MiroFish 多年循环 + 内外部环境变化 集成测试。

验收 (G5 L3 多年逐月):
- POST /api/pipeline/start with years=3, time_step=month → 推演 36 rounds
- 36 轮中产生 9 条 market_event (每 4 轮 1 次 = 36/4 = 9)
- 外部因素在 R3/R6/R9... 注入 → shock_injected
- POST /advance-year on 已完成 run → 跑 12 rounds → 状态 completed
- emit "year_advanced" 事件

设计：本测试使用纯单元可观测路径——直接调 _stage_simulation_running 拿
result + 监听 event_bus 收集 emit 序列，绕开 7 阶段，避免依赖 LLM。
"""
import asyncio
import os
import sys
from typing import Any, Dict, List

import pytest

# Make backend importable
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))

from backend.services.pipeline_orchestrator import PipelineOrchestrator, PipelineRun
from backend.services.event_bus import EventBus


# ---- 替身 LLM，避免真实网络调用 ----
class _StubLLM:
    async def chat(self, messages, **kwargs):
        return '{"action_type": "MAKE_STATEMENT", "public_description": "stub", "target_ids": [], "is_hidden": false, "private_intent": "stub"}'


@pytest.fixture
def stub_llm():
    return _StubLLM()


@pytest.fixture
def event_collector():
    """Inject an EventBus and collect all emit() frames for assertion."""
    bus = EventBus()
    captured: List[Dict[str, Any]] = []
    orig_emit = bus.emit

    def spy_emit(run_id: str, event_type: str, data: Dict[str, Any], stage=None):
        captured.append({"run_id": run_id, "type": event_type, "data": dict(data), "stage": stage})
        return orig_emit(run_id, event_type, data, stage=stage)

    bus.emit = spy_emit  # type: ignore[assignment]
    return bus, captured


def _make_run(cfg: Dict[str, Any]) -> PipelineRun:
    """Build a PipelineRun with a CONFIG_GENERATION artifact so the sim
    stage can find agents + max_rounds."""
    run = PipelineRun(run_id="t1", config=cfg, status="running")
    max_rounds = cfg.get("max_rounds", 36)
    run.artifacts = {
        "CONFIG_GENERATION": {
            "sim_config": {
                "agents": [
                    {"name": "Exec", "type": "corporate_exec", "influence_weight": 0.9},
                    {"name": "Investor", "type": "institutional_investor", "influence_weight": 0.6},
                    {"name": "Regulator", "type": "regulator", "influence_weight": 0.5},
                ],
                "max_rounds": max_rounds,
                "simulated_hours": max_rounds * 6,  # ensure total_rounds = max_rounds
            }
        }
    }
    return run


def test_three_years_monthly_emits_9_market_events(stub_llm, event_collector):
    """
    G5 L3 多年逐月：36 轮中应 emit 9 次 market_event（每 4 轮 1 次）。
    """
    bus, captured = event_collector
    orch = PipelineOrchestrator(llm_provider=stub_llm, event_bus=bus)

    # Years=3, time_step=month → 3*12=36 rounds
    cfg = {
        "industry": "digital_service",
        "max_rounds": 36,
        "user_params": {
            "years": 3,
            "time_step": "month",
            "external_factors": [
                "新竞争者进入",
                "监管收紧",
            ],
        },
    }
    run = _make_run(cfg)

    result = asyncio.run(orch._stage_simulation_running(run))

    market_events = [c for c in captured if c["type"] == "market_event"]
    shock_events = [c for c in captured if c["type"] == "shock_injected"]
    round_events = [c for c in captured if c["type"] == "round_progress"]

    # 36/4 = 9 market events (round_num 4, 8, 12, 16, 20, 24, 28, 32, 36)
    assert len(market_events) == 9, f"expected 9 market events, got {len(market_events)}"
    # 36/3 = 12 shock events (round_num 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36)
    assert len(shock_events) == 12, f"expected 12 shock events, got {len(shock_events)}"
    # 36 round events
    assert len(round_events) == 36, f"expected 36 round_progress, got {len(round_events)}"

    # 验证 market_event payload 包含核心字段
    first = market_events[0]
    assert "quarter" in first["data"]
    assert "sector_growth_rate" in first["data"]
    assert "cycle_label_cn" in first["data"]
    assert "msg_cn" in first["data"]
    assert first["data"]["msg_cn"].startswith("市场事件 Q")

    # 验证 shock_event payload
    s = shock_events[0]
    assert s["data"]["shock"]["shock_type"]
    assert s["data"]["msg_cn"].startswith("外部冲击 R")


def test_market_event_includes_industry_label(stub_llm, event_collector):
    """market_event 的 data 应包含 industry 字段（来自 run.config.industry）。"""
    bus, captured = event_collector
    orch = PipelineOrchestrator(llm_provider=stub_llm, event_bus=bus)
    cfg = {
        "industry": "fintech",
        "max_rounds": 8,
        "user_params": {"years": 1, "time_step": "month", "external_factors": []},
    }
    run = _make_run(cfg)
    asyncio.run(orch._stage_simulation_running(run))
    me = [c for c in captured if c["type"] == "market_event"]
    assert me, "expected at least one market_event"
    assert me[0]["data"]["industry"] == "fintech"


def test_no_market_or_shock_when_rounds_lt_4_or_3(stub_llm, event_collector):
    """当 max_rounds < 4（无季度边界）/ < 3（无 shock 边界）时，不 emit 任何。"""
    bus, captured = event_collector
    orch = PipelineOrchestrator(llm_provider=stub_llm, event_bus=bus)
    cfg = {
        "industry": "x",
        "max_rounds": 2,
        "user_params": {"external_factors": ["x"]},
    }
    run = _make_run(cfg)
    asyncio.run(orch._stage_simulation_running(run))
    assert not [c for c in captured if c["type"] == "market_event"]
    assert not [c for c in captured if c["type"] == "shock_injected"]


def test_advance_year_dispatches_rounds(stub_llm, event_collector):
    """
    POST /advance-year (内部 advance_year) 应在已 completed run 上跑 12 轮，
    并 emit year_advanced 终态事件。
    """
    bus, captured = event_collector
    orch = PipelineOrchestrator(llm_provider=stub_llm, event_bus=bus)

    # 直接构造一个 completed run with prior sim_artifact
    run = PipelineRun(
        run_id="advt1",
        status="completed",
        config={
            "user_params": {"years": 1, "time_step": "month", "external_factors": []},
        },
    )
    run.artifacts = {
        "SIMULATION_RUNNING": {
            "current_round": 12,
            "total_rounds": 12,
            "round_results": [{"round_num": i} for i in range(1, 13)],
            "sim_config": {
                "agents": [
                    {"name": "E1", "type": "corporate_exec", "influence_weight": 0.9},
                    {"name": "E2", "type": "analyst", "influence_weight": 0.5},
                ],
                "max_rounds": 12,
                "simulated_hours": 72,
            },
        }
    }
    orch._runs["advt1"] = run

    # 走 advance_year 的同步入口（task 走后台线程）
    result = orch.advance_year("advt1", year_offset=1)
    assert result["status"] == "running"
    assert result["rounds_to_run"] == 12

    # 等待后台完成
    import time
    for _ in range(50):
        if run.status in ("completed", "failed"):
            break
        time.sleep(0.4)

    assert run.status == "completed", f"expected completed, got {run.status} {run.error}"
    final_artifact = run.artifacts.get("SIMULATION_RUNNING", {})
    # 起始 12 + 再推 12 = 24
    assert final_artifact.get("current_round") == 24
    assert final_artifact.get("total_rounds") == 24
    assert final_artifact.get("advanced_year") is True

    # 应至少 emit 2 次 year_advanced（启动 + 完成）
    ya = [c for c in captured if c["type"] == "year_advanced"]
    assert len(ya) >= 2, f"expected >=2 year_advanced, got {len(ya)}"
    # 最后一条 status 应是 completed
    assert ya[-1]["data"]["status"] == "completed"


def test_advance_year_rejects_running_run(stub_llm):
    """状态为 running 的 run 不允许 advance_year。"""
    orch = PipelineOrchestrator(llm_provider=stub_llm)
    run = PipelineRun(run_id="r", status="running")
    orch._runs["r"] = run
    res = orch.advance_year("r", year_offset=1)
    assert "error" in res
    assert "Cannot advance year" in res["error"]
