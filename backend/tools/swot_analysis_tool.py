"""
SWOTAnalysisTool - Strategic assessment tool

Implements ITool for SWOT analysis.
"""

from typing import Dict, Any, List
from dataclasses import dataclass

from ..interfaces.tool import ITool, ToolResult
from ..interfaces.llm_provider import ILLMProvider


@dataclass
class SWOTResult:
    """SWOT analysis result"""
    strengths: List[str]
    weaknesses: List[str]
    opportunities: List[str]
    threats: List[str]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "strengths": self.strengths,
            "weaknesses": self.weaknesses,
            "opportunities": self.opportunities,
            "threats": self.threats,
        }


class SWOTAnalysisTool(ITool):
    """Tool for SWOT analysis"""
    
    def __init__(self, llm_provider: ILLMProvider):
        self.llm_provider = llm_provider
    
    @property
    def name(self) -> str:
        return "swot_analysis"
    
    @property
    def description(self) -> str:
        return "Perform SWOT (Strengths, Weaknesses, Opportunities, Threats) analysis for strategic decisions."
    
    async def execute(self, entity: Dict[str, Any], context: Dict[str, Any], **kwargs) -> ToolResult:
        """Execute SWOT analysis"""
        prompt = f"""Perform SWOT analysis for: {entity.get('name', 'Unknown')}

Entity info: {entity}
Context: {context}

Output JSON with:
{{
    "strengths": ["strength1", ...],
    "weaknesses": ["weakness1", ...],
    "opportunities": ["opportunity1", ...],
    "threats": ["threat1", ...]
}}"""
        
        messages = [{"role": "user", "content": prompt}]
        response = await self.llm_provider.chat(messages)
        
        # Parse response
        import json
        import re
        
        json_match = re.search(r'\{.*\}', response, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group())
            result = SWOTResult(**data)
            return ToolResult(success=True, data=result.to_dict())
        
        return ToolResult(success=False, error="Failed to parse SWOT analysis")
