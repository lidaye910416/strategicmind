"""
PorterFiveForcesTool - Industry analysis tool

Implements ITool for Porter's Five Forces analysis.
"""

from typing import Dict, Any, List
from dataclasses import dataclass

from ..interfaces.tool import ITool, ToolResult
from ..interfaces.llm_provider import ILLMProvider


@dataclass
class PorterForcesResult:
    """Porter's Five Forces analysis result"""
    threat_of_new_entrants: float  # 0-1 (low to high threat)
    bargaining_power_of_buyers: float
    bargaining_power_of_suppliers: float
    threat_of_substitutes: float
    industry_rivalry: float
    analysis: str
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "threat_of_new_entrants": self.threat_of_new_entrants,
            "bargaining_power_of_buyers": self.bargaining_power_of_buyers,
            "bargaining_power_of_suppliers": self.bargaining_power_of_suppliers,
            "threat_of_substitutes": self.threat_of_substitutes,
            "industry_rivalry": self.industry_rivalry,
            "analysis": self.analysis,
        }


class PorterForcesTool(ITool):
    """Tool for Porter's Five Forces analysis"""
    
    def __init__(self, llm_provider: ILLMProvider):
        self.llm_provider = llm_provider
    
    @property
    def name(self) -> str:
        return "porter_forces"
    
    @property
    def description(self) -> str:
        return "Analyze industry structure using Porter's Five Forces framework."
    
    async def execute(self, industry: str, context: Dict[str, Any], **kwargs) -> ToolResult:
        """Execute Porter's Five Forces analysis"""
        prompt = f"""Analyze {industry} using Porter's Five Forces.

Context: {context}

Output JSON with scores (0-1) and analysis:
{{
    "threat_of_new_entrants": 0.0-1.0,
    "bargaining_power_of_buyers": 0.0-1.0,
    "bargaining_power_of_suppliers": 0.0-1.0,
    "threat_of_substitutes": 0.0-1.0,
    "industry_rivalry": 0.0-1.0,
    "analysis": "Summary of findings"
}}"""
        
        messages = [{"role": "user", "content": prompt}]
        response = await self.llm_provider.chat(messages)
        
        import json
        import re
        
        json_match = re.search(r'\{.*\}', response, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group())
            result = PorterForcesResult(**data)
            return ToolResult(success=True, data=result.to_dict())
        
        return ToolResult(success=False, error="Failed to parse analysis")
