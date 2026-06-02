"""
ConfigManager - Centralized configuration management

This module centralizes all configuration loading so that configuration
is loaded once and injected into services, replacing scattered os.environ.get calls.

Replaces: Multiple load_dotenv calls throughout the codebase
"""

import os
from dataclasses import dataclass, field
from typing import Optional, List
from dotenv import load_dotenv


@dataclass
class LLMConfig:
    """LLM provider configuration"""
    provider: str = "bailian"  # bailian, ollama, minimax
    api_key: Optional[str] = None
    base_url: str = "https://api.openai.com/v1"
    model_name: str = "qwen-plus"
    temperature: float = 0.7
    max_tokens: int = 4096
    timeout: int = 120


@dataclass
class GraphStoreConfig:
    """Graph storage configuration"""
    provider: str = "local"  # local (nano-graphRAG), zep
    zep_api_key: Optional[str] = None
    zep_url: Optional[str] = None
    local_storage_path: str = "./data/knowledge_graphs"


@dataclass
class SimulationConfig:
    """Simulation configuration"""
    default_max_rounds: int = 10
    simulated_hours_per_round: int = 6
    max_concurrent_agents: int = 30
    default_simulation_hours: int = 72


@dataclass 
class FlaskConfig:
    """Flask application configuration"""
    secret_key: str = "strategicmind-secret-key"
    debug: bool = True
    max_content_length: int = 50 * 1024 * 1024  # 50MB
    upload_folder: str = "./uploads"


@dataclass
class ConfigManager:
    """
    Centralized configuration manager.
    
    Loads configuration once on init and provides typed access to all config values.
    No repeated load_dotenv calls needed.
    
    Usage:
        config = ConfigManager()
        llm_config = config.llm
        graph_config = config.graph_store
        
        # Access specific values
        model_name = config.get("llm.model_name")
    """
    
    _instance: Optional['ConfigManager'] = None
    _initialized: bool = False
    
    def __new__(cls):
        """Singleton pattern for config manager"""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self, env_path: Optional[str] = None):
        """Initialize configuration manager"""
        if self._initialized:
            return
            
        # Load .env file if it exists
        if env_path is None:
            # Try to find .env in common locations
            possible_paths = [
                os.path.join(os.getcwd(), '.env'),
                os.path.join(os.path.dirname(__file__), '../../.env'),
                os.path.join(os.path.dirname(__file__), '../../../.env'),
            ]
            for path in possible_paths:
                if os.path.exists(path):
                    env_path = path
                    break
        
        if env_path and os.path.exists(env_path):
            load_dotenv(env_path, override=True)
        else:
            load_dotenv(override=True)
        
        # Initialize configuration objects
        self._load_llm_config()
        self._load_graph_store_config()
        self._load_simulation_config()
        self._load_flask_config()
        
        self._initialized = True
    
    def _load_llm_config(self) -> None:
        """Load LLM configuration from environment"""
        self.llm = LLMConfig(
            provider=os.environ.get("LLM_PROVIDER", "bailian"),
            api_key=os.environ.get("LLM_API_KEY"),
            base_url=os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1"),
            model_name=os.environ.get("LLM_MODEL_NAME", "qwen-plus"),
            temperature=float(os.environ.get("LLM_TEMPERATURE", "0.7")),
            max_tokens=int(os.environ.get("LLM_MAX_TOKENS", "4096")),
            timeout=int(os.environ.get("LLM_TIMEOUT", "120")),
        )
    
    def _load_graph_store_config(self) -> None:
        """Load graph store configuration from environment"""
        self.graph_store = GraphStoreConfig(
            provider=os.environ.get("GRAPH_STORE_PROVIDER", "local"),
            zep_api_key=os.environ.get("ZEP_API_KEY"),
            zep_url=os.environ.get("ZEP_URL"),
            local_storage_path=os.environ.get("LOCAL_GRAPH_PATH", "./data/knowledge_graphs"),
        )
    
    def _load_simulation_config(self) -> None:
        """Load simulation configuration from environment"""
        self.simulation = SimulationConfig(
            default_max_rounds=int(os.environ.get("SIMULATION_MAX_ROUNDS", "10")),
            simulated_hours_per_round=int(os.environ.get("SIMULATION_HOURS_PER_ROUND", "6")),
            max_concurrent_agents=int(os.environ.get("SIMULATION_MAX_CONCURRENT", "30")),
            default_simulation_hours=int(os.environ.get("SIMULATION_DEFAULT_HOURS", "72")),
        )
    
    def _load_flask_config(self) -> None:
        """Load Flask configuration from environment"""
        self.flask = FlaskConfig(
            secret_key=os.environ.get("SECRET_KEY", "strategicmind-secret-key"),
            debug=os.environ.get("FLASK_DEBUG", "True").lower() == "true",
            max_content_length=int(os.environ.get("MAX_CONTENT_LENGTH", str(50 * 1024 * 1024))),
            upload_folder=os.path.join(os.path.dirname(__file__), '../../uploads'),
        )
    
    def get(self, key: str, default: Optional[str] = None) -> Optional[str]:
        """
        Get a raw environment variable by dot-notation key.
        
        Args:
            key: Dot-notation key (e.g., "llm.model_name")
            default: Default value if not found
            
        Returns:
            Environment variable value or default
        """
        return os.environ.get(key, default)
    
    def validate(self) -> List[str]:
        """
        Validate required configuration values.
        
        Returns:
            List of validation error messages (empty if valid)
        """
        errors = []
        
        # Check LLM config
        if not self.llm.api_key and self.llm.provider == "bailian":
            errors.append("LLM_API_KEY is required for Bailian provider")
        
        # Graph store is optional when using local provider
        if self.graph_store.provider == "zep" and not self.graph_store.zep_api_key:
            errors.append("ZEP_API_KEY is required for Zep provider")
        
        return errors
    
    @classmethod
    def reset(cls) -> None:
        """Reset the singleton instance (useful for testing)"""
        cls._instance = None
        cls._initialized = False


# Global config instance
config = ConfigManager()
