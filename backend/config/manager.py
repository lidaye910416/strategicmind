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


# ---------------------------------------------------------------------------
# Loop Engine v2 (T0.3) — env-driven feature flags
#
# These are intentionally re-read on every call so monkeypatch.setenv() in
# tests is honoured without having to re-instantiate the ConfigManager.
# The plumbing is observability + a switch the orchestrator can branch on
# later (T1.9); we don't change runtime behaviour here.
# ---------------------------------------------------------------------------

_LOOP_ENGINE_V2_ENV = "STRATEGICMIND_LOOP_ENGINE_V2"
_COSMIC_GRAPH_ENV = "STRATEGICMIND_COSMIC_GRAPH"


@dataclass
class FeatureFlags:
    """Snapshot of the current Loop Engine v2 / Cosmic Graph flags."""

    loop_engine_v2: bool = False
    cosmic_graph: bool = False


_TRUTHY_STRINGS = frozenset({"1", "true", "yes", "on"})
_FALSY_STRINGS = frozenset({"0", "false", "no", "off"})


def parse_bool(value, default: bool = False) -> bool:
    """Coerce a value to bool using a strict, explicit rule set.

    - ``None`` (e.g. env var unset) returns ``default``.
    - Non-string values return ``bool(value)`` (e.g. ``True``/``False``/numbers).
    - Strings are ``strip().lower()``-normalised first.
    - Strings in ``{"1", "true", "yes", "on"}`` return ``True``.
    - Strings in ``{"0", "false", "no", "off"}`` return ``False``.
    - Any other string (including empty string) returns ``default``.

    Public, module-level function intended to be imported by other modules:
        from backend.config.manager import parse_bool
    """
    if value is None:
        return default
    if not isinstance(value, str):
        return bool(value)
    normalized = value.strip().lower()
    if normalized in _TRUTHY_STRINGS:
        return True
    if normalized in _FALSY_STRINGS:
        return False
    return default


# Backward-compatible alias for existing internal callers.
_parse_bool = parse_bool


def feature_flags() -> FeatureFlags:
    """Read both env vars fresh and return a :class:`FeatureFlags`."""
    return FeatureFlags(
        loop_engine_v2=_parse_bool(os.environ.get(_LOOP_ENGINE_V2_ENV)),
        cosmic_graph=_parse_bool(os.environ.get(_COSMIC_GRAPH_ENV)),
    )


def is_loop_engine_v2_enabled() -> bool:
    return feature_flags().loop_engine_v2


def is_cosmic_graph_enabled() -> bool:
    return feature_flags().cosmic_graph


# Alias used by N4 doc unification — both ``feature_flags()`` and
# ``get_feature_flags()`` return a fresh snapshot so monkeypatch.setenv
# in tests is honoured.
def get_feature_flags() -> FeatureFlags:
    return feature_flags()


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
        # Loop Engine v2 (T0.3) — read env at construction time so callers
        # that snapshot config.feature_flags see the value at init.
        # Per-call helpers above (feature_flags() / is_*_enabled) re-read
        # the env so monkeypatch.setenv in tests is honoured.
        self.feature_flags = feature_flags()

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
