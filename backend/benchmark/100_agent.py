"""
100-agent benchmark test

Measures performance for 100-agent simulation.
Target: round latency < 10s, profile generation < 2min.

Implements: US-043
"""

import time
import asyncio
import sys
sys.path.insert(0, '.')


async def run_100_agent_benchmark():
    """Run 100-agent benchmark"""
    from backend.models.strategic_agent import StrategicAgent, AgentType
    from backend.tests.mocks.mock_llm_provider import MockLLMProvider
    from backend.services.simulation_loop import SimulationLoop
    from backend.services.belief_engine import BeliefEngine
    from backend.services.propagation_layer import PropagationLayer
    
    # Create 100 mock agents
    agents = [
        StrategicAgent(
            name=f"Agent_{i}",
            agent_type=AgentType.CORPORATE_EXEC,
            influence_weight=0.5,
        )
        for i in range(100)
    ]
    
    llm = MockLLMProvider()
    belief_engine = BeliefEngine()
    propagation = PropagationLayer()
    
    loop = SimulationLoop(
        belief_engine=belief_engine,
        propagation_layer=propagation,
        llm_provider=llm,
        config={"max_concurrent_agents": 30, "hours_per_round": 6},
    )
    
    # Profile generation benchmark
    start = time.time()
    results = await loop.run(agents, max_rounds=5, simulated_hours=30)
    elapsed = time.time() - start
    
    print(f"100-agent benchmark completed in {elapsed:.2f}s")
    print(f"  Rounds: {results.get('current_round', 0)}")
    print(f"  Per round: {elapsed / max(results.get('current_round', 1), 1):.2f}s")
    
    assert elapsed < 60, f"100-agent round latency {elapsed}s exceeds 10s per round target"
    return results


if __name__ == "__main__":
    asyncio.run(run_100_agent_benchmark())
