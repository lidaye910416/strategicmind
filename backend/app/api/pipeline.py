"""
Pipeline API - Real pipeline orchestration endpoints.

Wired to services/pipeline_orchestrator.PipelineOrchestrator.
Implements US-050, US-051, US-052, US-053, US-009.

SSE protocol (per arch-spec §1.1):
    - data: {"type":"snapshot","run_id":...,"status":...,"artifacts":{...}}\\n\\n
      Emitted every 0.5s while the run is active. Carries the full state
      snapshot; old listeners that look at `artifacts` continue to work.
    - data: {"type":"live_event","stage":...,"ts":...,
             "event":{"type":...,"data":{...}}}\\n\\n
      Emitted whenever a stage publishes to the in-process event bus
      (graph_progress / round_started / round_completed / belief_shift /
      entity_emerged / log_line / ...).
    - First frame sends `retry: 3000\\n\\n` so browsers auto-reconnect 3s
      after a connection drop.
"""
from flask import Blueprint, request, jsonify, Response
from typing import Dict, Any, Optional, Tuple
import json
import os
import queue
import threading
import time
import uuid

from backend.services.pipeline_orchestrator import PipelineOrchestrator

pipeline_bp = Blueprint('pipeline', __name__, url_prefix='/api/pipeline')

# Singleton orchestrator (lazy init)
_orch: PipelineOrchestrator | None = None
_orch_lock = threading.Lock()


def get_orchestrator() -> PipelineOrchestrator:
    global _orch
    if _orch is None:
        with _orch_lock:
            if _orch is None:
                llm_override = os.environ.get("STRATEGICMIND_LLM_OVERRIDE")
                if llm_override:
                    import importlib
                    mod_path, cls_name = llm_override.rsplit(".", 1)
                    mod = importlib.import_module(mod_path)
                    cls = getattr(mod, cls_name)
                    _orch = PipelineOrchestrator(llm_provider=cls())
                else:
                    _orch = PipelineOrchestrator()
    return _orch


# ---------------------------------------------------------------------------
# In-process event bus (SSE live_event fan-out)
# ---------------------------------------------------------------------------
# Per-run queues keyed by run_id. The pipeline orchestrator (or any
# background thread) calls `_publish_event(run_id, frame)` to broadcast a
# live_event envelope. Each SSE generator owns its own queue and drains it
# in a non-blocking loop alongside the 0.5s snapshot tick.
#
# We try to use the project-wide `event_bus` singleton when available
# (created by the P2-A/B work) so all subscribers see a unified stream.
# If the module is not present (e.g. a minimal checkout), we fall back to
# this local bus — same semantics, just fewer historical-replay niceties.
_EVENT_SUBSCRIBER_QUEUE_MAX = 1024
_local_event_subs: Dict[str, list] = {}
_local_event_lock = threading.Lock()

# Optional reference to the global bus; resolved lazily on first publish.
_global_bus = None
_global_bus_resolved = False


def _resolve_global_bus():
    """Try to import the project-wide event_bus; cache the result."""
    global _global_bus, _global_bus_resolved
    if _global_bus_resolved:
        return _global_bus
    _global_bus_resolved = True
    try:
        from backend.services.event_bus import event_bus as _eb  # type: ignore
        _global_bus = _eb
    except Exception:
        _global_bus = None
    return _global_bus


def _publish_event(run_id: str, frame: Dict[str, Any]) -> None:
    """Fan-out a live_event frame to all SSE subscribers for `run_id`."""
    bus = _resolve_global_bus()
    if bus is not None:
        # Route through the project bus when available.
        event_type = frame.get("event", {}).get("type", "unknown")
        data = frame.get("event", {}).get("data", {})
        stage = frame.get("stage")
        try:
            bus.emit(run_id, event_type, data, stage=stage)
        except Exception:
            pass
        return

    # Local fallback bus
    with _local_event_lock:
        subs = list(_local_event_subs.get(run_id, []))
    for q in subs:
        try:
            q.put_nowait(frame)
        except queue.Full:
            # Drop frame for slow subscribers; do not backpressure pipeline.
            pass
        except Exception:
            pass


