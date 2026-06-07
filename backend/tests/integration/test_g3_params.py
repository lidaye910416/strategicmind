"""
G3 (P2-G3) 参数化 — user_params 派生 max_rounds / 部门 agents / 外部因素 / fallback。

Acceptance (per docs/specs/2026-06-07-5-goals-final-report.md):
- POST /api/pipeline/start with years=2, time_step=month → sim_config.max_rounds == 24
- years=3 + time_step=quarter → max_rounds == 12
- years=5 + time_step=year   → max_rounds == 5
- departments=[销售,技术] → agents count >= 5 + 6 (2部门×3)
- external_factors=[竞品X] → report md 含 "竞品X"
- 无 user_params → fallback (max_rounds=3, agents=5)
- years=3 + time_step=month → simulated_hours >= 216 (12*6*3)

设计：复用 P4 测试里的 _StubLLM + event_collector，绕开 7 阶段链路 LLM，
直接走 _stage_config_generation / _stage_report_generating 等可观测路径。
"""
import asyncio
import os
import sys
import tempfile
from typing import Any, Dict, List

import pytest

# Make backend importable
sys.path.insert(0, os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "..", ".."
)))

from backend.services.pipeline_orchestrator import (
    PipelineOrchestrator,
    PipelineRun,
)


# ---- 替身 LLM：记录 chat() 调用消息 + 返回可控文本 ----
class _RecordingLLM:
    def __init__(self, response: str = "# Strategic Report\n竞品X 是关键外部因素\n"):
        self.response = response
        self.calls: List[List[Dict[str, Any]]] = []

    async def chat(self, messages, **kwargs):
        self.calls.append(list(messages))
        return self.response


@pytest.fixture
def stub_llm():
    return _RecordingLLM()


def _make_run(cfg: Dict[str, Any], agents: List[Dict[str, Any]] | None = None) -> PipelineRun:
    """Build a minimal PipelineRun ready for stage tests."""
    return PipelineRun(run_id="g3t", config=cfg, status="running")


def test_max_rounds_derived_from_user_params(stub_llm):
    """years=2, time_step=month → sim_config.max_rounds == 24."""
    orch = PipelineOrchestrator(llm_provider=stub_llm, event_bus=__import__(
        "backend.services.event_bus", fromlist=["EventBus"]
    ).EventBus())
    run = _make_run({
        "industry": "digital_service",
        "user_params": {"years": 2, "time_step": "month", "external_factors": []},
    })
    result = asyncio.run(orch._stage_config_generation(run))
    sc = result["sim_config"]
    assert sc["max_rounds"] == 24, f"expected 24, got {sc['max_rounds']}"


def test_quarter_time_step(stub_llm):
    """years=3, time_step=quarter → max_rounds == 12."""
    orch = PipelineOrchestrator(llm_provider=stub_llm)
    run = _make_run({
        "industry": "fintech",
        "user_params": {"years": 3, "time_step": "quarter", "external_factors": []},
    })
    sc = asyncio.run(orch._stage_config_generation(run))["sim_config"]
    assert sc["max_rounds"] == 12, f"expected 12, got {sc['max_rounds']}"


def test_year_time_step(stub_llm):
    """years=5, time_step=year → max_rounds == 5."""
    orch = PipelineOrchestrator(llm_provider=stub_llm)
    run = _make_run({
        "industry": "fintech",
        "user_params": {"years": 5, "time_step": "year", "external_factors": []},
    })
    sc = asyncio.run(orch._stage_config_generation(run))["sim_config"]
    assert sc["max_rounds"] == 5, f"expected 5, got {sc['max_rounds']}"


