"""
OllamaAdapter - ILLMProvider implementation for local Ollama server

This adapter wraps Ollama API calls through the ILLMProvider interface,
enabling local LLM inference with fallback capability.

Ollama runs quantized models locally (Qwen2.5-72B recommended for strategic reasoning).
"""

import httpx
from typing import List, Dict, Any, Optional

from ..interfaces.llm_provider import ILLMProvider


class LLMError(Exception):
    """Raised when an LLM adapter call fails."""
    pass


class OllamaAdapter(ILLMProvider):
    """
    Local Ollama server adapter implementing ILLMProvider.
    
    Configuration via environment:
        - OLLAMA_BASE_URL: Ollama server URL (default: http://localhost:11434)
        - OLLAMA_MODEL: Model name (default: qwen2.5:72b)
    
    Advantages:
        - Lower latency for local inference
        - No API costs
        - Data stays on-premise
        - Better for strategic reasoning tasks
    
    Usage:
        adapter = OllamaAdapter()
        response = await adapter.chat([{"role": "user", "content": "Hello"}])
    """
    
    def __init__(
        self,
        base_url: Optional[str] = None,
        model_name: Optional[str] = None,
        timeout: int = 180,
    ):
        """
        Initialize Ollama adapter.
        
        Args:
            base_url: Ollama server URL
            model_name: Model name (e.g., "qwen2.5:72b")
            timeout: Request timeout in seconds
        """
        import os
        
        self.base_url = base_url or os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        self.model_name = model_name or os.environ.get("OLLAMA_MODEL", "qwen2.5:72b")
        self.timeout = timeout
        
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client"""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
            )
        return self._client
    
    async def chat(
        self,
        messages: List[Dict[str, str]],
        **kwargs: Any
    ) -> str:
        """
        Send a chat conversation to Ollama API.
        
        Args:
            messages: List of message dicts with 'role' and 'content'
            **kwargs: Additional options (temperature, top_p, etc.)
            
        Returns:
            Model response as string
            
        Raises:
            LLMError: If API call fails
        """
        client = await self._get_client()
        
        payload = {
            "model": self.model_name,
            "messages": messages,
            "stream": False,
            **kwargs,
        }
        
        try:
            response = await client.post("/api/chat", json=payload)
            response.raise_for_status()
            
            result = response.json()
            return result["message"]["content"]
            
        except httpx.HTTPStatusError as e:
            raise LLMError(f"Ollama API error: {e.response.status_code}")
        except KeyError as e:
            raise LLMError(f"Ollama response parse error: {str(e)}")
        except Exception as e:
            raise LLMError(f"Ollama request failed: {str(e)}")
    
    async def completion(
        self,
        prompt: str,
        **kwargs: Any
    ) -> str:
        """
        Generate text completion from prompt using Ollama /api/generate.
        
        Args:
            prompt: Input prompt text
            **kwargs: Additional options
            
        Returns:
            Generated completion as string
        """
        client = await self._get_client()
        
        payload = {
            "model": self.model_name,
            "prompt": prompt,
            "stream": False,
            **kwargs,
        }
        
        try:
            response = await client.post("/api/generate", json=payload)
            response.raise_for_status()
            
            result = response.json()
            return result["response"]
            
        except httpx.HTTPStatusError as e:
            raise LLMError(f"Ollama API error: {e.response.status_code}")
        except Exception as e:
            raise LLMError(f"Ollama request failed: {str(e)}")
    
    def get_model_name(self) -> str:
        """Get the current model name"""
        return self.model_name
    
    def is_available(self) -> bool:
        """Check if Ollama server is reachable"""
        import asyncio
        
        async def _check():
            try:
                client = await self._get_client()
                response = await client.get("/api/tags", timeout=10)
                return response.status_code == 200
            except Exception:
                return False
        
        try:
            return asyncio.run(_check())
        except Exception:
            return False
    
    async def close(self) -> None:
        """Close the HTTP client"""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
