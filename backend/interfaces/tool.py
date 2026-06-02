"""
ITool interface and ToolResult - Abstract interface for agent tools

This interface allows tools (search, graph query, memory) to be implemented
by any backend and injected into ReportAgent and other components.

Tools provide capabilities like:
    - SearchTool: Semantic search
    - GraphQueryTool: Entity and neighbor queries
    - EntityInsertTool: Inserting entities into graph
    - MemoryTool: Long-term memory operations
    - RecallTool: Memory recall and retrieval
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional


@dataclass
class ToolResult:
    """
    Standard result object returned by all tools.
    
    Attributes:
        success: Whether the tool execution succeeded
        data: The result data from tool execution
        error: Error message if execution failed
        metadata: Additional metadata about the execution
    """
    success: bool
    data: Any = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary representation."""
        return {
            "success": self.success,
            "data": self.data,
            "error": self.error,
            "metadata": self.metadata,
        }


class ITool(ABC):
    """
    Abstract interface for agent tools.
    
    All tools must implement:
        - name: Tool identifier
        - description: Human-readable description
        - execute: The main execution method
    
    Tools are injected into agents via constructor:
        class ReportAgent:
            def __init__(self, tools: List[ITool]):
                self.tools = {t.name: t for t in tools}
    """
    
    @property
    @abstractmethod
    def name(self) -> str:
        """
        Get the tool's unique identifier.
        
        Returns:
            Tool name string (e.g., "search", "graph_query")
        """
        ...
    
    @property
    @abstractmethod
    def description(self) -> str:
        """
        Get the tool's description for LLM tool selection.
        
        Returns:
            Description string explaining what the tool does
        """
        ...
    
    @property
    def parameters(self) -> Dict[str, Any]:
        """
        Get the tool's parameter schema (JSON Schema format).
        
        Override this to define custom parameters.
        
        Returns:
            JSON Schema dict describing tool parameters
        """
        return {
            "type": "object",
            "properties": {},
            "required": [],
        }
    
    @abstractmethod
    async def execute(self, **kwargs: Any) -> ToolResult:
        """
        Execute the tool with given parameters.
        
        Args:
            **kwargs: Tool-specific parameters
            
        Returns:
            ToolResult with success status and data
            
        Raises:
            NotImplementedError: If not implemented by subclass
        """
        ...


# =============================================================================
# Standard Tool Implementations (Stubs)
# =============================================================================

class SearchTool(ITool):
    """Tool for semantic search using nano-GraphRAG"""
    
    @property
    def name(self) -> str:
        return "search"
    
    @property
    def description(self) -> str:
        return "Search for relevant information in the knowledge graph"
    
    async def execute(self, query: str, limit: int = 10, **kwargs) -> ToolResult:
        """Execute semantic search"""
        raise NotImplementedError("Use SearchTool implementation in backend/tools/search_tool.py")


class GraphQueryTool(ITool):
    """Tool for querying entity and neighbor data"""
    
    @property
    def name(self) -> str:
        return "graph_query"
    
    @property
    def description(self) -> str:
        return "Query entity details and relationships from the knowledge graph"
    
    async def execute(self, entity_id: str, depth: int = 1, **kwargs) -> ToolResult:
        """Execute graph query"""
        raise NotImplementedError("Use GraphQueryTool implementation in backend/tools/graph_query_tool.py")


class EntityInsertTool(ITool):
    """Tool for inserting entities into the graph"""
    
    @property
    def name(self) -> str:
        return "entity_insert"
    
    @property
    def description(self) -> str:
        return "Insert a new entity into the knowledge graph"
    
    async def execute(self, entity_data: Dict[str, Any], **kwargs) -> ToolResult:
        """Execute entity insertion"""
        raise NotImplementedError("Use EntityInsertTool implementation in backend/tools/entity_insert_tool.py")


class MemoryTool(ITool):
    """Tool for long-term memory operations"""
    
    @property
    def name(self) -> str:
        return "memory"
    
    @property
    def description(self) -> str:
        return "Store and retrieve long-term memory"
    
    async def execute(self, operation: str, content: Optional[str] = None, **kwargs) -> ToolResult:
        """Execute memory operation"""
        raise NotImplementedError("Memory tool not yet implemented")


class RecallTool(ITool):
    """Tool for memory recall and retrieval"""
    
    @property
    def name(self) -> str:
        return "recall"
    
    @property
    def description(self) -> str:
        return "Recall relevant memories based on context"
    
    async def execute(self, query: str, limit: int = 5, **kwargs) -> ToolResult:
        """Execute memory recall"""
        raise NotImplementedError("Recall tool not yet implemented")
