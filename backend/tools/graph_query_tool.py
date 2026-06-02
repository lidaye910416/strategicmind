"""
GraphQueryTool - Entity and neighbor queries

Implements ITool for graph query functionality.
"""

from typing import Dict, Any, Optional

from ..interfaces.tool import ITool, ToolResult
from ..interfaces.knowledge_store import IKnowledgeStore


class GraphQueryTool(ITool):
    """Tool for querying entity and neighbor data"""
    
    def __init__(self, knowledge_store: IKnowledgeStore):
        self.knowledge_store = knowledge_store
    
    @property
    def name(self) -> str:
        return "graph_query"
    
    @property
    def description(self) -> str:
        return "Query entity details and relationships from the knowledge graph. Get full context for a specific entity."
    
    @property
    def parameters(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "Entity ID to query"},
                "depth": {"type": "integer", "description": "Traversal depth", "default": 1},
            },
            "required": ["entity_id"],
        }
    
    async def execute(self, entity_id: str, depth: int = 1, **kwargs) -> ToolResult:
        try:
            entity = await self.knowledge_store.get_entity(entity_id)
            if not entity:
                return ToolResult(success=False, error=f"Entity not found: {entity_id}")
            
            neighbors = await self.knowledge_store.get_neighbors(entity_id, depth=depth)
            context = await self.knowledge_store.get_entity_context(entity_id)
            
            return ToolResult(
                success=True,
                data={
                    "entity": entity,
                    "neighbors": neighbors,
                    "context": context,
                },
            )
        except Exception as e:
            return ToolResult(success=False, error=str(e))
