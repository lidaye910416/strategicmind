"""
MockGraphStore - Mock implementation of IGraphStore for testing

This mock stores data in memory and can be configured to return
specific values or raise errors.
"""

from typing import List, Dict, Any, Optional
from backend.interfaces.graph_store import IGraphStore


class MockGraphStore(IGraphStore):
    """
    Mock implementation of IGraphStore for testing.
    
    Features:
        - In-memory storage
        - Configurable return values
        - Error injection for negative testing
    
    Usage:
        store = MockGraphStore()
        store.create_graph("test_graph")
        
        # Configure mock responses
        store.set_search_results([{"text": "result", "score": 0.9}])
    """
    
    def __init__(self):
        """Initialize mock graph store"""
        self._graphs: Dict[str, Dict[str, Any]] = {}
        self._nodes: Dict[str, List[Dict[str, Any]]] = {}
        self._edges: Dict[str, List[Dict[str, Any]]] = {}
        
        # Configurable mock responses
        self._search_results: Optional[List[Dict[str, Any]]] = None
        self._should_error: bool = False
        self._error_message: str = "Mock error"
        
        # Create default graph
        self.create_graph("default")
    
    def create_graph(self, graph_id: str, config: Optional[Dict[str, Any]] = None) -> bool:
        """Create a new graph (in-memory)"""
        if graph_id not in self._graphs:
            self._graphs[graph_id] = config or {}
            self._nodes[graph_id] = []
            self._edges[graph_id] = []
        return True
    
    async def insert_texts(
        self,
        graph_id: str,
        texts: List[str],
        metadata: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """Insert texts (mock - just stores)"""
        if self._should_error:
            raise Exception(self._error_message)
        
        if graph_id not in self._graphs:
            self.create_graph(graph_id)
        
        count = len(texts)
        return {
            "inserted_count": count,
            "node_count": count,
            "edge_count": 0,
        }
    
    async def search(
        self,
        graph_id: str,
        query: str,
        top_k: int = 10,
        filters: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """Search (returns mock results or empty)"""
        if self._should_error:
            raise Exception(self._error_message)
        
        if self._search_results is not None:
            return self._search_results[:top_k]
        
        return []
    
    async def get_nodes(
        self,
        graph_id: str,
        node_ids: Optional[List[str]] = None,
        node_type: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get nodes (returns stored nodes)"""
        if self._should_error:
            raise Exception(self._error_message)
        
        nodes = self._nodes.get(graph_id, [])
        
        if node_ids:
            nodes = [n for n in nodes if n.get("id") in node_ids]
        
        if node_type:
            nodes = [n for n in nodes if n.get("entity_type") == node_type]
        
        return nodes[:limit]
    
    async def get_edges(
        self,
        graph_id: str,
        edge_ids: Optional[List[str]] = None,
        source_id: Optional[str] = None,
        target_id: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get edges (returns stored edges)"""
        if self._should_error:
            raise Exception(self._error_message)
        
        edges = self._edges.get(graph_id, [])
        
        if edge_ids:
            edges = [e for e in edges if e.get("id") in edge_ids]
        
        if source_id:
            edges = [e for e in edges if e.get("source_id") == source_id]
        
        if target_id:
            edges = [e for e in edges if e.get("target_id") == target_id]
        
        return edges[:limit]
    
    async def delete_graph(self, graph_id: str) -> bool:
        """Delete a graph"""
        if graph_id in self._graphs:
            del self._graphs[graph_id]
            del self._nodes[graph_id]
            del self._edges[graph_id]
            return True
        return False
    
    # Mock configuration methods
    def set_search_results(self, results: List[Dict[str, Any]]) -> None:
        """Configure search results"""
        self._search_results = results
    
    def add_node(self, graph_id: str, node: Dict[str, Any]) -> None:
        """Add a node for testing"""
        if graph_id not in self._nodes:
            self.create_graph(graph_id)
        self._nodes[graph_id].append(node)
    
    def add_edge(self, graph_id: str, edge: Dict[str, Any]) -> None:
        """Add an edge for testing"""
        if graph_id not in self._edges:
            self.create_graph(graph_id)
        self._edges[graph_id].append(edge)
    
    def set_error(self, should_error: bool, message: str = "Mock error") -> None:
        """Configure error injection"""
        self._should_error = should_error
        self._error_message = message
    
    def reset(self) -> None:
        """Reset mock state"""
        self._graphs.clear()
        self._nodes.clear()
        self._edges.clear()
        self._search_results = None
        self._should_error = False
        self.create_graph("default")
