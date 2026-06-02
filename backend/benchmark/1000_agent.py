"""
1000-agent benchmark test

Measures performance for 1000-agent simulation.
Target: round latency < 30s, profile generation < 5min.

Implements: US-043
"""

import time
import asyncio
import sys
sys.path.insert(0, '.')


async def run_1000_agent_benchmark():
    """Run 1000-agent benchmark"""
    from backend.models.strategic_agent import StrategicAgent, AgentType
    from backend.tests.mocks.mock_llm_provider import MockLLMProvider
    from backend.services.simulation_loop import SimulationLoop
    from backend.services.belief_engine import BeliefEngine
    from backend.services.propagation_layer import PropagationLayer
    
    # Create 1000 mock agents
    agents = [
        StrategicAgent(
            name=f"Agent_{i}",
            agent_type=AgentType.CORPORATE_EXEC,
            influence_weight=0.5,
        )
        for i in range(1000)
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
    
    start = time.time()
    results = await loop.run(agents, max_rounds=3, simulated_hours=18)
    elapsed = time.time() - start
    
    print(f"1000-agent benchmark completed in {elapsed:.2f}s")
    
    return results


if __name__ == "__main__":
    asyncio.run(run_1000_agent_benchmark())
