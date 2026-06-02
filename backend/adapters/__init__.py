"""
Adapters module - Concrete implementations of abstract interfaces
"""
from .bailian_adapter import BailianAdapter
from .ollama_adapter import OllamaAdapter

__all__ = ['BailianAdapter', 'OllamaAdapter']
