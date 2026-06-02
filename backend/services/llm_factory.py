"""
LLM Provider Factory.

Default: Ollama (local).
Override: set LLM_PROVIDER=bailian|ollama|mock in env.

Implements: US-002, US-004, US-005
"""
import os
from typing import Optional

from backend.interfaces.llm_provider import ILLMProvider


def create_llm_provider(provider_name: Optional[str] = None) -> ILLMProvider:
    """
    Create the configured LLM provider.

    Selection priority (highest first):
        1. Explicit argument
        2. LLM_PROVIDER env var
        3. LLM_API_KEY env var present -> bailian (legacy)
        4. Default -> ollama (local)
    """
    name = (
        provider_name
        or os.environ.get("LLM_PROVIDER")
        or ("bailian" if os.environ.get("LLM_API_KEY") else "ollama")
    )
    name = name.lower()

    if name == "ollama":
        from backend.adapters.ollama_adapter import OllamaAdapter
        return OllamaAdapter()

    if name == "bailian":
        from backend.adapters.bailian_adapter import BailianAdapter
        return BailianAdapter(api_key=os.environ.get("LLM_API_KEY"))

    if name == "mock":
        from backend.tests.mocks.mock_llm_provider import MockLLMProvider
        return MockLLMProvider()

    raise ValueError(
        f"Unknown LLM provider: {name!r}. "
        f"Use one of: ollama, bailian, mock"
    )


def describe_provider(provider_name: Optional[str] = None) -> dict:
    """Return info about the active LLM provider (for /api/health)."""
    name = (
        provider_name
        or os.environ.get("LLM_PROVIDER")
        or ("bailian" if os.environ.get("LLM_API_KEY") else "ollama")
    ).lower()
    info = {
        "provider": name,
        "is_local": name == "ollama",
        "requires_api_key": name == "bailian",
    }
    if name == "ollama":
        info["base_url"] = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        info["model"] = os.environ.get("OLLAMA_MODEL", "qwen2.5:72b")
    elif name == "bailian":
        info["model"] = os.environ.get("LLM_MODEL_NAME", "qwen-plus")
    return info
