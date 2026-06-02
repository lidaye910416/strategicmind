"""
SimulationComparator - Compare simulation reports across rounds

Computes similarity scores, key differences, and convergence.

Implements: US-047
"""

from typing import Dict, List, Any
from dataclasses import dataclass


@dataclass
class ComparisonResult:
    """Result of comparing multiple simulation reports"""
    similarity_scores: List[float]  # Between consecutive reports
    key_differences: List[str]
    trend_summary: str
    convergence_score: float  # 0.0 to 1.0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "similarity_scores": self.similarity_scores,
            "key_differences": self.key_differences,
            "trend_summary": self.trend_summary,
            "convergence_score": self.convergence_score,
        }


class SimulationComparator:
    """
    Compares simulation reports across multiple rounds.
    
    Uses embedding cosine similarity for comparing reports.
    """
    
    def compare(self, reports: List[str]) -> ComparisonResult:
        """
        Compare multiple simulation reports.
        
        Args:
            reports: List of report texts (in chronological order)
            
        Returns:
            ComparisonResult with analysis
        """
        if len(reports) < 2:
            return ComparisonResult(
                similarity_scores=[1.0],
                key_differences=[],
                trend_summary="Insufficient data for comparison",
                convergence_score=1.0 if reports else 0.0,
            )
        
        similarity_scores = []
        for i in range(1, len(reports)):
            sim = self._calculate_similarity(reports[i-1], reports[i])
            similarity_scores.append(sim)
        
        # Find key differences
        key_differences = self._find_differences(reports)
        
        # Calculate overall convergence
        convergence_score = sum(similarity_scores) / len(similarity_scores) if similarity_scores else 0.0
        
        # Generate trend summary
        trend = self._summarize_trend(similarity_scores)
        
        return ComparisonResult(
            similarity_scores=similarity_scores,
            key_differences=key_differences,
            trend_summary=trend,
            convergence_score=convergence_score,
        )
    
    def _calculate_similarity(self, text1: str, text2: str) -> float:
        """Calculate similarity between two texts (Jaccard for now)"""
        words1 = set(text1.lower().split())
        words2 = set(text2.lower().split())
        
        if not words1 or not words2:
            return 0.0
        
        intersection = words1 & words2
        union = words1 | words2
        
        return len(intersection) / len(union) if union else 0.0
    
    def _find_differences(self, reports: List[str]) -> List[str]:
        """Find key differences between reports"""
        if len(reports) < 2:
            return []
        
        # Compare last two reports
        words_last = set(reports[-1].lower().split())
        words_prev = set(reports[-2].lower().split())
        
        new_topics = words_last - words_prev
        return [f"New topic emerged: {topic}" for topic in list(new_topics)[:5]]
    
    def _summarize_trend(self, similarity_scores: List[float]) -> str:
        """Summarize the trend in similarities"""
        if not similarity_scores:
            return "No trend data"
        
        avg = sum(similarity_scores) / len(similarity_scores)
        
        if avg >= 0.85:
            return "Reports are converging - simulation is stabilizing"
        elif avg >= 0.6:
            return "Moderate changes between rounds - some convergence"
        else:
            return "High variability - significant changes between rounds"
