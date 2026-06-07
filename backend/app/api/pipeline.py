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


@pipeline_bp.route('/<run_id>/advance-year', methods=['POST'])
def advance_year(run_id: str):
    """
    P4 LOOP (G5): 在已 completed/failed 的 run 上再推 1 年。

    Body: ``{"year_offset": 1}``（默认 1）
    行为：
      - 校验 run 当前状态（仅 completed/failed 可推进）
      - 复用历史 checkpoint 的 agents + 知识图谱
      - 跑 12 轮（time_step=month）或 4 轮（time_step=quarter）或 1 轮（year）
      - 每 4 轮触发一次市场季度演化，emit ``market_event``
      - 每 3 轮 + external_factors 非空 → 注入外部冲击，emit ``shock_injected``
      - 完成后 emit ``year_advanced`` 终态事件
    """
    data = request.get_json(silent=True) or {}
    year_offset = int(data.get("year_offset", 1))
    orch = get_orchestrator()
    result = orch.advance_year(run_id, year_offset=year_offset)
    if "error" in result and "Cannot advance year" in result["error"]:
        return jsonify(result), 400
    if result.get("error") == "Run not found":
        return jsonify(result), 404
    return jsonify(result), 202


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

            # 关键修复：SSE 新订阅时, 立即把历史事件 (subscribe 之前已 emit 但未被该订阅者接收的) 重放一遍。
            # 否则 GRAPH_BUILDING/SIMULATION 等阶段的事件会被错过，前端看到空图谱。
            try:
                bus = _resolve_global_bus()
                if bus is not None and hasattr(bus, "get_history"):
                    for hist_frame in (bus.get_history(run_id) or []):
                        yield f"data: {json.dumps(hist_frame, default=str, ensure_ascii=False)}\n\n"
            except Exception:
                pass

            while True:
                # 1) Drain any pending live events (non-blocking).
                # Works for both "local" (legacy in-process subs) and
                # "global" (the project-wide EventBus singleton in
                # backend.services.event_bus). Both expose a thread-safe
                # ``queue.Queue`` that supports ``get_nowait()``.
                try:
                    while True:
                        evt = sub_q.get_nowait()
                        yield f"data: {json.dumps(evt, default=str, ensure_ascii=False)}\n\n"
                except queue.Empty:
                    pass
                except Exception:
                    # Defensive: never let a bad subscriber break SSE.
                    pass

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


def _extract_config_summary(config: Dict[str, Any]) -> Dict[str, Any]:
    """Build a flat config_summary dict for the runs list view.

    Reads both the new ``user_params`` envelope (G3) and the legacy top-
    level keys (``simulation_hours``, ``report_style``) so the summary
    works for runs created before the params refactor.
    """
    summary: Dict[str, Any] = {
        "years": None,
        "time_step": None,
        "departments": [],
        "departments_count": 0,
        "external_factors_count": 0,
        "report_style": None,
        "simulation_hours": None,
    }
    if not isinstance(config, dict):
        return summary
    user_params = config.get("user_params") or {}
    if not isinstance(user_params, dict):
        user_params = {}
    summary["years"] = (
        user_params.get("years")
        or config.get("years")
    )
    summary["time_step"] = (
        user_params.get("time_step")
        or config.get("time_step")
    )
    depts = user_params.get("departments")
    if isinstance(depts, list):
        summary["departments"] = [str(d) for d in depts if d]
    elif isinstance(config.get("departments"), list):
        summary["departments"] = [str(d) for d in config["departments"] if d]
    summary["departments_count"] = len(summary["departments"])
    ef = user_params.get("external_factors")
    if isinstance(ef, list):
        summary["external_factors_count"] = len(ef)
    elif isinstance(ef, str):
        summary["external_factors_count"] = len(
            [s for s in ef.replace("\n", ",").split(",") if s.strip()]
        )
    summary["report_style"] = (
        config.get("report_style")
        or user_params.get("report_style")
    )
    sh = config.get("simulation_hours")
    if sh is None:
        sh = user_params.get("simulation_hours")
    summary["simulation_hours"] = sh
    return summary


def _project_run_for_list(run: Dict[str, Any]) -> Dict[str, Any]:
    """Project a full run snapshot down to the fields used by the list view.

    Strips the (potentially huge) ``artifacts`` blob but keeps enough
    metadata for the RecentRuns card UI: status, timestamps, current
    stage/progress, and a flat ``config_summary`` extracted from the
    run's ``config`` dict.
    """
    if not isinstance(run, dict):
        return {}
    return {
        "run_id": run.get("run_id"),
        "status": run.get("status"),
        "current_stage": run.get("current_stage"),
        "progress": run.get("progress"),
        "started_at": run.get("started_at"),
        "updated_at": run.get("updated_at"),
        "completed_stages": run.get("completed_stages", []),
        "error": run.get("error"),
        "config_summary": _extract_config_summary(run.get("config") or {}),
    }


@pipeline_bp.route('/runs', methods=['GET'])
def list_pipeline_runs():
    """List all known runs (in-memory + on-disk checkpoints).

    Returns a flat, UI-ready projection of each run with a
    ``config_summary`` block (years / time_step / departments /
    external_factors_count / report_style) so the RecentRuns card view
    can render without re-fetching every run's full config.

    Honors ``?limit=`` (default 20, max 50) for the on-disk scan; the
    in-memory list is the active set and is always included. Results
    are sorted by ``updated_at`` desc (newest first).
    """
    import os
    try:
        limit = int(request.args.get("limit", "20"))
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(limit, 50))

    orch = get_orchestrator()
    runs_by_id: Dict[str, Dict[str, Any]] = {}
    # 1) In-memory runs (live, may still be running)
    for r in orch.list_runs():
        rid = r.get("run_id")
        if rid:
            runs_by_id[rid] = r
    # 2) On-disk checkpoints (survive restarts)
    ckpt_dir = orch.checkpoint_dir
    if os.path.isdir(ckpt_dir):
        for f in os.listdir(ckpt_dir):
            if not f.endswith(".json"):
                continue
            run_id = f[:-5]
            if run_id in runs_by_id:
                continue
            snap = orch._load_checkpoint(run_id)
            if snap:
                runs_by_id[run_id] = snap

    # Project to UI shape and sort by updated_at desc
    projected = [
        _project_run_for_list(r) for r in runs_by_id.values()
        if r.get("run_id")
    ]
    projected.sort(
        key=lambda x: x.get("updated_at") or 0.0,
        reverse=True,
    )
    projected = projected[:limit]
    return jsonify({"runs": projected, "count": len(projected), "limit": limit})
