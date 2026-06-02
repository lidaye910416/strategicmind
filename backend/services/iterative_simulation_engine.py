"""
IterativeSimulationEngine - simulate-report-analysis-supplement loop

Runs iterations until convergence or max iterations reached.
Implements: US-044
"""

import asyncio
from typing import Dict, List, Any, Optional, Callable
from dataclasses import dataclass, field

from ..interfaces.llm_provider import ILLMProvider
from .simulation_runner import SimulationRunner
from .report_agent import ReportAgent
from .report_gap_analyzer import ReportGapAnalyzer
from ..interfaces.knowledge_store import IKnowledgeStore


@dataclass
class IterationResult:
    """Result of a single iteration"""
    iteration_num: int
    simulation_results: Dict[str, Any]
    report: str
    gaps: List[Dict[str, Any]] = field(default_factory=list)
    convergence_score: float = 0.0
    is_converged: bool = False


class IterativeSimulationEngine:
    """
    Engine for iterative simulation.
    
    Loop: simulate → report → identify_gaps → supplement → repeat
    """
    
    def __init__(
        self,
        simulation_runner: SimulationRunner,
        report_agent: ReportAgent,
        gap_analyzer: ReportGapAnalyzer,
        knowledge_store: IKnowledgeStore,
        config: Optional[Dict[str, Any]] = None,
    ):
        self.simulation_runner = simulation_runner
        self.report_agent = report_agent
        self.gap_analyzer = gap_analyzer
        self.knowledge_store = knowledge_store
        self.config = config or {}
        self.max_iterations = self.config.get("max_iterations", 5)
        self.convergence_threshold = self.config.get("convergence_threshold", 0.85)
    
    async def run(
        self,
        seed_documents: List[Dict[str, Any]],
        requirement: str,
        progress_callback: Optional[Callable] = None,
    ) -> List[IterationResult]:
        """
        Run iterative simulation loop.
        
        Args:
            seed_documents: Initial seed documents
            requirement: User's strategic requirement
            progress_callback: Optional progress callback
            
        Returns:
            List of iteration results
        """
        results: List[IterationResult] = []
        supplementary_docs = []
        
        for iteration in range(1, self.max_iterations + 1):
            # Step 1: Run simulation
            sim_results = await self.simulation_runner.start(
                run_id=f"iter_{iteration}",
                config={
                    "seed_documents": seed_documents + supplementary_docs,
                    "max_rounds": 5,
                }
            )
            
            # Step 2: Generate report
            report = await self.report_agent.generate(sim_results)
            
            # Step 3: Identify gaps
            gaps = self.gap_analyzer.identify_gaps(report, requirement)
            
            # Step 4: Calculate convergence
            if len(results) > 0:
                prev_report = results[-1].report
                convergence = self._calculate_convergence(prev_report, report)
            else:
                convergence = 0.0
            
            iteration_result = IterationResult(
                iteration_num=iteration,
                simulation_results=sim_results,
                report=report,
                gaps=gaps,
                convergence_score=convergence,
                is_converged=convergence >= self.convergence_threshold,
            )
            results.append(iteration_result)
            
            if progress_callback:
                progress_callback({
                    "iteration": iteration,
                    "convergence": convergence,
                    "gaps_count": len(gaps),
                })
            
            # Step 5: Check convergence
            if iteration_result.is_converged:
                break
            
            # Step 6: Generate supplementary documents for next iteration
            for gap in gaps[:3]:  # Top 3 gaps
                supp_doc = self.gap_analyzer.generate_supplementary_material(gap)
                supplementary_docs.append(supp_doc)
        
        return results
    
    def _calculate_convergence(self, prev_report: str, current_report: str) -> float:
        """Calculate convergence score between two reports"""
        # Simple text similarity (in production, use embeddings)
        prev_words = set(prev_report.lower().split())
        curr_words = set(current_report.lower().split())
        
        if not prev_words or not curr_words:
            return 0.0
        
        intersection = prev_words & curr_words
        union = prev_words | curr_words
        
        return len(intersection) / len(union) if union else 0.0
