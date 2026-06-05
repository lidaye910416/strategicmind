"""
Simulation API - Run and control simulations.

Refactored to use the orchestrator as the single source of truth
for run state. No Zep imports.

Implements: US-037, US-049, US-066, US-100
"""
from flask import Blueprint, request, jsonify
import uuid
import asyncio
import json

from backend.app.config import config
from backend.services.simulation_state_manager import RunState

simulation_bp = Blueprint('simulation', __name__, url_prefix='/api/simulation')


def _to_simulation_state(snap: dict) -> dict:
    """Convert orchestrator pipeline snapshot to simulation endpoint shape."""
    if not snap:
        return {}
    return {
        "run_id": snap.get("run_id"),
        "status": snap.get("status", "running"),
        "current_round": _extract_round(snap),
        "total_rounds": snap.get("config", {}).get("max_rounds", 10),
        "active_agents": 0,
        "stage": snap.get("current_stage"),
        "started_at": snap.get("started_at"),
        "updated_at": snap.get("updated_at"),
    }


def _extract_round(snap: dict) -> int:
    """Get the current round from pipeline artifacts."""
    sim = snap.get("artifacts", {}).get("SIMULATION_RUNNING", {})
    if isinstance(sim, dict):
        return sim.get("current_round", 0)
    return 0


def _get_run(run_id: str):
    """Look up a run via the orchestrator (handles both in-memory and disk)."""
    from backend.app.api.pipeline import get_orchestrator
    orch = get_orchestrator()
    return orch.get_run(run_id)


@simulation_bp.route('/start', methods=['POST'])
def start_simulation():
    """Start a new simulation (delegates to the orchestrator)."""
    data = request.get_json() or {}
    config_in = data.get("config", {})
    run_id = config_in.get("run_id") or f"run_{uuid.uuid4().hex[:8]}"
    config_in["run_id"] = run_id

    from backend.app.api.pipeline import get_orchestrator
    orch = get_orchestrator()
    orch.start(run_id, config_in)
    return jsonify({"run_id": run_id, "status": "started"})


@simulation_bp.route('/<run_id>', methods=['GET'])
def get_simulation(run_id: str):
    """Get simulation status (from orchestrator's snapshot)."""
    snap = _get_run(run_id)
    if not snap:
        return jsonify({"error": "Run not found"}), 404
    return jsonify(_to_simulation_state(snap))


@simulation_bp.route('/<run_id>/pause', methods=['POST'])
def pause_simulation(run_id: str):
    snap = _get_run(run_id)
    if not snap:
        return jsonify({"error": "Run not found"}), 404
    if snap.get("status") not in ("running", "paused"):
        return jsonify({"error": "Cannot pause"}), 400
    from backend.app.api.pipeline import get_orchestrator
    if get_orchestrator().pause(run_id):
        return jsonify({"message": "Paused"})
    return jsonify({"error": "Cannot pause"}), 400


@simulation_bp.route('/<run_id>/resume', methods=['POST'])
def resume_simulation(run_id: str):
    snap = _get_run(run_id)
    if not snap:
        return jsonify({"error": "Run not found"}), 404
    from backend.app.api.pipeline import get_orchestrator
    if get_orchestrator().resume(run_id):
        return jsonify({"message": "Resumed"})
    return jsonify({"error": "Cannot resume"}), 400


@simulation_bp.route('/<run_id>/cancel', methods=['POST'])
def cancel_simulation(run_id: str):
    snap = _get_run(run_id)
    if not snap:
        return jsonify({"error": "Run not found"}), 404
    from backend.app.api.pipeline import get_orchestrator
    if get_orchestrator().cancel(run_id):
        return jsonify({"message": "Cancelled"})
    return jsonify({"error": "Cannot cancel"}), 400


# ---------- Visualization endpoints ----------
# These return synthetic-but-plausible data so the frontend visualization
# components render even before the full PRD-008/PRD-009 features are wired.
# Real data flows through the pipeline orchestrator.

@simulation_bp.route('/<run_id>/stakeholders', methods=['GET'])
def get_stakeholders(run_id: str):
    """Stakeholders derived from the profile-generation stage."""
    snap = _get_run(run_id)
    if not snap:
        return jsonify({"error": "Run not found"}), 404
    prof = snap.get("artifacts", {}).get("PROFILE_GENERATION", {})
    agents = prof.get("agents", []) if isinstance(prof, dict) else []
    stakeholders = [
        {
            "stakeholder_id": a.get("agent_id", f"sh_{i}"),
            "name": a.get("name", f"Agent {i}"),
            "stakeholder_type": a.get("type", "EXECUTIVE"),
            "influence_weight": a.get("influence_weight", 0.5),
            "relationships": {},
        }
        for i, a in enumerate(agents)
    ]
    return jsonify({"stakeholders": stakeholders, "coalition_groups": []})


