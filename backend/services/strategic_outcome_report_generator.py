"""
StrategicOutcomeReportGenerator - Final output with belief evolution and projections

Following the prior-art's report structure with strategic additions.

Implements: US-099
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
from datetime import datetime

from .business_metrics_tracker import BusinessMetrics
from .sentiment_tracker import SentimentTracker


@dataclass
class StrategicOutcomeReport:
    """Final strategic outcome report"""
    title: str
    executive_summary: str
    strategic_actions_timeline: List[Dict[str, Any]] = field(default_factory=list)
    belief_evolution: Dict[str, List[float]] = field(default_factory=dict)
    business_metrics_projection: List[Dict[str, Any]] = field(default_factory=list)
    key_insights: List[str] = field(default_factory=list)
    strategic_recommendations: List[Dict[str, Any]] = field(default_factory=list)
    generated_at: str = field(default_factory=lambda: datetime.now().isoformat())
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "executive_summary": self.executive_summary,
            "strategic_actions_timeline": self.strategic_actions_timeline,
            "belief_evolution": self.belief_evolution,
            "business_metrics_projection": self.business_metrics_projection,
            "key_insights": self.key_insights,
            "strategic_recommendations": self.strategic_recommendations,
            "generated_at": self.generated_at,
        }


class StrategicOutcomeReportGenerator:
    """
    Generates final strategic outcome reports with belief evolution
    and business projections.
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
    
    def generate(
        self,
        simulation_results: Dict[str, Any],
        metrics_history: Optional[List[BusinessMetrics]] = None,
        sentiment_tracker: Optional[SentimentTracker] = None,
    ) -> StrategicOutcomeReport:
        """
        Generate strategic outcome report.
        
        Args:
            simulation_results: Results from simulation
            metrics_history: Business metrics history
            sentiment_tracker: Sentiment tracker
            
        Returns:
            StrategicOutcomeReport
        """
        # Extract timeline
        timeline = self._extract_timeline(simulation_results)
        
        # Extract belief evolution
        belief_evolution = self._extract_belief_evolution(simulation_results)
        
        # Project business metrics
        projections = self._project_metrics(metrics_history)
        
        # Generate insights
        insights = self._generate_insights(simulation_results, metrics_history, sentiment_tracker)
        
        # Generate recommendations
        recommendations = self._generate_recommendations(simulation_results, insights)
        
        # Executive summary
        exec_summary = self._generate_executive_summary(
            simulation_results, insights, projections
        )
        
        return StrategicOutcomeReport(
            title="Strategic Outcome Report",
            executive_summary=exec_summary,
            strategic_actions_timeline=timeline,
            belief_evolution=belief_evolution,
            business_metrics_projection=projections,
            key_insights=insights,
            strategic_recommendations=recommendations,
        )
    
    def _extract_timeline(self, results: Dict) -> List[Dict[str, Any]]:
        """Extract timeline of strategic actions"""
        timeline = []
        for round_data in results.get("round_results", []):
            for action in round_data.get("actions", []):
                if isinstance(action, dict):
                    timeline.append({
                        "round": round_data.get("round_num"),
                        "actor": action.get("actor_id"),
                        "action_type": action.get("action_type"),
                        "description": action.get("public_description", "")[:200],
                    })
        return timeline[:20]  # Limit to 20 most recent
    
    def _extract_belief_evolution(self, results: Dict) -> Dict[str, List[float]]:
        """Extract belief evolution by topic"""
        evolution = {}
        
        # Simplified - in production, extract from belief engine history
        rounds = results.get("round_results", [])
        for topic in ["market_outlook", "regulatory_environment", "competitive_position"]:
            evolution[topic] = [
                round_data.get(f"avg_{topic}", 0.0)
                for round_data in rounds
            ]
        
        return evolution
    
    def _project_metrics(
        self,
        history: Optional[List[BusinessMetrics]],
    ) -> List[Dict[str, Any]]:
        """Project future metrics"""
        if not history:
            return []
        
        # Simple linear projection
        last = history[-1]
        projections = []
        
        for year in range(1, 4):
            projections.append({
                "year": year,
                "revenue_outlook": last.revenue_outlook * (1 - 0.1 * year),
                "profit_margin_outlook": last.profit_margin_outlook * (1 - 0.05 * year),
                "market_sentiment": last.market_sentiment * (1 - 0.08 * year),
                "competitive_position": last.competitive_position,
            })
        
        return projections
    
    def _generate_insights(
        self,
        sim_results: Dict,
        metrics_history: Optional[List[BusinessMetrics]],
        sentiment_tracker: Optional[SentimentTracker],
    ) -> List[str]:
        """Generate key insights"""
        insights = []
        
        num_rounds = len(sim_results.get("round_results", []))
        insights.append(f"Simulation completed {num_rounds} rounds of strategic interaction")
        
        if metrics_history and len(metrics_history) > 1:
            first = metrics_history[0]
            last = metrics_history[-1]
            if last.revenue_outlook > first.revenue_outlook:
                insights.append("Revenue outlook improved during simulation")
            elif last.revenue_outlook < first.revenue_outlook:
                insights.append("Revenue outlook declined during simulation")
        
        if sentiment_tracker:
            current = sentiment_tracker.get_current_sentiment()
            if current:
                if current.score > 0.3:
                    insights.append("Public sentiment trending positive")
                elif current.score < -0.3:
                    insights.append("Public sentiment negative - intervention recommended")
        
        return insights
    
    def _generate_recommendations(
        self,
        sim_results: Dict,
        insights: List[str],
    ) -> List[Dict[str, Any]]:
        """Generate strategic recommendations"""
        recommendations = []
        
        for insight in insights:
            if "improved" in insight.lower():
                recommendations.append({
                    "recommendation": "Continue current strategy",
                    "rationale": insight,
                    "priority": "medium",
                })
            elif "declined" in insight.lower() or "negative" in insight.lower():
                recommendations.append({
                    "recommendation": "Adjust strategy to address negative trends",
                    "rationale": insight,
                    "priority": "high",
                })
        
        return recommendations
    
    def _generate_executive_summary(
        self,
        sim_results: Dict,
        insights: List[str],
        projections: List[Dict],
    ) -> str:
        """Generate executive summary"""
        return f"""# Strategic Outcome Report - Executive Summary

This report summarizes the strategic simulation results including belief
evolution, business impact projections, and key recommendations.

## Key Insights
{chr(10).join(f'- {i}' for i in insights)}

## Projections
{len(projections)} forward projections calculated based on simulation trends.

## Conclusion
The simulation provides actionable insights for strategic decision-making.
"""
