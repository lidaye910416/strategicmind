"""
Provider API - LLM provider switching and introspection.

Endpoints:
    GET  /api/provider/current   - active provider info (model, base_url, local?)
    GET  /api/provider/options   - list of all supported providers with availability
    POST /api/provider/switch    - hot-swap the in-process LLM provider
                                    body: {"provider": "ollama|bailian|minimax"}

The hot-swap mutates the singleton PipelineOrchestrator's `llm_provider`
attribute. Subsequent pipeline runs use the new provider. The change is
NOT persisted to a config file: restart of the backend reverts to
whatever LLM_PROVIDER/MINIMAX_API_KEY/LLM_API_KEY env vars dictate.

If a per-request STRATEGICMIND_LLM_OVERRIDE was set, switch is rejected
(test override has higher priority).
"""

import os
import threading
from flask import Blueprint, request, jsonify

from backend.services.llm_factory import create_llm_provider, describe_provider
from backend.interfaces.llm_provider import ILLMProvider

provider_bp = Blueprint("provider", __name__, url_prefix="/api/provider")

# Per-process state for the runtime switch
_lock = threading.Lock()
_active_provider: str | None = None  # last user-selected provider name


# ---------- Helpers ----------

def _provider_available(name: str) -> dict:
    """Return availability info for a given provider name."""
    name = name.lower()
    if name == "ollama":
        base = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        # Quick reachability probe - we don't fail if it returns 404,
        # only if connection refused
        reachable = True
        try:
            import httpx
            httpx.get(f"{base}/api/tags", timeout=1.0)
        except Exception:
            reachable = False
        return {
            "provider": name,
            "available": reachable,
            "is_local": True,
            "requires_api_key": False,
            "model": os.environ.get("OLLAMA_MODEL", "gemma4:e2b"),
            "base_url": base,
            "label": "Ollama (本地)",
            "description": "本地推理，无需 API key。需先启动 ollama serve。",
        }
    if name == "bailian":
        has_key = bool(os.environ.get("LLM_API_KEY"))
        return {
            "provider": name,
            "available": has_key,
            "is_local": False,
            "requires_api_key": True,
            "model": os.environ.get("LLM_MODEL_NAME", "qwen-plus"),
            "base_url": os.environ.get(
                "LLM_BASE_URL",
                "https://dashscope.aliyuncs.com/compatible-mode/v1",
            ),
            "label": "阿里云百炼 (Bailian)",
            "description": "阿里云 DashScope 兼容 OpenAI 格式。需设置 LLM_API_KEY。",
        }
    if name == "minimax":
        # Resolve from any of the supported key env vars
        has_key = any(
            os.environ.get(k)
            for k in ("MINIMAX_API_KEY", "MiniMax_API_KEY",
                      "ANTHROPIC_API_KEY", "LLM_API_KEY")
        )
        return {
            "provider": name,
            "available": has_key,
            "is_local": False,
            "requires_api_key": True,
            "model": os.environ.get(
                "MiniMax_MODEL_NAME"
            ) or os.environ.get("LLM_MODEL_NAME", "MiniMax-M3-highspeed"),
            "base_url": os.environ.get(
                "ANTHROPIC_BASE_URL", "https://api.minimaxi.com/anthropic"
            ),
            "label": "MiniMax M3 highspeed",
            "description": "MiniMax M3 highspeed 模型，Anthropic Messages API 兼容。",
        }
    if name == "mock":
        return {
            "provider": name,
            "available": True,
            "is_local": True,
            "requires_api_key": False,
            "model": "MockLLMProvider",
            "base_url": "(in-process)",
            "label": "Mock (测试用)",
            "description": "返回预设响应的 mock provider，仅用于测试。",
        }
    return {
        "provider": name,
        "available": False,
        "is_local": False,
        "requires_api_key": False,
        "model": "?",
        "base_url": "?",
        "label": name,
        "description": "未知 provider",
    }