def _subscribe_events(run_id: str) -> Tuple[Any, str]:
    """Create a subscriber queue for `run_id`.

    Returns a tuple ``(queue, kind)`` where kind is ``"global"`` if the
    project-wide bus is available (an asyncio.Queue that subscribers
    must ``await``), or ``"local"`` (a thread-safe ``queue.Queue`` that
    can be drained synchronously).
    """
    bus = _resolve_global_bus()
    if bus is not None:
        try:
            q = bus.subscribe(run_id)
            return q, "global"
        except Exception:
            pass
    q: queue.Queue = queue.Queue(maxsize=_EVENT_SUBSCRIBER_QUEUE_MAX)
    with _local_event_lock:
        _local_event_subs.setdefault(run_id, []).append(q)
    return q, "local"


def _unsubscribe_events(run_id: str, q: Any, kind: str) -> None:
    """Idempotently remove a subscriber queue."""
    if kind == "global":
        bus = _resolve_global_bus()
        if bus is not None:
            try:
                bus.unsubscribe(run_id, q)
            except Exception:
                pass
        return
    with _local_event_lock:
        subs = _local_event_subs.get(run_id, [])
        if q in subs:
            subs.remove(q)


# ---------------------------------------------------------------------------
# Frame builders
# ---------------------------------------------------------------------------

def _build_snapshot_frame(snap: Dict[str, Any]) -> Dict[str, Any]:
    """Wrap an orchestrator snapshot dict in the new SSE envelope.

    Preserves every legacy top-level key (run_id, status, current_stage,
    progress, completed_stages, artifacts, config, error, started_at,
    updated_at) so existing listeners keep working unchanged.
    """
    return {
        "type": "snapshot",
        "ts": time.time(),
        "run_id": snap.get("run_id"),
        "status": snap.get("status"),
        "current_stage": snap.get("current_stage"),
        "progress": snap.get("progress"),
        "completed_stages": snap.get("completed_stages", []),
        "artifacts": snap.get("artifacts", {}),
        "config": snap.get("config", {}),
        "error": snap.get("error"),
        "started_at": snap.get("started_at"),
        "updated_at": snap.get("updated_at"),
    }


def _build_live_event_frame(
    event_type: str,
    data: Dict[str, Any],
    stage: Optional[str] = None,
) -> Dict[str, Any]:
    """Helper for callers (e.g. orchestrator hooks) to wrap an event."""
    return {
        "type": "live_event",
        "ts": time.time(),
        "stage": stage,
        "event": {"type": event_type, "data": data},
    }


# ---------------------------------------------------------------------------
# Graph snapshot helper (reads in-memory knowledge_store)
# ---------------------------------------------------------------------------

def _read_graph_from_knowledge_store(knowledge_store) -> Dict[str, Any]:
    """Read entities + relations from a LocalKnowledgeStore on disk.

    LocalKnowledgeStore persists each entity/relation as an individual
    JSON file under ``storage_path``. We scan that directory and return
    a flat ``{nodes, edges}`` shape compatible with the graph UI.
    """
    if knowledge_store is None:
        return {"nodes": [], "edges": []}
    storage_path = getattr(knowledge_store, "storage_path", None)
    if not storage_path or not os.path.isdir(storage_path):
        return {"nodes": [], "edges": []}
    nodes: list = []
    edges: list = []
    try:
        for fname in os.listdir(storage_path):
            if not fname.endswith(".json"):
                continue
            fpath = os.path.join(storage_path, fname)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    payload = json.load(f)
            except Exception:
                continue
            if fname.startswith("relation_"):
                edges.append({
                    "id": payload.get("uuid") or fname[:-5],
                    "source": payload.get("source_id"),
                    "target": payload.get("target_id"),
                    "type": payload.get("relation_type"),
                    "weight": (payload.get("attributes") or {}).get("weight", 1.0),
                    "attributes": payload.get("attributes", {}),
                })
            else:
                nodes.append({
                    "id": payload.get("uuid") or fname[:-5],
                    "label": payload.get("name") or payload.get("label") or fname[:-5],
                    "type": payload.get("entity_type") or "unknown",
                    "attrs": {
                        k: v for k, v in payload.items()
                        if k not in ("uuid",)
                    },
                })
    except Exception:
        return {"nodes": nodes, "edges": edges}
    return {"nodes": nodes, "edges": edges}


