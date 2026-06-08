"""
MiniMaxAdapter - ILLMProvider implementation for MiniMax (M3) API

This adapter wraps the MiniMax M3 API. The endpoint accepts
the Anthropic Messages API format, so we use httpx directly rather
than the official Anthropic SDK to keep the dependency surface small.

Configuration via environment (any of these will work):
    - MINIMAX_API_KEY / MiniMax_API_KEY / LLM_API_KEY (any one)
    - ANTHROPIC_BASE_URL  (default: https://api.minimaxi.com/anthropic)
    - MiniMax_MODEL_NAME / LLM_MODEL_NAME (default: MiniMax-M3)

The class is drop-in compatible with BailianAdapter / OllamaAdapter and
can be selected via LLM_PROVIDER=minimax or MINIMAX_API_KEY env var.
"""

import os
import asyncio
import httpx
from typing import List, Dict, Any, Optional

from ..interfaces.llm_provider import ILLMProvider


class LLMError(Exception):
    """Base exception for LLM provider errors"""
    pass


def _resolve_api_key(explicit: Optional[str] = None) -> str:
    """Find the MiniMax API key from any of the supported env vars."""
    if explicit:
        return explicit
    for k in ("MINIMAX_API_KEY", "MiniMax_API_KEY", "ANTHROPIC_API_KEY", "LLM_API_KEY"):
        v = os.environ.get(k)
        if v:
            return v
    return ""


class MiniMaxAdapter(ILLMProvider):
    """
    MiniMax (M3) LLM provider via the Anthropic-compatible Messages API.

    Usage:
        adapter = MiniMaxAdapter()
        response = await adapter.chat([{"role": "user", "content": "Hello"}])
    """

    DEFAULT_BASE_URL = "https://api.minimaxi.com/anthropic"
    DEFAULT_MODEL = "MiniMax-M3"
    DEFAULT_TIMEOUT = 120
    ANTHROPIC_VERSION = "2023-06-01"

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model_name: Optional[str] = None,
        timeout: int = DEFAULT_TIMEOUT,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ):
        self.api_key = _resolve_api_key(api_key)
        self.base_url = (base_url or os.environ.get("ANTHROPIC_BASE_URL")
                         or self.DEFAULT_BASE_URL).rstrip("/")
        # Strip trailing /v1 if present; we add it per call to /v1/messages
        if self.base_url.endswith("/v1"):
            self.base_url = self.base_url[:-3]
        self.model_name = (
            model_name
            or os.environ.get("MiniMax_MODEL_NAME")
            or os.environ.get("LLM_MODEL_NAME")
            or self.DEFAULT_MODEL
        )
        self.timeout = timeout
        self.max_tokens = max_tokens
        self.temperature = temperature
        self._client: Optional[httpx.AsyncClient] = None
        self._client_loop: Optional[asyncio.AbstractEventLoop] = None

    async def _get_client(self) -> httpx.AsyncClient:
        # Recreate the client if it's bound to a different event loop
        # (happens when the orchestrator spawns a new thread for each
        # pipeline run, and we cache the client across runs).
        try:
            current_loop = asyncio.get_running_loop()
        except RuntimeError:
            current_loop = None
        if (
            self._client is None
            or self._client.is_closed
            or self._client_loop is not current_loop
        ):
            # Close old client if it exists (best-effort)
            if self._client is not None and not self._client.is_closed:
                try:
                    await self._client.aclose()
                except Exception:
                    pass
            self._client = httpx.AsyncClient(
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": self.ANTHROPIC_VERSION,
                    "Content-Type": "application/json",
                },
                timeout=self.timeout,
            )
            self._client_loop = current_loop
        return self._client

    @staticmethod
    def _messages_to_anthropic(messages: List[Dict[str, str]]) -> tuple:
        """Convert OpenAI-style messages to Anthropic (system + messages).

        Anthropic Messages API takes `system` as a top-level field and
        only allows `user` / `assistant` in the messages list. We pull out
        any `system` messages and concatenate them.
        """
        system_parts: List[str] = []
        out: List[Dict[str, Any]] = []
        for m in messages:
            role = m.get("role")
            content = m.get("content", "")
            if role == "system":
                system_parts.append(str(content))
            elif role in ("user", "assistant"):
                out.append({"role": role, "content": str(content)})
            else:
                # Unknown role - treat as user
                out.append({"role": "user", "content": str(content)})
        # Anthropic requires at least one user message; ensure that
        if not out:
            out.append({"role": "user", "content": ""})
        return ("\n\n".join(system_parts) if system_parts else None, out)

    @staticmethod
    def _extract_text(content: Any) -> str:
        """Anthropic returns content as a list of blocks.

        We concatenate any `text` blocks and skip `thinking` blocks.
        """
        if isinstance(content, str):
            return content
        if not isinstance(content, list):
            return str(content)
        parts: List[str] = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text" and block.get("text"):
                    parts.append(block["text"])
            elif isinstance(block, str):
                parts.append(block)
        return "".join(parts).strip()

    async def chat(
        self,
        messages: List[Dict[str, str]],
        **kwargs: Any,
    ) -> str:
        client = await self._get_client()
        system, convo = self._messages_to_anthropic(messages)
        payload: Dict[str, Any] = {
            "model": self.model_name,
            "max_tokens": kwargs.get("max_tokens", self.max_tokens),
            "messages": convo,
        }
        if system:
            payload["system"] = system
        if "temperature" in kwargs:
            payload["temperature"] = kwargs["temperature"]
        else:
            payload["temperature"] = self.temperature
        # Any extra params (top_p, stop_sequences, etc.) pass through
        for k, v in kwargs.items():
            if k not in payload and k != "max_tokens" and k != "temperature":
                payload[k] = v

        try:
            response = await client.post(
                f"{self.base_url}/v1/messages",
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            return self._extract_text(data.get("content", ""))
        except httpx.HTTPStatusError as e:
            body = ""
            try:
                body = e.response.text
            except Exception:
                pass
            raise LLMError(
                f"MiniMax API error: {e.response.status_code} - {body[:500]}"
            )
        except Exception as e:
            raise LLMError(f"MiniMax request failed: {e}")

    async def completion(
        self,
        prompt: str,
        **kwargs: Any,
    ) -> str:
        return await self.chat([{"role": "user", "content": prompt}], **kwargs)

    def get_model_name(self) -> str:
        return self.model_name

    def is_available(self) -> bool:
        """Synchronous check that the API key is configured.

        Note: MiniMax's Anthropic endpoint doesn't expose a cheap
        unauthenticated probe the way Ollama does, so we just check
        that an API key is set.
        """
        return bool(self.api_key)

    async def aclose(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
