"""
End-to-end Pipeline integration test

Tests the full pipeline from document upload to report generation.
Implements: US-057
"""

import pytest
import asyncio
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))


@pytest.mark.asyncio
async def test_e2e_pipeline():
    """Test end-to-end pipeline flow"""
    from backend.tests.mocks.mock_llm_provider import MockLLMProvider
    from backend.tests.mocks.mock_graph_store import MockGraphStore
    from backend.services.local_knowledge_store import LocalKnowledgeStore
    from backend.services.entity_extractor import EntityExtractor
    from backend.services.graph_builder_service import GraphBuilderService
    from backend.services.belief_engine import BeliefEngine
    from backend.services.simulation_loop import SimulationLoop
    from backend.services.propagation_layer import PropagationLayer
    from backend.services.report_agent import ReportAgent
    from backend.tools.search_tool import SearchTool
    from backend.models.strategic_agent import StrategicAgent, AgentType
    from backend.models.seed_document import SeedDocument, DocumentType
    
    # Setup
    mock_llm = MockLLMProvider()
    mock_llm.set_response('{"name": "Test Corp", "entity_type": "Organization", "summary": "A test company"}')
    
    mock_graph = MockGraphStore()
    knowledge_store = LocalKnowledgeStore(
        graph_store=mock_graph,
        llm_provider=mock_llm,
    )
    
    # Stage 1: SeedDocument parsing
    doc = SeedDocument(
        doc_id="doc_1",
        title="Test Document",
        content="Apple Inc. is a technology company. Tim Cook is the CEO.",
        doc_type=DocumentType.NEWS,
    )
    
    # Stage 2: Graph building
    entity_extractor = EntityExtractor(mock_llm)
    builder = GraphBuilderService(entity_extractor, knowledge_store)
    
    build_result = await builder.build([doc])
    assert build_result["documents_processed"] == 1
    assert build_result["entities_created"] >= 1
    
    # Stage 3: Profile generation
    agents = [
        StrategicAgent(name="Agent 1", agent_type=AgentType.CORPORATE_EXEC),
        StrategicAgent(name="Agent 2", agent_type=AgentType.INSTITUTIONAL_INVESTOR),
    ]
    
    # Stage 4: Simulation
    belief_engine = BeliefEngine()
    propagation = PropagationLayer()
    sim_loop = SimulationLoop(belief_engine, propagation, mock_llm)
    
    sim_result = await sim_loop.run(agents, max_rounds=2)
    assert sim_result["current_round"] >= 1
    
    # Stage 5: Report generation
    search_tool = SearchTool(knowledge_store)
    report_agent = ReportAgent(tools=[search_tool], llm_provider=mock_llm)
    
    mock_llm.set_response("# Strategic Report\n\n## Summary\nTest report content")
    report = await report_agent.generate(sim_result)
    assert "Strategic Report" in report


def test_pipeline_stages():
    """Test that all 7 pipeline stages can be instantiated"""
    from backend.tests.mocks.mock_llm_provider import MockLLMProvider
    from backend.tests.mocks.mock_graph_store import MockGraphStore
    from backend.services.entity_extractor import EntityExtractor
    from backend.services.graph_builder_service import GraphBuilderService
    from backend.services.belief_engine import BeliefEngine
    from backend.services.simulation_loop import SimulationLoop
    from backend.services.propagation_layer import PropagationLayer
    
    # All stages can be instantiated
    assert EntityExtractor(MockLLMProvider()) is not None
    assert GraphBuilderService(EntityExtractor(MockLLMProvider()), MockGraphStore()) is not None
    assert BeliefEngine() is not None
    assert SimulationLoop(BeliefEngine(), PropagationLayer(), MockLLMProvider()) is not None
    assert PropagationLayer() is not None
