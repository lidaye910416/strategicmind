"""
Unit tests for models
"""

import pytest
from backend.models.entity import Entity
from backend.models.strategic_agent import StrategicAgent, AgentType, BeliefState, BeliefPosition
from backend.models.action_type import ActionType, StrategicAction, PropagationChannel
from backend.models.stakeholder import StakeholderModel, StakeholderType, RelationshipType
from backend.models.ontology_schema import OntologySchema, EntitySchema, RelationSchema


class TestEntity:
    """Tests for Entity model"""
    
    def test_create_entity(self):
        entity = Entity(name="Test Corp", entity_type="Organization")
        assert entity.name == "Test Corp"
        assert entity.entity_type == "Organization"
        assert entity.uuid is not None
    
    def test_entity_to_dict(self):
        entity = Entity(name="Test", entity_type="Person")
        data = entity.to_dict()
        assert data["name"] == "Test"
        assert data["entity_type"] == "Person"
    
    def test_entity_from_dict(self):
        data = {"name": "From Dict", "entity_type": "Company"}
        entity = Entity.from_dict(data)
        assert entity.name == "From Dict"


class TestStrategicAgent:
    """Tests for StrategicAgent model"""
    
    def test_create_agent(self):
        agent = StrategicAgent(
            name="CEO Wang",
            agent_type=AgentType.CORPORATE_EXEC,
        )
        assert agent.name == "CEO Wang"
        assert agent.agent_type == AgentType.CORPORATE_EXEC
    
    def test_agent_beliefs(self):
        agent = StrategicAgent(name="Test", agent_type=AgentType.ANALYST)
        agent.beliefs.update_position("market_trend", 0.7, confidence=0.9)
        
        pos = agent.beliefs.get_position("market_trend")
        assert pos == 0.7
    
    def test_agent_serialization(self):
        agent = StrategicAgent(name="Test Agent", agent_type=AgentType.POLICY_MAKER)
        data = agent.to_dict()
        assert data["name"] == "Test Agent"
        assert data["agent_type"] == "POLICY_MAKER"


class TestActionType:
    """Tests for ActionType and StrategicAction"""
    
    def test_action_type_enum(self):
        assert ActionType.MAKE_STATEMENT.value == "MAKE_STATEMENT"
        assert ActionType.TRADE_ASSET.value == "TRADE_ASSET"
        assert ActionType.is_public(ActionType.MAKE_STATEMENT) is True
    
    def test_strategic_action(self):
        action = StrategicAction(
            action_type=ActionType.PROPOSE_DEAL,
            actor_id="agent_1",
            public_description="Proposing a partnership",
            target_ids=["agent_2"],
        )
        assert action.action_type == ActionType.PROPOSE_DEAL
        assert action.round_num == 0


class TestStakeholderModel:
    """Tests for StakeholderModel"""
    
    def test_create_stakeholder(self):
        stakeholder = StakeholderModel(
            stakeholder_id="sh_1",
            name="Major Shareholder",
            stakeholder_type=StakeholderType.SHAREHOLDER,
        )
        assert stakeholder.name == "Major Shareholder"
    
    def test_stakeholder_relationships(self):
        sh = StakeholderModel("s1", "Shareholder", StakeholderType.SHAREHOLDER)
        exec = StakeholderModel("s2", "CEO", StakeholderType.EXECUTIVE)
        
        sh.add_relationship("s2", RelationshipType.CONTROL, strength=0.8)
        assert sh.has_relationship_type("s2", RelationshipType.CONTROL)


class TestOntologySchema:
    """Tests for OntologySchema"""
    
    def test_create_schema(self):
        schema = OntologySchema(name="test", version="1.0")
        entity = EntitySchema(name="Company", description="A corporation")
        schema.add_entity(entity)
        
        assert "Company" in schema.get_entity_types()
        assert schema.get_entity("Company") is not None
    
    def test_schema_serialization(self):
        schema = OntologySchema(name="test")
        schema.add_entity(EntitySchema(name="Person"))
        
        data = schema.to_dict()
        assert data["name"] == "test"
        assert len(data["entity_types"]) == 1
    
    def test_schema_deserialization(self):
        data = {
            "name": "from_dict",
            "version": "2.0",
            "entity_types": [{"name": "Test", "description": ""}],
            "edge_types": [],
        }
        schema = OntologySchema.from_dict(data)
        assert schema.name == "from_dict"
        assert "Test" in schema.get_entity_types()
