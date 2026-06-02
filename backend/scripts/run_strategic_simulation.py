"""
run_strategic_simulation.py - CLI entry point for strategic simulations

Implements: US-077
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))


async def run_simulation(config_path: str, max_rounds: int = 10, wait: bool = False):
    """Run strategic simulation from config file"""
    from backend.services.simulation_runner import SimulationRunner
    from backend.services.strategic_backend import StrategicBackend
    from backend.services.simulation_state_manager import SimulationStateManager
    from backend.services.simulation_ipc import SimulationIPC
    from backend.adapters.bailian_adapter import BailianAdapter
    from backend.app.config import config
    
    # Load config
    with open(config_path, "r") as f:
        sim_config = json.load(f)
    
    # Setup services
    llm = BailianAdapter(api_key=config.LLM_API_KEY)
    backend = StrategicBackend(llm_provider=llm)
    state_manager = SimulationStateManager()
    ipc = SimulationIPC()
    
    runner = SimulationRunner(
        backend=backend,
        state_manager=state_manager,
        ipc=ipc,
    )
    
    run_id = sim_config.get("run_id", "cli_run")
    
    print(f"🚀 Starting strategic simulation: {run_id}")
    print(f"   Max rounds: {max_rounds}")
    
    # Run simulation
    sim_config["max_rounds"] = max_rounds
    results = await runner.start(run_id, sim_config)
    
    # Save results as actions.jsonl (compatible with updater)
    actions_path = Path(f"actions_{run_id}.jsonl")
    with open(actions_path, "w") as f:
        for round_result in results.get("round_results", []):
            for action in round_result.get("actions", []):
                f.write(json.dumps(action) + "\n")
    
    print(f"✅ Simulation complete: {len(results.get('round_results', []))} rounds")
    print(f"   Actions saved to: {actions_path}")
    
    if wait:
        print("\nCommands available: status, stop")
        # Interactive commands (simplified)
        import time
        time.sleep(2)
        print("Final state:", state_manager.get(run_id).to_dict() if state_manager.get(run_id) else "unknown")


def main():
    parser = argparse.ArgumentParser(description="Run strategic simulation")
    parser.add_argument("--config", required=True, help="Path to SimulationConfig JSON")
    parser.add_argument("--max-rounds", type=int, default=10, help="Maximum rounds")
    parser.add_argument("--wait", action="store_true", help="Wait for completion")
    
    args = parser.parse_args()
    asyncio.run(run_simulation(args.config, args.max_rounds, args.wait))


if __name__ == "__main__":
    main()
