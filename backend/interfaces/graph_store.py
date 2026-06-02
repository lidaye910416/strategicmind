"""
IGraphStore interface - Abstract interface for graph storage layer

This interface allows swapping between Zep Cloud and local implementations.
Replaces: MiroFish's Zep SDK dependency
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional


class IGraphStore(ABC):
    """
    Abstract interface for graph storage operations.
    
    Implementations:
        - LocalGraphStore: Using nano-graphRAG
        - (Future) ZepGraphStore: Using Zep Cloud SDK
    
    Methods:
        create_graph: Create a new knowledge graph
        insert_texts: Insert texts and build graph structure
        search: Hybrid search for relevant context
        get_nodes: Retrieve nodes from graph
        get_edges: Retrieve edges from graph
        delete_graph: Delete a graph and its data
    """
    
    @abstractmethod
    def create_graph(self, graph_id: str, config: Optional[Dict[str, Any]] = None) -> bool:
        """
        Create a new knowledge graph.
        
        Args:
            graph_id: Unique identifier for the graph
            config: Optional configuration for graph creation
            
        Returns:
            True if created successfully, False otherwise
        """
        ...
    
    @abstractmethod
    async def insert_texts(
        self, 
        graph_id: str, 
        texts: List[str], 
        metadata: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Insert texts and build graph structure.
        
        Args:
            graph_id: Target graph identifier
            texts: List of text strings to insert
            metadata: Optional metadata for each text
            
        Returns:
            Dict with insertion results including node/edge counts
        """
        ...
    
    @abstractmethod
    async def search(
        self, 
        graph_id: str, 
        query: str, 
        top_k: int = 10,
        filters: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Hybrid search for relevant context.
        
        Args:
            graph_id: Graph to search
            query: Search query string
            top_k: Number of results to return
            filters: Optional filters for search
            
        Returns:
            List of search results with scores
        """
        ...
    
    @abstractmethod
    async def get_nodes(
        self, 
        graph_id: str, 
        node_ids: Optional[List[str]] = None,
        node_type: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """
        Retrieve nodes from graph.
        
        Args:
            graph_id: Graph identifier
            node_ids: Specific node IDs to retrieve (optional)
            node_type: Filter by node type (optional)
            limit: Maximum number of nodes to return
            
        Returns:
            List of node data dictionaries
        """
        ...
    
    @abstractmethod
    async def get_edges(
        self, 
        graph_id: str, 
        edge_ids: Optional[List[str]] = None,
        source_id: Optional[str] = None,
        target_id: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """
        Retrieve edges from graph.
        
        Args:
            graph_id: Graph identifier
            edge_ids: Specific edge IDs to retrieve (optional)
            source_id: Filter edges by source node (optional)
            target_id: Filter edges by target node (optional)
            limit: Maximum number of edges to return
            
        Returns:
            List of edge data dictionaries
        """
        ...
    
    @abstractmethod
    async def delete_graph(self, graph_id: str) -> bool:
        """
        Delete a graph and all its data.
        
        Args:
            graph_id: Graph identifier to delete
            
        Returns:
            True if deleted successfully, False otherwise
        """
        ...
