"""G2 - Dashboard <-> Workbench sync (P1 SYNC)."""
import asyncio
import json
import os
import socket
import sys
import threading
import time
from typing import Iterator, List

import pytest
import requests

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))

os.environ.setdefault("STRATEGICMIND_LLM_OVERRIDE",
                     "backend.tests.mocks.mock_llm_provider.MockLLMProvider")
os.environ.setdefault("PIPELINE_CHECKPOINT_DIR", "/tmp/g2_ckpt")
os.environ.setdefault("UPLOAD_FOLDER", "/tmp/g2_uploads")
os.makedirs("/tmp/g2_ckpt", exist_ok=True)
os.makedirs("/tmp/g2_uploads", exist_ok=True)

from app import create_app  # noqa: E402
from backend.services.event_bus import event_bus as GLOBAL_BUS  # noqa: E402
from backend.services.simulation_loop import SimulationLoop  # noqa: E402
from backend.services.belief_engine import BeliefEngine  # noqa: E402
from backend.services.propagation_layer import PropagationLayer  # noqa: E402


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server_url() -> Iterator[str]:
    flask_app = create_app()
    port = _free_port()
    from werkzeug.serving import make_server
    srv = make_server("127.0.0.1", port, flask_app, threaded=True)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{port}"
    deadline = time.time() + 5.0
    while time.time() < deadline:
        try:
            if requests.get(f"{base}/api/health", timeout=0.5).status_code == 200:
                break
        except Exception:
            time.sleep(0.05)
    yield base
    srv.shutdown()
    thread.join(timeout=2)


def _read_sse_frames(url: str, max_frames: int, deadline_s: float) -> List[dict]:
    """Stream SSE `data:` lines from `url`; return parsed JSON frames."""
    out: List[dict] = []
    end = time.time() + deadline_s
    with requests.get(url, stream=True, timeout=deadline_s + 2) as r:
        r.raise_for_status()
        for raw in r.iter_lines(chunk_size=1, decode_unicode=True):
            if len(out) >= max_frames or time.time() > end or raw is None:
                break
            if not raw.startswith("data:"):
                continue
            payload = raw[5:].strip()
            if not payload:
                continue
            try:
                out.append(json.loads(payload))
            except json.JSONDecodeError:
                continue
    return out


def test_sse_snapshot_stream(server_url):
    """GET /events yields a `type=snapshot` frame on connect."""
    r = requests.post(
        f"{server_url}/api/pipeline/start",
        json={"config": {"industry": "digital_service"}},
        timeout=5,
    )
    assert r.status_code == 200, r.text
    run_id = r.json()["run_id"]
    frames = _read_sse_frames(
        f"{server_url}/api/pipeline/{run_id}/events", max_frames=2, deadline_s=5.0,
    )
    assert frames, "SSE endpoint produced no data frames within 5s"
    assert frames[0].get("type") == "snapshot", f"first frame: {frames[0]!r}"
    assert frames[0].get("run_id") == run_id, frames[0]


def test_sse_live_event_emitted(server_url):
    """SSE stream surfaces live_event frames from the simulation stage."""
    from backend.services.pipeline_orchestrator import PipelineRun
    # NOTE: blueprint is registered from `app.api.pipeline` (not the
    # `backend.app.api.pipeline` alias), so /events resolves
    # get_orchestrator() from that exact module - we must match it.
    from app.api.pipeline import get_orchestrator

    run_id = "g2_live_test"
    orch = get_orchestrator()
    run = PipelineRun(
        run_id=run_id,
        config={"industry": "digital_service", "user_params": {
            "years": 1, "time_step": "month", "external_factors": []}},
    )
    run.artifacts = {"CONFIG_GENERATION": {"sim_config": {
        "agents": [
            {"name": "E1", "type": "corporate_exec", "influence_weight": 0.9},
            {"name": "E2", "type": "analyst", "influence_weight": 0.5},
        ],
        "max_rounds": 2,
        "simulated_hours": 12,  # 12h / 6h-per-round = 2 rounds
    }}}
    orch._runs[run_id] = run
    run.status = "running"  # SSE generator would short-circuit otherwise

    frames_holder: List[dict] = []
    frames_ready = threading.Event()

    def consumer():
        try:
            frames_holder.extend(_read_sse_frames(
                f"{server_url}/api/pipeline/{run_id}/events",
                max_frames=8, deadline_s=15.0,
            ))
        finally:
            frames_ready.set()

    t = threading.Thread(target=consumer, daemon=True)
    t.start()
    time.sleep(0.3)  # let SSE generator open before we emit

    threading.Thread(
        target=lambda: asyncio.run(orch._stage_simulation_running(run)),
        daemon=True,
    ).start()
    frames_ready.wait(timeout=15)
    t.join(timeout=2)

    live = [f for f in frames_holder if f.get("type") == "live_event"]
    assert live, f"no live_event frames; saw: {frames_holder!r}"
    completed = [f for f in live
                 if f.get("event", {}).get("data", {}).get("type") == "round_completed"]
    assert completed, f"no round_completed inside live_event; live: {live!r}"


def test_event_bus_singleton():
    """Orchestrator's event_bus and the module singleton must be the same object."""
    from backend.services.pipeline_orchestrator import PipelineOrchestrator

    orch = PipelineOrchestrator()
    assert orch.event_bus is GLOBAL_BUS, (
        f"orch.event_bus ({id(orch.event_bus)}) != module event_bus ({id(GLOBAL_BUS)})"
    )
    q = GLOBAL_BUS.subscribe("g2_singleton_test")
    try:
        orch.event_bus.emit("g2_singleton_test", "ping", {"hello": "world"})
        frame = q.get(timeout=1.0)
    finally:
        GLOBAL_BUS.unsubscribe("g2_singleton_test", q)
    assert frame["event"]["type"] == "ping", frame
    assert frame["event"]["data"] == {"hello": "world"}, frame


def test_sim_loop_callback_fires():
    """SimulationLoop.run fires the progress_callback once per round."""
    from backend.tests.mocks.mock_llm_provider import MockLLMProvider
    from backend.models.strategic_agent import StrategicAgent, AgentType

    llm = MockLLMProvider()
    loop = SimulationLoop(BeliefEngine(), PropagationLayer(), llm_provider=llm)
    agents = [
        StrategicAgent(name="A1", agent_type=AgentType.CORPORATE_EXEC, influence_weight=0.9),
        StrategicAgent(name="A2", agent_type=AgentType.ANALYST, influence_weight=0.5),
    ]
    received: List[dict] = []
    result = asyncio.run(loop.run(
        agents=agents, max_rounds=2, simulated_hours=12,
        progress_callback=lambda e: received.append(e),
    ))
    assert result["current_round"] == 2, result
    assert len(received) == 2, f"expected 2 invocations, got {len(received)}"
    for i, evt in enumerate(received, start=1):
        assert evt["type"] == "round_completed", evt
        assert evt["round"] == i and evt["total_rounds"] == 2, evt
        assert "actions" in evt and "belief_updates" in evt, evt
