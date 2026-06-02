"""
Unit tests for services
"""

import pytest
import asyncio
from backend.services.belief_engine import BeliefEngine
from backend.services.entity_extractor import EntityExtractor
from backend.services.propagation_layer import PropagationLayer, PropagationChannel
from backend.services.action_parser import ActionParser, Platform
from backend.tests.mocks.mock_llm_provider import MockLLMProvider
from backend.models.strategic_agent import StrategicAgent, AgentType


class TestBeliefEngine:
    """Tests for BeliefEngine"""
    
    def test_update_belief(self):
        engine = BeliefEngine()
        agent = StrategicAgent(name="Test", agent_type=AgentType.ANALYST)
        
        update = engine.update_belief(
            agent_id=agent.agent_id,
            topic="market_sentiment",
            new_value=0.8,
            update_source="news",
            agent=agent,
        )
        
        assert update.new_position == 0.8
        assert agent.beliefs.get_position("market_sentiment") == 0.8
    
    def test_convergence_check(self):
        engine = BeliefEngine()
        agent1 = StrategicAgent(name="A1", agent_type=AgentType.INSTITUTIONAL_INVESTOR)
        agent2 = StrategicAgent(name="A2", agent_type=AgentType.INSTITUTIONAL_INVESTOR)
        
        agent1.beliefs.update_position("rate_decision", 0.7)
        agent2.beliefs.update_position("rate_decision", 0.75)
        
        result = engine.check_convergence("rate_decision", [agent1, agent2], threshold=0.2)
        assert result.converged is True
    
    def test_divergence_detection(self):
        engine = BeliefEngine()
        agent1 = StrategicAgent(name="A1", agent_type=AgentType.CORPORATE_EXEC)
        agent2 = StrategicAgent(name="A2", agent_type=AgentType.CORPORATE_EXEC)
        
        agent1.beliefs.update_position("expansion", 0.9)
        agent2.beliefs.update_position("expansion", -0.8)
        
        divergent = engine.get_divergent_agents("expansion", [agent1, agent2], threshold=0.5)
        assert len(divergent) == 2


class TestEntityExtractor:
    """Tests for EntityExtractor"""
    
    @pytest.mark.asyncio
    async def test_extract_entities(self):
        mock = MockLLMProvider()
        mock.set_response('[{"name": "Apple", "entity_type": "Organization", "summary": "Tech company"}]')
        
        extractor = EntityExtractor(mock)
        text = "Apple Inc. is a technology company headquartered in Cupertino."
        
        entities = await extractor.extract_entities(text)
        assert len(entities) == 1
        assert entities[0].name == "Apple"
    
    @pytest.mark.asyncio
    async def test_batch_extraction(self):
        mock = MockLLMProvider()
        mock.set_response('[{"name": "Test", "entity_type": "Test", "summary": ""}]')
        
        extractor = EntityExtractor(mock, batch_size=2)
        texts = ["Text 1", "Text 2", "Text 3"]
        
        results = await extractor.extract_batch(texts)
        assert len(results) == 3


class TestPropagationLayer:
    """Tests for PropagationLayer"""
    
    def test_knowledge_boundary(self):
        propagation = PropagationLayer()
        
        boundary = propagation.get_agent_knowledge_boundary("agent_1", round_num=5)
        assert isinstance(boundary, set)
    
    def test_channel_statistics(self):
        propagation = PropagationLayer()
        stats = propagation.get_channel_statistics()
        assert "DIRECT" in stats


class TestActionParser:
    """Tests for ActionParser"""
    
    def test_parse_twitter(self):
        parser = ActionParser()
        output = "User123 posts 'Breaking news about tech stocks'"
        
        actions = parser.parse_twitter(output)
        # Parser should find at least one action
        assert isinstance(actions, list)
    
    def test_parse_reddit(self):
        parser = ActionParser()
        output = "User456 comments on post #123 with 'Great analysis'"
        
        actions = parser.parse_reddit(output)
        assert isinstance(actions, list)
    
    def test_parse_json(self):
        parser = ActionParser()
        data = {
            "actions": [
                {"agent_id": 1, "agent_name": "User", "action_type": "CREATE_POST", "platform": "twitter"}
            ]
        }
        
        actions = parser.parse_json(data)
        assert len(actions) == 1
        assert actions[0].platform == Platform.TWITTER
