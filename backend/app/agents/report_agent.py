"""
ReportAgent - Generate strategic reports

Implements US-035 (refactored to use ITool)
"""

from typing import List, Dict, Any, Optional

from backend.interfaces.tool import ITool, ToolResult
from backend.interfaces.llm_provider import ILLMProvider


class ReportAgent:
    """
    Agent for generating strategic reports.
    
    Uses injected tools for knowledge access instead of Zep SDK.
    """
    
    def __init__(self, tools: List[ITool], llm_provider: ILLMProvider):
        """
        Initialize ReportAgent.
        
        Args:
            tools: List of ITool implementations
            llm_provider: LLM provider for report generation
        """
        self.tools = {t.name: t for t in tools}
        self.llm_provider = llm_provider
    
    async def generate(
        self,
        simulation_results: Dict[str, Any],
        report_style: str = "executive",
    ) -> str:
        """
        Generate a strategic report.
        
        Args:
            simulation_results: Results from simulation
            report_style: Style of report (executive/technical/narrative)
            
        Returns:
            Generated report text
        """
        # Gather context from tools
        context = await self._gather_context(simulation_results)
        
        # Generate report using LLM
        prompt = self._build_report_prompt(context, report_style)
        
        messages = [{"role": "user", "content": prompt}]
        response = await self.llm_provider.chat(messages)
        
        return response
    
    async def _gather_context(self, simulation_results: Dict[str, Any]) -> str:
        """Gather context from knowledge tools"""
        context_parts = []
        
        # Search for relevant information
        if "search" in self.tools:
            search_tool = self.tools["search"]
            result = await search_tool.execute(query="strategic decision business impact")
            if result.success:
                context_parts.append(f"Search results: {result.data}")
        
        return "\n\n".join(context_parts) if context_parts else "No context available"
    
    def _build_report_prompt(self, context: str, style: str) -> str:
        """Build prompt for report generation"""
        style_instructions = {
            "executive": "Provide a concise summary with key recommendations",
            "technical": "Provide detailed analysis with data supporting each point",
            "narrative": "Tell a story about the strategic situation and outcomes",
        }
        
        return f"""Generate a strategic report based on the following simulation results and context.

Context:
{context}

Style: {style_instructions.get(style, style_instructions['executive'])}

Include:
1. Executive Summary
2. Key Findings
3. Strategic Recommendations
4. Risk Assessment
5. Next Steps
"""
    
    async def chat(self, message: str, context: Dict[str, Any]) -> str:
        """
        Answer follow-up questions about the report.
        
        Args:
            message: User question
            context: Conversation context
            
        Returns:
            Response text
        """
        messages = [
            {"role": "system", "content": "You are a strategic advisor answering questions about simulation results."},
            {"role": "user", "content": message},
        ]
        
        return await self.llm_provider.chat(messages)
