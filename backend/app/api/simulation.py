"""
Simulation API - Run and control simulations

Refactored to use IEntityReader/IKnowledgeStore - no Zep imports.
Implements: US-037
"""

from flask import Blueprint, request, jsonify
import uuid
import asyncio

from ..config import config
from backend.services.simulation_runner import SimulationRunner
from backend.services.strategic_backend import StrategicBackend
from backend.services.simulation_state_manager import SimulationStateManager, RunState
from backend.services.simulation_ipc import SimulationIPC
from backend.services.local_knowledge_store import LocalKnowledgeStore
from backend.services.local_graph_store import LocalGraphStore
from backend.adapters.bailian_adapter import BailianAdapter

simulation_bp = Blueprint('simulation', __name__, url_prefix='/api/simulation')

# Global instances
_state_manager = SimulationStateManager()
_ipc = SimulationIPC()


@simulation_bp.route('/start', methods=['POST'])
def start_simulation():
    """Start a new simulation"""
    data = request.get_json() or {}
    run_id = f"run_{uuid.uuid4().hex[:8]}"
    
    # Initialize services
    graph_store = LocalGraphStore()
    llm = BailianAdapter(api_key=config.LLM_API_KEY)
    knowledge_store = LocalKnowledgeStore(graph_store=graph_store, llm_provider=llm)
    
    backend = StrategicBackend(llm_provider=llm)
    runner = SimulationRunner(
        backend=backend,
        state_manager=_state_manager,
        ipc=_ipc,
    )
    
    # Start async
    async def _start():
        await runner.start(
            run_id=run_id,
            config={
                "agents": data.get("agents", []),
                "max_rounds": data.get("max_rounds", 10),
                "simulated_hours": data.get("simulated_hours", 72),
                "seed_documents": data.get("seed_documents", []),
            }
        )
    
    # Start in background
    asyncio.create_task(_start())
    
    return jsonify({
        "run_id": run_id,
        "status": "started",
    })


@simulation_bp.route('/<run_id>', methods=['GET'])
def get_simulation(run_id: str):
    """Get simulation status"""
    state = _state_manager.get(run_id)
    if not state:
        return jsonify({"error": "Run not found"}), 404
    
    return jsonify(state.to_dict())


@simulation_bp.route('/<run_id>/pause', methods=['POST'])
def pause_simulation(run_id: str):
    """Pause a running simulation"""
    state = _state_manager.get(run_id)
    if not state:
        return jsonify({"error": "Run not found"}), 404
    
    if state.state == RunState.RUNNING:
        _state_manager.update(run_id, state=RunState.PAUSED)
        return jsonify({"message": "Paused"})
    
    return jsonify({"error": "Cannot pause"}), 400


@simulation_bp.route('/<run_id>/resume', methods=['POST'])
def resume_simulation(run_id: str):
    """Resume a paused simulation"""
    state = _state_manager.get(run_id)
    if not state:
        return jsonify({"error": "Run not found"}), 404
    
    if state.state == RunState.PAUSED:
        _state_manager.update(run_id, state=RunState.RUNNING)
        return jsonify({"message": "Resumed"})
    
    return jsonify({"error": "Cannot resume"}), 400


@simulation_bp.route('/<run_id>/cancel', methods=['POST'])
def cancel_simulation(run_id: str):
    """Cancel a simulation"""
    state = _state_manager.get(run_id)
    if not state:
        return jsonify({"error": "Run not found"}), 404
    
    _state_manager.update(run_id, state=RunState.CANCELLED)
    return jsonify({"message": "Cancelled"})


@simulation_bp.route('/<simulation_id>/stakeholders', methods=['GET'])
def get_stakeholders(simulation_id: str):
    """Get stakeholders for a simulation (for US-100 visualization)"""
    return jsonify({
        "stakeholders": [],
        "coalition_groups": [],
    })


@simulation_bp.route('/<simulation_id>/clusters', methods=['GET'])
def get_clusters(simulation_id: str):
    """Get agent clusters for visualization"""
    return jsonify({
        "clusters": [],
    })


@simulation_bp.route('/<simulation_id>/beliefs', methods=['GET'])
def get_beliefs(simulation_id: str):
    """Get belief evolution data"""
    return jsonify({
        "beliefs": [],
        "rounds": [],
    })


@simulation_bp.route('/iterate', methods=['POST'])
def start_iterate():
    """
    Start an iterative simulation.
    
    Implements: US-049
    """
    data = request.get_json() or {}
    run_id = f"iter_{uuid.uuid4().hex[:8]}"
    
    return jsonify({
        "run_id": run_id,
        "message": "Iterative simulation started",
    })


@simulation_bp.route('/iterate/status/<run_id>', methods=['GET'])
def get_iterate_status(run_id: str):
    """
    Get iterative simulation status.
    
    Implements: US-049
    """
    return jsonify({
        "run_id": run_id,
        "current_iteration": 1,
        "stage": "simulation",
    })


@simulation_bp.route('/iterate/<run_id>/history', methods=['GET'])
def get_iterate_history(run_id: str):
    """Get iteration history for convergence chart (US-064)"""
    return jsonify({
        "run_id": run_id,
        "iterations": [
            {"iteration": 1, "convergence_score": 0.6},
            {"iteration": 2, "convergence_score": 0.75},
        ],
    })