def _get_active_provider() -> str:
    """Return the active provider name (runtime override > env auto-detect)."""
    if _active_provider:
        return _active_provider
    return describe_provider().get("provider", "ollama")


# ---------- Endpoints ----------

@provider_bp.route("/current", methods=["GET"])
def get_current():
    """Active provider info, queried from the live adapter if available."""
    active = _get_active_provider()
    # Prefer the live orchestrator's adapter for the most accurate info
    info: dict
    try:
        from backend.app.api.pipeline import get_orchestrator
        orch = get_orchestrator()
        if orch is not None and orch.llm_provider is not None:
            adapter = orch.llm_provider
            info = {
                "provider": active,
                "is_local": active == "ollama",
                "requires_api_key": active in ("bailian", "minimax"),
                "model": getattr(adapter, "model_name", None)
                    or getattr(adapter, "model", ""),
                "base_url": getattr(adapter, "base_url", ""),
            }
            return jsonify(info)
    except Exception:
        pass
    # Fall back to env-driven describe_provider
    info = describe_provider()
    info["provider"] = active
    return jsonify(info)


@provider_bp.route("/options", methods=["GET"])
def list_options():
    """All supported providers with availability flags."""
    return jsonify({
        "current": _get_active_provider(),
        "options": [_provider_available(n) for n in ("ollama", "minimax", "bailian", "mock")],
    })


@provider_bp.route("/switch", methods=["POST"])
def switch_provider():
    """Hot-swap the in-process LLM provider.

    Mutates the singleton orchestrator's llm_provider attribute so
    the next pipeline run uses the new provider.
    """
    if os.environ.get("STRATEGICMIND_LLM_OVERRIDE"):
        return jsonify({
            "error": "STRATEGICMIND_LLM_OVERRIDE is set; runtime switch is disabled."
        }), 400

    body = request.get_json() or {}
    name = (body.get("provider") or "").lower().strip()
    if not name:
        return jsonify({"error": "Missing 'provider' in body"}), 400

    avail = _provider_available(name)
    if not avail["available"]:
        return jsonify({
            "error": f"Provider '{name}' is not configured",
            "hint": avail.get("description", ""),
            "missing": "API key" if avail.get("requires_api_key") else "service unreachable",
        }), 400

    try:
        new_provider: ILLMProvider = create_llm_provider(name)
    except Exception as e:
        return jsonify({"error": f"Failed to create provider: {e}"}), 500

    # Mutate the singleton orchestrator (created lazily on first use)
    with _lock:
        from backend.app.api.pipeline import get_orchestrator
        orch = get_orchestrator()
        # Replace the attribute. The orchestrator passes self.llm_provider
        # into EntityExtractor / LocalKnowledgeStore / ReportAgent on
        # each call (we re-construct these per stage) so swapping here
        # takes effect on the NEXT stage invocation, not retroactively.
        orch.llm_provider = new_provider
        global _active_provider
        _active_provider = name

    return jsonify({
        "ok": True,
        "provider": name,
        "model": avail["model"],
        "base_url": avail.get("base_url", ""),
        "message": f"已切换到 {avail['label']}。下一次推演生效。",
    })


@provider_bp.route("/reset", methods=["POST"])
def reset_provider():
    """Reset to env-driven auto-detection (drop runtime override)."""
    if os.environ.get("STRATEGICMIND_LLM_OVERRIDE"):
        return jsonify({
            "error": "STRATEGICMIND_LLM_OVERRIDE is set; runtime reset is disabled."
        }), 400

    with _lock:
        from backend.app.api.pipeline import get_orchestrator
        orch = get_orchestrator()
        # Re-create from env (auto-detect)
        new_provider = create_llm_provider()
        orch.llm_provider = new_provider
        global _active_provider
        _active_provider = None

    info = describe_provider()
    return jsonify({
        "ok": True,
        "provider": info.get("provider"),
        "model": info.get("model", ""),
        "message": "已重置为环境变量自动检测。",
    })
