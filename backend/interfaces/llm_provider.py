"""
ILLMProvider interface - Abstract interface for LLM providers

This interface allows routing LLM calls to different providers:
    - Bailian (Alibaba Cloud)
    - Ollama (local)
    - MiniMax
    - OpenAI-compatible APIs

Replaces: Direct LLM API calls throughout the codebase
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional, Union


class ILLMProvider(ABC):
    """
    Abstract interface for LLM (Large Language Model) providers.
    
    Implementations:
        - BailianAdapter: Alibaba Cloud Bailian API
        - OllamaAdapter: Local Ollama server
        - MiniMaxAdapter: MiniMax API
        - OpenAIAdapter: OpenAI-compatible APIs
    
    Methods:
        chat: Send a chat conversation and get response
        completion: Generate text completion from prompt
        get_model_name: Get the current model name
    """
    
    @abstractmethod
    async def chat(
        self,
        messages: List[Dict[str, str]],
        **kwargs: Any
    ) -> str:
        """
        Send a chat conversation and get a response.
        
        Args:
            messages: List of message dicts with 'role' and 'content' keys
                     Example: [{"role": "user", "content": "Hello"}, ...]
            **kwargs: Additional provider-specific arguments
                     Common options:
                         - temperature: float (0.0-2.0)
                         - max_tokens: int
                         - top_p: float
                         - stream: bool
                         
        Returns:
            The model's response as a string
            
        Raises:
            LLMError: If the API call fails
        """
        ...
    
    @abstractmethod
    async def completion(
        self,
        prompt: str,
        **kwargs: Any
    ) -> str:
        """
        Generate a text completion from a prompt.
        
        Args:
            prompt: The input prompt text
            **kwargs: Additional provider-specific arguments
                     Common options:
                         - temperature: float (0.0-2.0)
                         - max_tokens: int
                         - top_p: float
                         
        Returns:
            The generated completion as a string
            
        Raises:
            LLMError: If the API call fails
        """
        ...
    
    @abstractmethod
    def get_model_name(self) -> str:
        """
        Get the name of the current model.
        
        Returns:
            Model name string (e.g., "qwen-plus", "qwen2.5:72b")
        """
        ...
    
    @abstractmethod
    def is_available(self) -> bool:
        """
        Check if the LLM provider is available/healthy.
        
        Returns:
            True if provider is reachable and ready, False otherwise
        """
        ...
