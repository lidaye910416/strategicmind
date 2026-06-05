"""
ServiceFactory - Factory for creating service instances with provider switching

This factory creates graph store and LLM provider instances based on configuration,
enabling provider selection without call sites knowing the underlying implementation.

Replaces: Direct instantiation of providers throughout the codebase
"""

from typing import Optional, Dict, Any

from ..interfaces.graph_store import IGraphStore
from ..interfaces.llm_provider import ILLMProvider
from ..interfaces.knowledge_store import IKnowledgeStore


class ServiceFactory:
    """
    Factory for creating service instances with dependency injection.
    
    The factory selects the appropriate adapter based on configuration:
        - Graph Store: local (nano-graphRAG) or zep (Zep Cloud)
        - LLM Provider: bailian, ollama, or minimax
    
    Usage:
        factory = ServiceFactory()
        
        # Create LLM provider
        llm = factory.create_llm_provider()
        
        # Create graph store
        graph_store = factory.create_graph_store()
        
        # Create knowledge store
        knowledge_store = factory.create_knowledge_store(llm_provider=llm)
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize factory with optional configuration.
        
        Args:
            config: Configuration dict. If None, loads from ConfigManager.
        """
        if config is None:
            from ..config.manager import config as global_config
            self.config = global_config
        else:
            self._config_obj = self._dict_to_config(config)
            self.config = self._config_obj
    
    def _dict_to_config(self, config: Dict[str, Any]) -> Any:
        """Convert config dict to ConfigManager-like object"""
        class ConfigDict:
            def __init__(self, d):
                for k, v in d.items():
                    setattr(self, k, type(v)(v) if not isinstance(v, dict) else ConfigDict(v))
        return ConfigDict(config)
    
    def create_llm_provider(self, provider: Optional[str] = None) -> ILLMProvider:
        """
        Create an LLM provider instance.
        
        Args:
            provider: Override provider selection. If None, uses config.
            
        Returns:
            ILLMProvider implementation instance
            
        Raises:
            ValueError: If provider is not supported
        """
        if provider is None:
            provider = self.config.llm.provider
        
        if provider == "bailian":
            from ..adapters.bailian_adapter import BailianAdapter
            return BailianAdapter(
                api_key=self.config.llm.api_key,
                base_url=self.config.llm.base_url,
                model_name=self.config.llm.model_name,
                timeout=self.config.llm.timeout,
            )
        elif provider == "ollama":
            from ..adapters.ollama_adapter import OllamaAdapter
            return OllamaAdapter(
                base_url=self.config.llm.base_url,
                model_name=self.config.llm.model_name,
                timeout=self.config.llm.timeout,
            )
        elif provider == "minimax":
            from ..adapters.minimax_adapter import MiniMaxAdapter
            return MiniMaxAdapter(
                api_key=self.config.llm.api_key,
                base_url=self.config.llm.base_url,
                model_name=self.config.llm.model_name,
                timeout=self.config.llm.timeout,
            )
        else:
            raise ValueError(f"Unsupported LLM provider: {provider}")
    
    def create_graph_store(self, provider: Optional[str] = None) -> IGraphStore:
        """
        Create a graph store instance.
        
        Args:
            provider: Override provider selection. If None, uses config.
            
        Returns:
            IGraphStore implementation instance
            
        Raises:
            ValueError: If provider is not supported
        """
        if provider is None:
            provider = self.config.graph_store.provider
        
        if provider == "local":
            from .local_graph_store import LocalGraphStore
            return LocalGraphStore(
                storage_path=self.config.graph_store.local_storage_path,
            )
        elif provider == "zep":
            # Placeholder for Zep adapter (future)
            raise NotImplementedError("Zep graph store not yet implemented")
        else:
            raise ValueError(f"Unsupported graph store provider: {provider}")
    
    def create_knowledge_store(
        self,
        llm_provider: Optional[ILLMProvider] = None,
        graph_store: Optional[IGraphStore] = None,
    ) -> IKnowledgeStore:
        """
        Create a knowledge store instance.
        
        Args:
            llm_provider: LLM provider for entity extraction (required for local)
            graph_store: Graph store for storage (optional, creates if not provided)
            
        Returns:
            IKnowledgeStore implementation instance
        """
        if graph_store is None:
            graph_store = self.create_graph_store()
        
        if llm_provider is None:
            llm_provider = self.create_llm_provider()
        
        from .local_knowledge_store import LocalKnowledgeStore
        return LocalKnowledgeStore(
            graph_store=graph_store,
            llm_provider=llm_provider,
        )
    
    @staticmethod
    def create_llm_provider_from_config(
        provider_type: str,
        **kwargs
    ) -> ILLMProvider:
        """
        Static method to create LLM provider from config dict.
        
        Useful for testing and direct instantiation.
        
        Args:
            provider_type: "bailian", "ollama", or "minimax"
            **kwargs: Provider-specific configuration
            
        Returns:
            ILLMProvider instance
        """
        if provider_type == "bailian":
            from ..adapters.bailian_adapter import BailianAdapter
            return BailianAdapter(**kwargs)
        elif provider_type == "ollama":
            from ..adapters.ollama_adapter import OllamaAdapter
            return OllamaAdapter(**kwargs)
        elif provider_type == "minimax":
            from ..adapters.minimax_adapter import MiniMaxAdapter
            return MiniMaxAdapter(**kwargs)
        else:
            raise ValueError(f"Unsupported provider: {provider_type}")
