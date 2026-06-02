"""
EntityInsertTool - Insert entities into the graph

Implements ITool for entity insertion functionality.
"""

from typing import Dict, Any

from ..interfaces.tool import ITool, ToolResult
from ..interfaces.knowledge_store import IKnowledgeStore


class EntityInsertTool(ITool):
    """Tool for inserting entities into the graph"""
    
    def __init__(self, knowledge_store: IKnowledgeStore):
        self.knowledge_store = knowledge_store
    
    @property
    def name(self) -> str:
        return "entity_insert"
    
    @property
    def description(self) -> str:
        return "Insert a new entity into the knowledge graph. Provide entity data with name and type."
    
    @property
    def parameters(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "entity_data": {
                    "type": "object",
                    "description": "Entity data with name, entity_type, summary, attributes",
                },
            },
            "required": ["entity_data"],
        }
    
    async def execute(self, entity_data: Dict[str, Any], **kwargs) -> ToolResult:
        try:
            if not entity_data.get("name"):
                return ToolResult(success=False, error="Entity name is required")
            if not entity_data.get("entity_type"):
                return ToolResult(success=False, error="Entity type is required")
            
            entity_id = await self.knowledge_store.insert_entity(entity_data)
            
            return ToolResult(
                success=True,
                data={"entity_id": entity_id, "entity": entity_data},
            )
        except Exception as e:
            return ToolResult(success=False, error=str(e))
