"""
BailianAdapter - ILLMProvider implementation for Alibaba Cloud Bailian API

This adapter wraps Bailian API calls through the ILLMProvider interface,
enabling dependency injection and provider switching.

Bailian is an Alibaba Cloud LLM service compatible with OpenAI API format.
"""

import httpx
from typing import List, Dict, Any, Optional

from ..interfaces.llm_provider import ILLMProvider


class LLMError(Exception):
    """Base exception for LLM provider errors"""
    pass


class BailianAdapter(ILLMProvider):
    """
    Alibaba Cloud Bailian API adapter implementing ILLMProvider.
    
    Configuration via environment:
        - LLM_API_KEY: Bailian API key
        - LLM_BASE_URL: Bailian API base URL (default: https://dashscope.aliyuncs.com/compatible-mode/v1)
        - LLM_MODEL_NAME: Model name (default: qwen-plus)
    
    Usage:
        adapter = BailianAdapter()
        response = await adapter.chat([{"role": "user", "content": "Hello"}])
    """
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model_name: Optional[str] = None,
        timeout: int = 120,
    ):
        """
        Initialize Bailian adapter.
        
        Args:
            api_key: Bailian API key (reads from LLM_API_KEY if not provided)
            base_url: API base URL (defaults to Bailian compatible mode)
            model_name: Model name (default: qwen-plus)
            timeout: Request timeout in seconds
        """
        import os
        
        self.api_key = api_key or os.environ.get("LLM_API_KEY", "")
        self.base_url = base_url or os.environ.get(
            "LLM_BASE_URL", 
            "https://dashscope.aliyuncs.com/compatible-mode/v1"
        )
        self.model_name = model_name or os.environ.get("LLM_MODEL_NAME", "qwen-plus")
        self.timeout = timeout
        
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client"""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                timeout=self.timeout,
            )
        return self._client
    
    async def chat(
        self,
        messages: List[Dict[str, str]],
        **kwargs: Any
    ) -> str:
        """
        Send a chat conversation to Bailian API.
        
        Args:
            messages: List of message dicts with 'role' and 'content'
            **kwargs: Additional options (temperature, max_tokens, etc.)
            
        Returns:
            Model response as string
            
        Raises:
            LLMError: If API call fails
        """
        client = await self._get_client()
        
        payload = {
            "model": self.model_name,
            "messages": messages,
            **kwargs,
        }
        
        try:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                json=payload,
            )
            response.raise_for_status()
            
            result = response.json()
            return result["choices"][0]["message"]["content"]
            
        except httpx.HTTPStatusError as e:
            raise LLMError(f"Bailian API error: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            raise LLMError(f"Bailian request failed: {str(e)}")
    
    async def completion(
        self,
        prompt: str,
        **kwargs: Any
    ) -> str:
        """
        Generate text completion from prompt.
        
        Args:
            prompt: Input prompt text
            **kwargs: Additional options
            
        Returns:
            Generated completion as string
        """
        # Convert completion to chat format
        messages = [{"role": "user", "content": prompt}]
        return await self.chat(messages, **kwargs)
    
    def get_model_name(self) -> str:
        """Get the current model name"""
        return self.model_name
    
    def is_available(self) -> bool:
        """Check if Bailian API is reachable"""
        import asyncio
        
        async def _check():
            try:
                client = await self._get_client()
                response = await client.get(
                    f"{self.base_url}/models",
                    timeout=10,
                )
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
