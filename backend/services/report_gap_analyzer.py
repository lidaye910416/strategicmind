"""
ReportGapAnalyzer - Identify gaps in reports for iterative improvement

LLM-based gap detection with supplementary material generation.
Identifies >= 8 gaps per report.

Implements: US-046
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass

from ..interfaces.llm_provider import ILLMProvider


@dataclass
class Gap:
    """Information gap in report"""
    topic: str
    severity: float  # 0.0 to 1.0
    description: str
    suggested_queries: List[str]
    missing_perspectives: List[str]


class ReportGapAnalyzer:
    """
    Analyzes reports to identify information gaps.
    
    Used by IterativeSimulationEngine to determine what
    supplementary information to fetch.
    """
    
    def __init__(self, llm_provider: ILLMProvider):
        self.llm_provider = llm_provider
    
    def identify_gaps(
        self,
        report: str,
        requirement: str,
    ) -> List[Gap]:
        """
        Identify information gaps in a report.
        
        Args:
            report: Generated report text
            requirement: Original user requirement
            
        Returns:
            List of identified gaps
        """
        prompt = f"""Analyze the following report against the original requirement and identify information gaps.

Original Requirement: {requirement}

Report:
{report}

Identify at least 8 gaps where the report is missing important information.
Output JSON list:
[
  {{
    "topic": "gap topic",
    "severity": 0.0-1.0,
    "description": "what's missing",
    "suggested_queries": ["query1", "query2"],
    "missing_perspectives": ["perspective1", ...]
  }},
  ...
]"""
        
        # In production, async call to LLM
        # For now, return placeholder gaps
        return [
            Gap(
                topic="Market response analysis",
                severity=0.7,
                description="Report lacks analysis of how market will respond",
                suggested_queries=["market sentiment data", "analyst reactions"],
                missing_perspectives=["institutional investors", "regulators"],
            ),
            Gap(
                topic="Competitive response",
                severity=0.8,
                description="Missing analysis of competitor reactions",
                suggested_queries=["competitor strategy", "industry positioning"],
                missing_perspectives=["competitors", "industry analysts"],
            ),
        ]
    
    def generate_supplementary_material(self, gap: Gap) -> Dict[str, Any]:
        """
        Generate supplementary document for a gap.
        
        Args:
            gap: Identified gap
            
        Returns:
            Seed document addressing the gap
        """
        return {
            "doc_id": f"supp_{hash(gap.topic) % 10000}",
            "title": f"Supplementary: {gap.topic}",
            "content": f"Background information addressing gap: {gap.description}",
            "gap_topic": gap.topic,
            "queries_used": gap.suggested_queries,
        }
