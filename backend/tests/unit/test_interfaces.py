"""
Unit tests for interfaces
"""

import pytest
import asyncio
from backend.interfaces.graph_store import IGraphStore
from backend.interfaces.llm_provider import ILLMProvider
from backend.interfaces.knowledge_store import IKnowledgeStore
from backend.interfaces.simulation_backend import ISimulationBackend, SimulationStatus
from backend.tests.mocks.mock_graph_store import MockGraphStore
from backend.tests.mocks.mock_llm_provider import MockLLMProvider


class TestIGraphStore:
    """Tests for IGraphStore interface"""
    
    def test_create_graph(self):
        store = MockGraphStore()
        assert store.create_graph("test_graph") is True
        assert "test_graph" in store._graphs
    
    def test_insert_texts(self):
        store = MockGraphStore()
        result = asyncio.run(store.insert_texts("default", ["text1", "text2"]))
        assert result["inserted_count"] == 2
    
    def test_search_returns_list(self):
        store = MockGraphStore()
        store.set_search_results([{"text": "result", "score": 0.9}])
        results = asyncio.run(store.search("default", "test"))
        assert len(results) == 1
        assert results[0]["score"] == 0.9
    
    def test_error_injection(self):
        store = MockGraphStore()
        store.set_error(True, "Test error")
        with pytest.raises(Exception):
            asyncio.run(store.search("default", "test"))


class TestILLMProvider:
    """Tests for ILLMProvider interface"""
    
    def test_mock_provider_basic(self):
        mock = MockLLMProvider()
        mock.set_response("Hello, world!")
        
        response = asyncio.run(mock.chat([{"role": "user", "content": "Hi"}]))
        assert response == "Hello, world!"
        assert len(mock.call_history) == 1
    
    def test_mock_provider_sequence(self):
        mock = MockLLMProvider()
        mock.set_responses(["First", "Second", "Third"])
        
        r1 = asyncio.run(mock.chat([{"role": "user", "content": "1"}]))
        r2 = asyncio.run(mock.chat([{"role": "user", "content": "2"}]))
        r3 = asyncio.run(mock.chat([{"role": "user", "content": "3"}]))
        
        assert r1 == "First"
        assert r2 == "Second"
        assert r3 == "Third"
    
    def test_mock_error(self):
        mock = MockLLMProvider()
        mock.set_error(True, "Test error", ValueError)
        
        with pytest.raises(ValueError):
            asyncio.run(mock.chat([{"role": "user", "content": "Hi"}]))


class TestSimulationBackend:
    """Tests for ISimulationBackend interface"""
    
    def test_simulation_status_enum(self):
        assert SimulationStatus.IDLE.value == "idle"
        assert SimulationStatus.RUNNING.value == "running"
        assert SimulationStatus.PAUSED.value == "paused"
        assert SimulationStatus.COMPLETED.value == "completed"
