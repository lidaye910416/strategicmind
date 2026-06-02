"""
Configuration management - WITHOUT Zep Cloud dependency

ZEP_API_KEY is now optional (only required when provider=zep).
With provider=local, no Zep configuration is needed.

Implements: US-024
"""

import os
from dataclasses import dataclass, field
from typing import Optional, List
from dotenv import load_dotenv


class Config:
    """Application configuration - reads env vars lazily for UPLOAD_FOLDER.

    Most fields are set at load time. UPLOAD_FOLDER is a property so tests
    and runtime code can override it via the UPLOAD_FOLDER env var without
    having to reload the entire module.
    """
    SECRET_KEY: str = "strategicmind-secret-key"
    DEBUG: bool = True
    
    # LLM Configuration
    LLM_API_KEY = None
    LLM_BASE_URL: str = "https://api.openai.com/v1"
    LLM_MODEL_NAME: str = "qwen-plus"
    
    # Graph Store Configuration (Zep is OPTIONAL)
    GRAPH_STORE_PROVIDER: str = "local"  # local or zep
    ZEP_API_KEY = None  # Only required when provider=zep
    
    # File Upload Configuration
    MAX_CONTENT_LENGTH: int = 50 * 1024 * 1024
    _UPLOAD_FOLDER_DEFAULT: str = "./uploads"
    ALLOWED_EXTENSIONS = ('pdf', 'md', 'txt', 'markdown')

    @property
    def UPLOAD_FOLDER(self) -> str:  # type: ignore[override]
        return os.environ.get("UPLOAD_FOLDER", self._UPLOAD_FOLDER_DEFAULT)

    @UPLOAD_FOLDER.setter
    def UPLOAD_FOLDER(self, value: str) -> None:
        self._UPLOAD_FOLDER_DEFAULT = value
    
    # Simulation Configuration
    SIMULATION_MAX_ROUNDS: int = 10
    SIMULATION_HOURS_PER_ROUND: int = 6
    SIMULATION_MAX_CONCURRENT: int = 30
    
    @classmethod
    def validate(cls) -> List[str]:
        """Validate required configuration. Zep is optional with provider=local."""
        errors: List[str] = []
        
        # LLM is always required
        if not cls.LLM_API_KEY:
            errors.append("LLM_API_KEY 未配置")
        
        # Zep is only required when using Zep provider
        if cls.GRAPH_STORE_PROVIDER == "zep" and not cls.ZEP_API_KEY:
            errors.append("ZEP_API_KEY required when provider=zep")
        
        return errors


# Load environment variables (NO Zep SDK required)
project_root_env = os.path.join(os.path.dirname(__file__), '../../.env')
if os.path.exists(project_root_env):
    load_dotenv(project_root_env, override=True)
else:
    load_dotenv(override=True)


def load_config() -> Config:
    """Load configuration from environment"""
    config = Config()
    config.SECRET_KEY = os.environ.get('SECRET_KEY', config.SECRET_KEY)
    config.DEBUG = os.environ.get('FLASK_DEBUG', 'True').lower() == 'true'
    config.LLM_API_KEY = os.environ.get('LLM_API_KEY')
    config.LLM_BASE_URL = os.environ.get('LLM_BASE_URL', config.LLM_BASE_URL)
    config.LLM_MODEL_NAME = os.environ.get('LLM_MODEL_NAME', config.LLM_MODEL_NAME)
    config.GRAPH_STORE_PROVIDER = os.environ.get('GRAPH_STORE_PROVIDER', 'local')
    config.ZEP_API_KEY = os.environ.get('ZEP_API_KEY')  # Optional
    # File upload directory (allow override for tests / non-default deploys)
    env_upload = os.environ.get('UPLOAD_FOLDER')
    if env_upload:
        config.UPLOAD_FOLDER = env_upload
    return config


# Global config instance
config = load_config()
