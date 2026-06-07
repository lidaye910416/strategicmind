"""
G4 (P3-PERSIST) 历史持久化 — /api/pipeline/runs 列表 + 复制配置 (clone) 集成测试。

Acceptance:
- GET /runs 返回所有 in-memory + 磁盘 checkpoint 合并后的 run 列表
- on-disk checkpoint 也能在重启后通过 /runs 看到
- ?limit=N 限制返回数量
- /runs 返回的 config_summary 含 years / time_step / departments / external_factors_count
- /pipeline/<id> 返回 config.user_params 完整

设计：用 Flask test client + 临时 checkpoint_dir 隔离测试。
直接调 PipelineOrchestrator.start 造 run + 写 disk checkpoint，绕开 LLM。
"""
import json
import os
import sys
import tempfile
from typing import Any, Dict

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "..", ".."
)))

from backend.app import create_app
from backend.services.pipeline_orchestrator import (
    PipelineOrchestrator,
    PipelineRun,
)


# ---- Stub LLM: 不真调网络 ----
class _StubLLM:
    async def chat(self, messages, **kwargs):
        return '{"action_type": "MAKE_STATEMENT", "public_description": "stub", "target_ids": [], "is_hidden": false, "private_intent": "stub"}'


@pytest.fixture
def app_with_tmpdir(monkeypatch, tmp_path):
    """Create Flask app with isolated checkpoint dir + uploads dir."""
    ckpt = tmp_path / "pipelines"
    uploads = tmp_path / "uploads"
    reports = tmp_path / "reports"
    ckpt.mkdir(parents=True, exist_ok=True)
    uploads.mkdir(parents=True, exist_ok=True)
    reports.mkdir(parents=True, exist_ok=True)

    monkeypatch.setenv("PIPELINE_CHECKPOINT_DIR", str(ckpt))
    monkeypatch.setenv("UPLOAD_FOLDER", str(uploads))
    monkeypatch.setenv("REPORTS_DIR", str(reports))

    # Force a fresh singleton orchestrator bound to these envs
    from backend.app.api import pipeline as pipeline_api
    pipeline_api._orch = None

    app = create_app()
    app.config["TESTING"] = True
    yield app, ckpt, uploads, reports
    pipeline_api._orch = None


def _make_synthetic_run(orch: PipelineOrchestrator, run_id: str,
                        user_params: Dict[str, Any] | None = None,
                        max_rounds: int = 12) -> PipelineRun:
    """Insert a run directly into the orchestrator's in-memory state.

    Avoids spinning up the full pipeline (which needs docs + LLM).
    """
    cfg: Dict[str, Any] = {"industry": "fintech"}
    if user_params is not None:
        cfg["user_params"] = user_params
    run = PipelineRun(
        run_id=run_id,
        status="completed",
        progress=1.0,
        config=cfg,
        completed_stages=[],
    )
    run.artifacts = {
        "CONFIG_GENERATION": {
            "sim_config": {
                "agents": [{"name": f"A{i}", "type": "ANALYST",
                            "influence_weight": 0.5} for i in range(3)],
                "max_rounds": max_rounds,
                "simulated_hours": max_rounds * 6,
            }
        },
        "SIMULATION_RUNNING": {
            "current_round": max_rounds,
            "total_rounds": max_rounds,
            "round_results": [{"round_num": i} for i in range(1, max_rounds + 1)],
        },
    }
    orch._runs[run_id] = run
    orch._save_checkpoint(run)
    return run


def test_runs_endpoint_returns_in_memory(app_with_tmpdir):
    """跑 1 个 run, GET /runs 应返回它。"""
    app, ckpt, _, _ = app_with_tmpdir
    from backend.app.api import pipeline as pipeline_api
    orch = pipeline_api.get_orchestrator()
    _make_synthetic_run(orch, "in_mem_1", user_params={
        "years": 2, "time_step": "month",
        "departments": ["销售"], "external_factors": ["X"],
    })
    client = app.test_client()
    resp = client.get("/api/pipeline/runs")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["count"] >= 1
    run_ids = {r["run_id"] for r in body["runs"]}
    assert "in_mem_1" in run_ids


