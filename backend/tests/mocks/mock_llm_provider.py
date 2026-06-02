"""
MockLLMProvider - Mock implementation of ILLMProvider for testing

This mock can be configured to return specific responses or raise errors,
enabling deterministic testing of services that depend on LLM calls.
"""

from typing import List, Dict, Any, Optional
from backend.interfaces.llm_provider import ILLMProvider


class MockLLMProvider(ILLMProvider):
    """
    Mock implementation of ILLMProvider for testing.
    
    Features:
        - Configurable responses
        - Response sequence for multiple calls
        - Error injection
        - Call tracking
    
    Usage:
        mock = MockLLMProvider()
        mock.set_response("Hello, how can I help?")
        
        # Or for multiple calls
        mock.set_responses(["First response", "Second response"])
        
        # Track calls
        provider.chat(messages)
        assert len(provider.call_history) == 1
    """
    
    def __init__(self, model_name: str = "mock-model"):
        """
        Initialize mock LLM provider.
        
        Args:
            model_name: Model name to return from get_model_name()
        """
        self.model_name = model_name
        self._responses: List[str] = []
        self._response_index: int = 0
        self._should_error: bool = False
        self._error_message: str = "Mock LLM error"
        self._error_type: type = Exception
        
        # Track calls for assertions
        self.call_history: List[Dict[str, Any]] = []
    
    def set_response(self, response: str) -> None:
        """Set a single response for all calls"""
        self._responses = [response]
        self._response_index = 0
    
    def set_responses(self, responses: List[str]) -> None:
        """Set a sequence of responses for multiple calls"""
        self._responses = responses
        self._response_index = 0
    
    def set_error(self, error: bool = True, message: str = "Mock error", error_type: type = Exception) -> None:
        """Configure error injection"""
        self._should_error = error
        self._error_message = message
        self._error_type = error_type
    
    async def chat(
        self,
        messages: List[Dict[str, str]],
        **kwargs: Any
    ) -> str:
        """Send chat message (returns mock response)"""
        # Record call
        self.call_history.append({
            "method": "chat",
            "messages": messages,
            "kwargs": kwargs,
        })
        
        # Check for error
        if self._should_error:
            raise self._error_type(self._error_message)
        
        # Return configured response or default
        if self._responses:
            if self._response_index < len(self._responses):
                response = self._responses[self._response_index]
                self._response_index += 1
                return response
        
        return "Mock response"
    
    async def completion(
        self,
        prompt: str,
        **kwargs: Any
    ) -> str:
        """Generate completion (returns mock response)"""
        # Record call
        self.call_history.append({
            "method": "completion",
            "prompt": prompt,
            "kwargs": kwargs,
        })
        
        # Check for error
        if self._should_error:
            raise self._error_type(self._error_message)
        
        # Return configured response or default
        if self._responses:
            if self._response_index < len(self._responses):
                response = self._responses[self._response_index]
                self._response_index += 1
                return response
        
        return "Mock completion"
    
    def get_model_name(self) -> str:
        """Get model name"""
        return self.model_name
    
    def is_available(self) -> bool:
        """Check availability (always true for mock)"""
        return not self._should_error
    
    def reset(self) -> None:
        """Reset mock state"""
        self._responses = []
        self._response_index = 0
        self._should_error = False
        self.call_history.clear()
    
    def get_last_messages(self) -> Optional[List[Dict[str, str]]]:
        """Get messages from last chat call"""
        if self.call_history:
            last = self.call_history[-1]
            return last.get("messages")
        return None
    
    def get_last_prompt(self) -> Optional[str]:
        """Get prompt from last completion call"""
        if self.call_history:
            last = self.call_history[-1]
            if last["method"] == "completion":
                return last.get("prompt")
        return None
