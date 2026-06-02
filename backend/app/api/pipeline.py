"""
Pipeline API - Real pipeline orchestration endpoints.

Wired to services/pipeline_orchestrator.PipelineOrchestrator.
Implements US-050, US-051, US-052, US-053, US-009.
"""
from flask import Blueprint, request, jsonify, Response
from typing import Dict, Any
import json
import os
import threading
import time
import uuid
import asyncio

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
    """SSE endpoint - streams pipeline status updates."""
    orch = get_orchestrator()
    initial = orch.get_run(run_id)
    if initial is None:
        return jsonify({"error": "Run not found"}), 404

    def generate():
        last_payload = ""
        terminal = {"completed", "failed", "cancelled"}
        snap = orch.get_run(run_id) or {}
        last_payload = json.dumps(snap, default=str)
        yield f"data: {last_payload}\n\n"
        if snap.get("status") in terminal:
            return
        while True:
            time.sleep(0.5)
            snap = orch.get_run(run_id)
            if snap is None:
                yield "data: {\"status\": \"unknown\"}\n\n"
                return
            payload = json.dumps(snap, default=str)
            if payload != last_payload:
                yield f"data: {payload}\n\n"
                last_payload = payload
            if snap.get("status") in terminal:
                return

    return Response(generate(), mimetype="text/event-stream")


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