def test_runs_endpoint_scans_disk(app_with_tmpdir):
    """nfs-style 老 checkpoint 写入 data/pipelines/ → GET /runs 应返回它。

    模拟"重启后"：从一个全新的 PipelineOrchestrator 实例读取。
    """
    app, ckpt, _, _ = app_with_tmpdir
    # 1) 用一个 orchestrator 写盘
    from backend.app.api import pipeline as pipeline_api
    orch1 = pipeline_api.get_orchestrator()
    _make_synthetic_run(orch1, "disk_old", user_params={
        "years": 1, "time_step": "year", "departments": [],
        "external_factors": ["OldEvent"],
    })
    # 2) 模拟"重启": 清空内存只保留磁盘文件
    orch1._runs.clear()
    # 3) 用一个全新的 orchestrator 读
    pipeline_api._orch = None
    orch2 = pipeline_api.get_orchestrator()
    assert "disk_old" not in orch2._runs, "should not be in memory after restart"
    # 4) 重新加载 app（用新 orchestrator）
    app2 = create_app()
    app2.config["TESTING"] = True
    client = app2.test_client()
    resp = client.get("/api/pipeline/runs")
    assert resp.status_code == 200
    body = resp.get_json()
    run_ids = {r["run_id"] for r in body["runs"]}
    assert "disk_old" in run_ids, f"disk checkpoint not in /runs: {run_ids}"


def test_runs_endpoint_limit(app_with_tmpdir):
    """?limit=5 → 最多 5 个 run。"""
    app, _, _, _ = app_with_tmpdir
    from backend.app.api import pipeline as pipeline_api
    orch = pipeline_api.get_orchestrator()
    for i in range(8):
        _make_synthetic_run(orch, f"lim_{i}")
    client = app.test_client()
    resp = client.get("/api/pipeline/runs?limit=5")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["count"] == 5, f"expected 5, got {body['count']}"
    assert body["limit"] == 5
    # 验证总 cap: limit=5 不会因为其他 run 漏出
    assert len(body["runs"]) == 5


def test_runs_endpoint_config_summary(app_with_tmpdir):
    """跑 1 user_params run, /runs 返回的 config_summary 含所有 G3 字段。"""
    app, _, _, _ = app_with_tmpdir
    from backend.app.api import pipeline as pipeline_api
    orch = pipeline_api.get_orchestrator()
    _make_synthetic_run(orch, "summary_1", user_params={
        "years": 3, "time_step": "quarter",
        "departments": ["销售", "技术", "财务"],
        "external_factors": ["A", "B", "C", "D"],
    })
    client = app.test_client()
    resp = client.get("/api/pipeline/runs")
    body = resp.get_json()
    target = next(r for r in body["runs"] if r["run_id"] == "summary_1")
    summary = target["config_summary"]
    assert summary["years"] == 3, f"years wrong: {summary}"
    assert summary["time_step"] == "quarter", f"time_step wrong: {summary}"
    assert summary["departments_count"] == 3
    assert summary["external_factors_count"] == 4
    assert "销售" in summary["departments"]


def test_clone_config_returns_user_params(app_with_tmpdir):
    """跑 1 run, GET /pipeline/<id> 返回 config.user_params 完整。

    即"复制配置"功能：前端可基于旧 run 的 user_params 重新启动。
    """
    app, _, _, _ = app_with_tmpdir
    from backend.app.api import pipeline as pipeline_api
    orch = pipeline_api.get_orchestrator()
    user_params = {
        "years": 4, "time_step": "month",
        "departments": ["销售", "技术", "HR"],
        "external_factors": ["监管收紧", "新竞争者"],
        "n_stakeholders": 12,
        "emergence_policy": "aggressive",
    }
    _make_synthetic_run(orch, "clone_src", user_params=user_params)
    client = app.test_client()
    resp = client.get("/api/pipeline/clone_src")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["config"]["user_params"] == user_params, (
        f"clone config.user_params mismatch:\n"
        f"  expected: {user_params}\n"
        f"  got:      {body['config'].get('user_params')}"
    )