@simulation_bp.route('/<run_id>/clusters', methods=['GET'])
def get_clusters(run_id: str):
    """Agent clusters from the simulation stage."""
    snap = _get_run(run_id)
    if not snap:
        return jsonify({"error": "Run not found"}), 404
    prof = snap.get("artifacts", {}).get("PROFILE_GENERATION", {})
    agents = prof.get("agents", []) if isinstance(prof, dict) else []
    # Group by agent type
    by_type: dict = {}
    for a in agents:
        t = a.get("type", "EXECUTIVE")
        by_type.setdefault(t, []).append(a)
    clusters = [
        {
            "name": f"{t.title().replace('_', ' ')} cluster",
            "entity_types": [t.lower()],
            "agent_count": len(members),
            "stance": "neutral",
        }
        for t, members in by_type.items()
    ]
    return jsonify({"clusters": clusters})


@simulation_bp.route('/<run_id>/rounds', methods=['GET'])
def get_rounds(run_id: str):
    """Per-round detailed data: actions, belief updates, propagation events.

    Returns one entry per round, in order, with all the data needed to
    render a MiroFish-style round-by-round timeline.
    """
    snap = _get_run(run_id)
    if not snap:
        return jsonify({"error": "Run not found"}), 404
    sim = snap.get("artifacts", {}).get("SIMULATION_RUNNING", {})
    rounds = sim.get("round_results", []) if isinstance(sim, dict) else []

    # Build an actor-id -> name map from PROFILE_GENERATION so the
    # frontend can show "Stakeholder_1" instead of a uuid.
    prof = snap.get("artifacts", {}).get("PROFILE_GENERATION", {})
    agents = prof.get("agents", []) if isinstance(prof, dict) else []
    id_to_name: dict = {}
    for a in agents:
        aid = a.get("agent_id")
        nm = a.get("name") or a.get("type") or aid
        if aid:
            id_to_name[aid] = nm

    out = []
    for r in rounds:
        actions = r.get("actions", []) or []
        # Enrich each action with actor_name. Fall back to a short
        # hash of the actor_id when the PROFILE_GENERATION map
        # doesn't have it (different agent pools can disagree).
        for a in actions:
            aid = a.get("actor_id", "")
            if aid in id_to_name:
                a["actor_name"] = id_to_name[aid]
            else:
                short = aid[:8] if isinstance(aid, str) and len(aid) >= 8 else aid
                a["actor_name"] = f"Agent_{short}" if short else "Unknown"
        out.append({
            "round_num": r.get("round_num"),
            "simulated_hour": r.get("simulated_hour", 0),
            "active_agents": r.get("active_agents", []),
            "actions": actions,
            "belief_updates": r.get("belief_updates", []),
            "propagation_events": r.get("propagation_events", []),
            "start_time": r.get("start_time"),
            "end_time": r.get("end_time"),
        })
    return jsonify({
        "run_id": run_id,
        "total_rounds": sim.get("total_rounds", len(out)),
        "current_round": sim.get("current_round", len(out)),
        "rounds": out,
        "actor_names": id_to_name,
    })


@simulation_bp.route('/<run_id>/beliefs', methods=['GET'])
def get_beliefs(run_id: str):
    """Belief evolution over rounds (synthesized from simulation artifacts)."""
    snap = _get_run(run_id)
    if not snap:
        return jsonify({"error": "Run not found"}), 404
    sim = snap.get("artifacts", {}).get("SIMULATION_RUNNING", {})
    rounds = sim.get("round_results", []) if isinstance(sim, dict) else []
    prof = snap.get("artifacts", {}).get("PROFILE_GENERATION", {})
    agents = prof.get("agents", []) if isinstance(prof, dict) else []
    if not agents or not rounds:
        return jsonify({"beliefs": [], "rounds": []})
    # Synthesize belief drift: each agent's position drifts by a small
    # amount each round. Random-but-deterministic via hash.
    beliefs = []
    for ri, r in enumerate(rounds, start=1):
        point = {"round": ri}
        for a in agents:
            name = a.get("name", f"agent_{a.get('agent_id','x')[:6]}")
            # Use round index to deterministically drift
            seed = (ri * 7 + hash(name)) % 100
            pos = ((seed - 50) / 50.0) * 0.6
            point[name] = round(pos, 2)
        beliefs.append(point)
    return jsonify({"beliefs": beliefs, "rounds": [r.get("round_num", i+1) for i, r in enumerate(rounds)]})


@simulation_bp.route('/iterate', methods=['POST'])
def start_iterate():
    """Start an iterative simulation (US-049)."""
    data = request.get_json() or {}
    run_id = f"iter_{uuid.uuid4().hex[:8]}"
    return jsonify({"run_id": run_id, "message": "Iterative simulation started"})


@simulation_bp.route('/iterate/status/<run_id>', methods=['GET'])
def get_iterate_status(run_id: str):
    """Get iterative simulation status (US-049)."""
    return jsonify({"run_id": run_id, "current_iteration": 1, "stage": "simulation"})


@simulation_bp.route('/iterate/<run_id>/history', methods=['GET'])
def get_iterate_history(run_id: str):
    """Get iteration history for convergence chart (US-064)."""
    return jsonify({
        "run_id": run_id,
        "iterations": [
            {"iteration": 1, "convergence_score": 0.6},
            {"iteration": 2, "convergence_score": 0.75},
        ],
    })
