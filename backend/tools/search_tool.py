"""
SearchTool - Semantic search using nano-GraphRAG

Implements ITool for semantic search functionality.
"""

from typing import Dict, Any, Optional

from ..interfaces.tool import ITool, ToolResult
from ..interfaces.knowledge_store import IKnowledgeStore


class SearchTool(ITool):
    """Tool for semantic search using knowledge store"""
    
    def __init__(self, knowledge_store: IKnowledgeStore):
        self.knowledge_store = knowledge_store
    
    @property
    def name(self) -> str:
        return "search"
    
    @property
    def description(self) -> str:
        return "Search for relevant information in the knowledge graph. Use this to find entities, facts, and context."
    
    @property
    def parameters(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "limit": {"type": "integer", "description": "Max results", "default": 10},
            },
            "required": ["query"],
        }
    
    async def execute(self, query: str, limit: int = 10, **kwargs) -> ToolResult:
        try:
            results = await self.knowledge_store.search(query, top_k=limit)
            return ToolResult(
                success=True,
                data={"results": results, "count": len(results)},
            )
        except Exception as e:
            return ToolResult(success=False, error=str(e))