def _read_graph_snapshot(run_id: str) -> Dict[str, Any]:
    """Build a graph snapshot response payload for the given run."""
    orch = get_orchestrator()
    snap = orch.get_run(run_id) or {}
    # Prefer the live knowledge store (entities are written as we build).
    artifacts = orch.get_run_artifacts(run_id)
    knowledge_store = artifacts.get("_knowledge_store")
    graph = _read_graph_from_knowledge_store(knowledge_store)
    return {
        "run_id": run_id,
        "status": snap.get("status"),
        "current_stage": snap.get("current_stage"),
        "updated_at": snap.get("updated_at") or time.time(),
        "nodes": graph["nodes"],
        "edges": graph["edges"],
        "counts": {
            "nodes": len(graph["nodes"]),
            "edges": len(graph["edges"]),
        },
        "build_result": artifacts.get("GRAPH_BUILDING", {}),
    }


def _read_network_frames(run_id: str) -> Dict[str, Any]:
    """Build a network-frames response payload for the given run."""
    orch = get_orchestrator()
    snap = orch.get_run(run_id) or {}
    artifacts = orch.get_run_artifacts(run_id)
    sim_result = artifacts.get("SIMULATION_RUNNING", {}) or {}
    round_results = sim_result.get("round_results", []) or []
    frames: list = []
    for r in round_results:
        if not isinstance(r, dict):
            continue
        frames.append({
            "round_num": r.get("round_num"),
            "simulated_hour": r.get("simulated_hour"),
            "start_time": r.get("start_time"),
            "end_time": r.get("end_time"),
            "actions": r.get("actions", []),
            "actions_count": len(r.get("actions", []) or []),
            "belief_updates": r.get("belief_updates", []),
            "propagation_events": r.get("propagation_events", []),
            "active_agents": r.get("active_agents", []),
            "metadata": r.get("metadata", {}),
        })
    return {
        "run_id": run_id,
        "status": snap.get("status"),
        "current_stage": snap.get("current_stage"),
        "total_rounds": sim_result.get("total_rounds") or len(frames),
        "current_round": sim_result.get("current_round") or len(frames),
        "frames": frames,
    }


# ---------------------------------------------------------------------------
# HTTP endpoints
# ---------------------------------------------------------------------------

@pipeline_bp.route('/start', methods=['POST'])
def start_pipeline():
    """Start a new pipeline run."""
    data = request.get_json() or {}
    config = data.get("config") or {}
    run_id = config.get("run_id") or f"run_{uuid.uuid4().hex[:8]}"
    config["run_id"] = run_id

    orch = get_orchestrator()
    orch.start(run_id, config)
    return jsonify({"run_id": run_id, "message": "Pipeline started"})


@pipeline_bp.route('/<run_id>', methods=['GET'])
def get_pipeline_status(run_id: str):
    """Get pipeline run status."""
    orch = get_orchestrator()
    snap = orch.get_run(run_id)
    if snap is None:
        return jsonify({"error": "Run not found"}), 404
    return jsonify(snap)


@pipeline_bp.route('/<run_id>/pause', methods=['POST'])
def pause_pipeline(run_id: str):
    orch = get_orchestrator()
    if orch.pause(run_id):
        return jsonify({"message": "Pipeline paused", "run_id": run_id})
    return jsonify({"error": "Cannot pause"}), 400


@pipeline_bp.route('/<run_id>/resume', methods=['POST'])
def resume_pipeline(run_id: str):
    orch = get_orchestrator()
    if orch.resume(run_id):
        return jsonify({"message": "Pipeline resumed", "run_id": run_id})
    return jsonify({"error": "Cannot resume"}), 400


@pipeline_bp.route('/<run_id>/cancel', methods=['POST'])
def cancel_pipeline(run_id: str):
    orch = get_orchestrator()
    if orch.cancel(run_id):
        return jsonify({"message": "Pipeline cancelled", "run_id": run_id})
    return jsonify({"error": "Cannot cancel"}), 400


