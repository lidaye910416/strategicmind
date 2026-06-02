"""
Pipeline API - Pipeline orchestration endpoints

Implements US-050, US-051, US-052, US-053
"""

from flask import Blueprint, request, jsonify
from typing import Dict, Any
import uuid
import asyncio

pipeline_bp = Blueprint('pipeline', __name__, url_prefix='/api/pipeline')

# In-memory storage for demo
_pipeline_runs: Dict[str, Dict[str, Any]] = {}


@pipeline_bp.route('/start', methods=['POST'])
def start_pipeline():
    """Start a new pipeline run"""
    data = request.get_json() or {}
    
    run_id = f"run_{uuid.uuid4().hex[:8]}"
    
    # Create pipeline run
    _pipeline_runs[run_id] = {
        "run_id": run_id,
        "current_stage": "SEED_PARSING",
        "status": "running",
        "progress": 0.0,
        "config": data.get("config", {}),
        "created_at": str(uuid.uuid4()),
    }
    
    # Start async pipeline (simplified)
    # In production, this would start a background task
    asyncio.create_task(_run_pipeline_async(run_id))
    
    return jsonify({
        "run_id": run_id,
        "message": "Pipeline started"
    })


async def _run_pipeline_async(run_id: str):
    """Run pipeline stages asynchronously"""
    import time
    stages = [
        "SEED_PARSING", "GRAPH_BUILDING", "ENTITY_EXTRACTION",
        "PROFILE_GENERATION", "CONFIG_GENERATION", "SIMULATION_RUNNING",
        "REPORT_GENERATING", "COMPLETED"
    ]
    
    for i, stage in enumerate(stages):
        _pipeline_runs[run_id]["current_stage"] = stage
        _pipeline_runs[run_id]["progress"] = (i + 1) / len(stages)
        
        if stage == "COMPLETED":
            _pipeline_runs[run_id]["status"] = "completed"
        elif _pipeline_runs[run_id]["status"] == "cancelled":
            break
        
        await asyncio.sleep(1)  # Simulate work


@pipeline_bp.route('/<run_id>', methods=['GET'])
def get_pipeline_status(run_id: str):
    """Get pipeline run status"""
    if run_id not in _pipeline_runs:
        return jsonify({"error": "Run not found"}), 404
    
    return jsonify(_pipeline_runs[run_id])


@pipeline_bp.route('/<run_id>/pause', methods=['POST'])
def pause_pipeline(run_id: str):
    """Pause a running pipeline"""
    if run_id not in _pipeline_runs:
        return jsonify({"error": "Run not found"}), 404
    
    if _pipeline_runs[run_id]["status"] == "running":
        _pipeline_runs[run_id]["status"] = "paused"
        return jsonify({"message": "Pipeline paused"})
    
    return jsonify({"error": "Cannot pause"}), 400


@pipeline_bp.route('/<run_id>/resume', methods=['POST'])
def resume_pipeline(run_id: str):
    """Resume a paused pipeline"""
    if run_id not in _pipeline_runs:
        return jsonify({"error": "Run not found"}), 404
    
    if _pipeline_runs[run_id]["status"] == "paused":
        _pipeline_runs[run_id]["status"] = "running"
        return jsonify({"message": "Pipeline resumed"})
    
    return jsonify({"error": "Cannot resume"}), 400


@pipeline_bp.route('/<run_id>/cancel', methods=['POST'])
def cancel_pipeline(run_id: str):
    """Cancel a pipeline run"""
    if run_id not in _pipeline_runs:
        return jsonify({"error": "Run not found"}), 404
    
    _pipeline_runs[run_id]["status"] = "cancelled"
    return jsonify({"message": "Pipeline cancelled"})


@pipeline_bp.route('/<run_id>/events', methods=['GET'])
def pipeline_events(run_id: str):
    """SSE endpoint for pipeline events"""
    from flask import Response
    import json
    
    def generate():
        while run_id in _pipeline_runs:
            run = _pipeline_runs[run_id]
            event = json.dumps({
                "stage": run["current_stage"],
                "status": run["status"],
                "progress": run["progress"],
            })
            yield f"data: {event}\n\n"
            
            if run["status"] in ["completed", "failed", "cancelled"]:
                break
    
    return Response(generate(), mimetype='text/event-stream')


# Import for US-078 verification
from ...services.strategic_simulation_runner import StrategicSimulationRunner
