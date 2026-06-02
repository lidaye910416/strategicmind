"""
Interfaces module - Abstract interfaces for pluggable components
"""
from .graph_store import IGraphStore
from .llm_provider import ILLMProvider
from .knowledge_store import IKnowledgeStore
from .simulation_backend import ISimulationBackend
from .tool import ITool, ToolResult

__all__ = [
    'IGraphStore',
    'ILLMProvider', 
    'IKnowledgeStore',
    'ISimulationBackend',
    'ITool',
    'ToolResult',
]
