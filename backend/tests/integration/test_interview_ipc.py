"""
G9 — Interview IPC smoke test.

Validates the 4 routes of backend.app.api.interview:

* POST /api/interview/<run_id>/agents/<agent_id>/message
* GET  /api/interview/<run_id>/trace?agent_id=...
* GET  /api/interview/<run_id>/trace?kind=round
* GET  /api/interview/<run_id>/events (SSE — just check headers + first frame)

Also covers the precedence + 400 error rule on /trace.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest

# Ensure the project root is importable.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))

from backend.app import create_app  # noqa: E402
from backend.app.api import interview as interview_module  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


class _StubLLM:
    """Cheap stand-in LLM — returns a deterministic Chinese sentence."""

    name = "stub-llm"

    async def chat(self, messages, **kwargs):  # noqa: D401
        return "这是来自测试 stub 的回复，回答了你的问题。"

    async def stream_chat(self, messages, **kwargs):  # pragma: no cover - unused here
        yield "这是来自测试 stub 的回复，回答了你的问题。"


@pytest.fixture
def stub_llm(monkeypatch):
    """Force the LLM factory to return our stub."""
    from backend.services import llm_factory

    monkeypatch.setattr(llm_factory, "create_llm_provider", lambda: _StubLLM())
    return _StubLLM()


@pytest.fixture
def app(monkeypatch, stub_llm):
    """Flask app with a stub LLM provider and a per-test interviews dir."""
    # Point the interviews dir at a tmp location so we don't pollute data/.
    import tempfile

    tmp = Path(tempfile.mkdtemp(prefix="g9-interviews-"))
    monkeypatch.setattr(interview_module, "_INTERVIEWS_DIR", tmp, raising=False)
    # Also force the lazy directory resolver to return the same tmp path.
    monkeypatch.setattr(interview_module, "_interviews_dir", lambda: tmp)

    flask_app = create_app({"TESTING": True})
    flask_app.config["_G9_INTERVIEWS_DIR"] = tmp
    return flask_app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def orchestrator_double(monkeypatch):
    """Pretend the orchestrator knows about ``run_test_123``."""

    class _StubOrch:
        def get_run(self, run_id: str):
            if run_id == "run_test_123":
                return {
                    "run_id": run_id,
                    "status": "running",
                    "artifacts": {
                        "SIMULATION_RUNNING": {
                            "company_state": {"name": "测试公司"},
                        }
                    },
                }
            return None

    # Patch the symbol in the pipeline module (where the lazy import
    # resolves from) and in the interview module (where we resolve it
    # from in this blueprint).
    from backend.app.api import pipeline as pipeline_module
    from backend.app.api import interview as interview_module_local

    monkeypatch.setattr(pipeline_module, "get_orchestrator", lambda: _StubOrch())
    monkeypatch.setattr(
        interview_module_local, "_get_orchestrator", lambda: _StubOrch()
    )
    return _StubOrch()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_post_message_persists_transcript(client, orchestrator_double):
    response = client.post(
        "/api/interview/run_test_123/agents/dept_product/message",
        json={"question": "今年战略重点是什么？", "round_ref": 3},
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body["role"] == "agent"
    assert body["agent_id"] == "dept_product"
    assert isinstance(body.get("content"), str) and body["content"], body
    meta = body.get("metadata") or {}
    assert meta.get("question") == "今年战略重点是什么？"
    assert meta.get("round_ref") == 3
    assert "model" in meta
    assert "latency_ms" in meta

    # Per-agent JSONL now has 2 lines: the user turn + the agent reply.
    agent_path = interview_module._interviews_dir() / "run_test_123_dept_product.jsonl"
    assert agent_path.exists()
    lines = [ln for ln in agent_path.read_text(encoding="utf-8").splitlines() if ln.strip()]
    assert len(lines) == 2
    parsed = [json.loads(ln) for ln in lines]
    assert parsed[0]["role"] == "user"
    assert parsed[1]["role"] == "agent"


def test_post_message_unknown_run_returns_404(client, orchestrator_double):
    response = client.post(
        "/api/interview/run_missing/agents/dept_x/message",
        json={"question": "hi"},
    )
    assert response.status_code == 404


def test_post_message_missing_question_returns_400(client, orchestrator_double):
    response = client.post(
        "/api/interview/run_test_123/agents/dept_x/message",
        json={},
    )
    assert response.status_code == 400


def test_trace_agent_id_returns_transcript(client, orchestrator_double):
    # Seed an exchange first.
    client.post(
        "/api/interview/run_test_123/agents/dept_sales/message",
        json={"question": "Q1", "round_ref": 1},
    )
    response = client.get("/api/interview/run_test_123/trace?agent_id=dept_sales&limit=10")
    assert response.status_code == 200
    body = response.get_json()
    assert isinstance(body, list) and len(body) >= 2
    assert body[0]["role"] == "user"
    assert body[-1]["role"] == "agent"


def test_trace_kind_round_takes_precedence(client, orchestrator_double, tmp_path):
    # Seed a per-round trace file directly (the engine.py writer does this
    # in real runs; we mimic it here).
    round_path = interview_module._interviews_dir() / "run_test_123.jsonl"
    with round_path.open("w", encoding="utf-8") as fh:
        for r in (1, 2):
            fh.write(
                json.dumps(
                    {"round": r, "ts": 0.0, "actions": [], "beliefs": {}, "world_state_slice": {}}
                )
                + "\n"
            )
    # ?kind=round wins even if ?agent_id= is also set.
    response = client.get(
        "/api/interview/run_test_123/trace?agent_id=dept_x&kind=round&limit=10"
    )
    assert response.status_code == 200
    body = response.get_json()
    assert isinstance(body, list)
    assert [r["round"] for r in body] == [1, 2]


def test_trace_missing_both_returns_400(client, orchestrator_double):
    response = client.get("/api/interview/run_test_123/trace")
    assert response.status_code == 400
    body = response.get_json()
    assert body.get("error") == "agent_id or kind required"


def test_events_sse_first_frame_has_retry(client, orchestrator_double):
    response = client.get("/api/interview/run_test_123/events")
    assert response.status_code == 200
    assert response.mimetype == "text/event-stream"
    assert response.headers["Content-Type"].startswith("text/event-stream")

    # Drive the generator manually so we can assert the retry preamble
    # without depending on the test client's iterator semantics.
    from backend.app.api.interview import interview_events, _interview_subscribe

    sub = _interview_subscribe("run_test_123")
    with client.application.test_request_context("/api/interview/run_test_123/events"):
        resp = interview_events("run_test_123")
    # resp is a Flask Response; pull the underlying generator.
    chunks: List[str] = []
    # Use a thread-driven read of a couple of bytes via the WSGI app.
    try:
        for chunk in resp.response:  # type: ignore[attr-defined]
            if isinstance(chunk, bytes):
                chunk = chunk.decode("utf-8", errors="ignore")
            chunks.append(chunk)
            if len(chunks) >= 2:
                break
    except Exception:
        pass
    assert any("retry: 3000" in c for c in chunks), f"expected retry preamble, got: {chunks!r}"