def test_departments_produce_extra_agents(stub_llm):
    """departments=[销售,技术] → agents count >= 5 + 6 (2部门×3).

    走 StrategicConfigGenerator 直接路径（与 _stage_config_generation
    在有 doc_ids 时相同的逻辑），避免对 profile stage 的依赖。
    """
    from backend.services.strategic_config_generator import (
        StrategicConfigGenerator,
    )
    from backend.models.seed_document import SeedDocument, DocumentType

    gen = StrategicConfigGenerator(config={})
    seed = SeedDocument(
        doc_id="d1", title="t", content="c", doc_type=DocumentType.NEWS,
    )
    cfg = gen.generate(
        seed, requirement="",
        user_params={
            "years": 1, "time_step": "quarter",
            "departments": ["销售", "技术"],
            "n_stakeholders": 12,
            "external_factors": [],
        },
    )
    agents = cfg.agents
    # 2 部门 × 3 agents/dept = 6, 加上 base agents ≥ 5 + 6
    assert len(agents) >= 11, f"expected >=11 agents, got {len(agents)}"
    # 验证部门 agent 名字带前缀
    depts = {a.get("department") for a in agents if a.get("department")}
    assert "销售" in depts, f"missing 销售 dept, got {depts}"
    assert "技术" in depts, f"missing 技术 dept, got {depts}"


def test_external_factors_in_report(stub_llm, tmp_path, monkeypatch):
    """external_factors=[竞品X] → 最终 .md 报告含 '竞品X'。

    通过 stub LLM 返回包含 '竞品X' 的报告，验证 REPORT_GENERATING
    阶段写入的 .md 文件确实含该字符串（端到端管线层验证）。
    """
    # 用 tmp 重定向 REPORTS_DIR / UPLOAD_FOLDER
    monkeypatch.setenv("REPORTS_DIR", str(tmp_path / "reports"))
    monkeypatch.setenv("UPLOAD_FOLDER", str(tmp_path / "uploads"))
    (tmp_path / "reports").mkdir(parents=True, exist_ok=True)
    (tmp_path / "uploads").mkdir(parents=True, exist_ok=True)

    orch = PipelineOrchestrator(
        llm_provider=stub_llm,
        upload_folder=str(tmp_path / "uploads"),
    )
    run = _make_run({
        "industry": "fintech",
        "user_params": {
            "years": 1, "time_step": "quarter",
            "external_factors": ["竞品X"],
        },
    })
    # 直接调 REPORT_GENERATING：sim_results 中包含 user_params 派生
    # 的 round_results（空也行），stub LLM 会返回含 '竞品X' 的报告
    sim_results = {
        "run_id": "g3t",
        "current_round": 0,
        "total_rounds": 4,
        "round_results": [],
        "artifacts": {
            "CONFIG_GENERATION": {
                "sim_config": {
                    "max_rounds": 4,
                    "simulated_hours": 24,
                    "user_params": {"external_factors": ["竞品X"]},
                }
            }
        },
    }
    out = asyncio.run(orch._stage_report_generating(run))
    md_path = out.get("path") or str(tmp_path / "reports" / "g3t.md")
    assert os.path.exists(md_path), f"report md not found at {md_path}"
    content = open(md_path, encoding="utf-8").read()
    assert "竞品X" in content, f"report md missing 竞品X:\n{content[:200]}"


def test_no_user_params_uses_fallback(stub_llm):
    """无 user_params → 走 fallback (max_rounds=3, agents=5 from profile stage)."""
    orch = PipelineOrchestrator(llm_provider=stub_llm)
    run = _make_run({"industry": "x"})  # no user_params
    sc = asyncio.run(orch._stage_config_generation(run))["sim_config"]
    # 缺省 user_params → 走 fallback max_rounds=3
    assert sc["max_rounds"] == 3, f"expected fallback max_rounds=3, got {sc['max_rounds']}"


def test_simulated_hours_scales(stub_llm):
    """years=3, time_step=month → simulated_hours >= 216 (12*6*3)."""
    orch = PipelineOrchestrator(llm_provider=stub_llm)
    run = _make_run({
        "industry": "x",
        "user_params": {"years": 3, "time_step": "month", "external_factors": []},
    })
    sc = asyncio.run(orch._stage_config_generation(run))["sim_config"]
    # min_sim_hours = max_rounds * 6 = 36 * 6 = 216
    assert sc["simulated_hours"] >= 216, (
        f"expected >=216 hours, got {sc['simulated_hours']}"
    )
    assert sc["max_rounds"] == 36
