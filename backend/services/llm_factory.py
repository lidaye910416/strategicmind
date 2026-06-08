"""
LLM Provider Factory.

Default: Ollama (local).
Override: set LLM_PROVIDER=ollama|bailian|minimax|mock in env.

Implements: US-002, US-004, US-005
"""
import os
from typing import Optional

from backend.interfaces.llm_provider import ILLMProvider


def _detect_provider_from_env() -> str:
    """Pick the provider based on which credentials are present in env.

    Priority: explicit override > MINIMAX_API_KEY > LLM_API_KEY (legacy
    bailian) > default ollama.
    """
    if os.environ.get("MINIMAX_API_KEY") or os.environ.get("MiniMax_API_KEY"):
        return "minimax"
    if os.environ.get("LLM_API_KEY"):
        return "bailian"
    return "ollama"


def create_llm_provider(provider_name: Optional[str] = None) -> ILLMProvider:
    """
    Create the configured LLM provider.

    Selection priority (highest first):
        1. Explicit argument
        2. STRATEGICMIND_LLM_OVERRIDE env var (test override)
        3. LLM_PROVIDER env var
        4. Auto-detect: MINIMAX_API_KEY -> minimax, LLM_API_KEY -> bailian,
           else ollama
    """
    # Test override takes highest priority (used by acceptance tests and
    # the StrategicMind demo: STRATEGICMIND_LLM_OVERRIDE is a fully
    # qualified class path like backend.tests.mocks.mock_llm_provider.MockLLMProvider)
    override = os.environ.get("STRATEGICMIND_LLM_OVERRIDE")
    if override and "." in override:
        import importlib
        mod_path, cls_name = override.rsplit(".", 1)
        mod = importlib.import_module(mod_path)
        cls = getattr(mod, cls_name)
        return cls()

    name = (provider_name or os.environ.get("LLM_PROVIDER") or _detect_provider_from_env()).lower()

    if name == "ollama":
        from backend.adapters.ollama_adapter import OllamaAdapter
        return OllamaAdapter()

    if name == "bailian":
        from backend.adapters.bailian_adapter import BailianAdapter
        return BailianAdapter(api_key=os.environ.get("LLM_API_KEY"))

    if name == "minimax":
        from backend.adapters.minimax_adapter import MiniMaxAdapter
        return MiniMaxAdapter()

    if name == "mock":
        from backend.tests.mocks.mock_llm_provider import MockLLMProvider
        return MockLLMProvider()

    raise ValueError(
        f"Unknown LLM provider: {name!r}. "
        f"Use one of: ollama, bailian, minimax, mock"
    )


def describe_provider(provider_name: Optional[str] = None) -> dict:
    """Return info about the active LLM provider (for /api/health)."""
    name = (provider_name or os.environ.get("LLM_PROVIDER")
            or os.environ.get("STRATEGICMIND_LLM_OVERRIDE")
            or _detect_provider_from_env()).lower()
    # If STRATEGICMIND_LLM_OVERRIDE points to a fully qualified class,
    # derive a friendly name from the class name
    if "." in name and name not in ("ollama", "bailian", "minimax", "mock"):
        cls = name.rsplit(".", 1)[-1]
        for known in ("OllamaAdapter", "BailianAdapter", "MiniMaxAdapter", "MockLLMProvider"):
            if known.lower() in cls.lower():
                name = known.lower().replace("adapter", "").replace("llmprovider", "").strip()
                if not name:
                    name = "mock"
                break
        else:
            name = cls.lower().replace("adapter", "").replace("llmprovider", "mock") or "custom"
    is_local = name == "ollama"
    requires_key = name in ("bailian", "minimax")
    info = {
        "provider": name,
        "is_local": is_local,
        "requires_api_key": requires_key,
    }
    if name == "ollama":
        info["base_url"] = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        info["model"] = os.environ.get("OLLAMA_MODEL", "gemma4:e2b")
    elif name == "bailian":
        info["model"] = os.environ.get("LLM_MODEL_NAME", "qwen-plus")
    elif name == "minimax":
        info["model"] = os.environ.get(
            "MiniMax_MODEL_NAME"
        ) or os.environ.get("LLM_MODEL_NAME", "MiniMax-M3")
        info["base_url"] = os.environ.get(
            "ANTHROPIC_BASE_URL", "https://api.minimaxi.com/anthropic"
        )
    return info