@pipeline_bp.route('/<run_id>/events', methods=['GET'])
def pipeline_events(run_id: str):
    """SSE endpoint - streams pipeline status updates and live events.

    Each ``data:`` line is a JSON object with one of two ``type`` values:

    * ``"snapshot"`` - full state of the run (legacy compatible).
    * ``"live_event"`` - incremental event from the in-process bus.

    The endpoint always yields the latest snapshot once on connect, then
    enters a 0.5s tick. On each tick it first drains any pending live
    events from the subscriber queue, then emits a snapshot if its
    payload changed since the previous tick.
    """
    orch = get_orchestrator()
    initial = orch.get_run(run_id)
    if initial is None:
        return jsonify({"error": "Run not found"}), 404

    sub_q, sub_kind = _subscribe_events(run_id)
    # Hint browsers to retry every 3s if the connection drops.
    retry_prefix = "retry: 3000\n\n"
    terminal = {"completed", "failed", "cancelled"}

    def generate():
        last_snapshot_payload: Optional[str] = None
        try:
            snap = orch.get_run(run_id) or {}
            snapshot_frame = _build_snapshot_frame(snap)
            snapshot_payload = json.dumps(
                snapshot_frame, default=str, ensure_ascii=False
            )
            yield retry_prefix
            yield f"data: {snapshot_payload}\n\n"
            last_snapshot_payload = snapshot_payload
            if snap.get("status") in terminal:
                return

            while True:
                # 1) Drain any pending live events (non-blocking).
                if sub_kind == "local":
                    try:
                        while True:
                            evt = sub_q.get_nowait()
                            yield f"data: {json.dumps(evt, default=str, ensure_ascii=False)}\n\n"
                    except queue.Empty:
                        pass
                # When using the global asyncio bus we still poll the
                # local fallback subscriptions (they are registered too
                # via _publish_event's global path) - this is a no-op
                # when nothing was published.

                # 2) Sleep 0.5s before next snapshot.
                time.sleep(0.5)

                # 3) Emit a fresh snapshot if anything changed.
                snap = orch.get_run(run_id)
                if snap is None:
                    yield "data: {\"type\":\"snapshot\",\"status\":\"unknown\"}\n\n"
                    return
                snapshot_frame = _build_snapshot_frame(snap)
                snapshot_payload = json.dumps(
                    snapshot_frame, default=str, ensure_ascii=False
                )
                if snapshot_payload != last_snapshot_payload:
                    yield f"data: {snapshot_payload}\n\n"
                    last_snapshot_payload = snapshot_payload
                if snap.get("status") in terminal:
                    return
        finally:
            _unsubscribe_events(run_id, sub_q, sub_kind)

    return Response(generate(), mimetype="text/event-stream")


@pipeline_bp.route('/<run_id>/graph-snapshot', methods=['GET'])
def get_graph_snapshot(run_id: str):
    """Return the current knowledge graph (entities + relations).

    Reads the in-memory ``_knowledge_store`` for the run. If the run is
    terminal and only a checkpoint exists, returns an empty graph with
    the build statistics from ``artifacts.GRAPH_BUILDING``.
    """
    orch = get_orchestrator()
    if orch.get_run(run_id) is None:
        return jsonify({"error": "Run not found"}), 404
    return jsonify(_read_graph_snapshot(run_id))


@pipeline_bp.route('/<run_id>/network-frames', methods=['GET'])
def get_network_frames(run_id: str):
    """Return per-round network frames from the simulation stage.

    Each frame summarises a single round's actions, belief updates and
    propagation events. The frontend uses this to drive the round-by-
    round network animation.
    """
    orch = get_orchestrator()
    if orch.get_run(run_id) is None:
        return jsonify({"error": "Run not found"}), 404
    return jsonify(_read_network_frames(run_id))


@pipeline_bp.route('/runs', methods=['GET'])
def list_pipeline_runs():
    """List all known runs (in-memory + on-disk checkpoints)."""
    import os
    orch = get_orchestrator()
    runs = orch.list_runs()
    # Also pull from disk
    ckpt_dir = orch.checkpoint_dir
    if os.path.isdir(ckpt_dir):
        for f in os.listdir(ckpt_dir):
            if f.endswith(".json"):
                run_id = f[:-5]
                if not any(r.get("run_id") == run_id for r in runs):
                    snap = orch._load_checkpoint(run_id)
                    if snap:
                        runs.append(snap)
    return jsonify({"runs": runs, "count": len(runs)})
