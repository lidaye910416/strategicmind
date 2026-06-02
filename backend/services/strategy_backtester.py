"""
StrategyBacktester - Validate predictions against historical outcomes

Tracks prediction accuracy and generates model improvement suggestions.
Implements: US-088
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
from datetime import datetime
import json
import os


@dataclass
class BacktestResult:
    """Result of backtesting a prediction"""
    case_id: str
    predicted_outcome: str
    actual_outcome: str
    accuracy_score: float  # 0.0 to 1.0
    error_categories: List[str] = field(default_factory=list)
    improvements: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "case_id": self.case_id,
            "predicted_outcome": self.predicted_outcome,
            "actual_outcome": self.actual_outcome,
            "accuracy_score": self.accuracy_score,
            "error_categories": self.error_categories,
            "improvements": self.improvements,
        }


class StrategyBacktester:
    """
    Validates simulation predictions against historical outcomes.
    """
    
    def __init__(self, storage_path: str = "./data/backtest"):
        self.storage_path = storage_path
        os.makedirs(storage_path, exist_ok=True)
        self.history: List[BacktestResult] = []
    
    def backtest(
        self,
        similar_historical_case: Dict[str, Any],
        prediction: Dict[str, Any],
        actual_outcome: Dict[str, Any],
    ) -> BacktestResult:
        """
        Compare prediction to actual outcome.
        
        Args:
            similar_historical_case: Reference historical case
            prediction: Predicted outcome from simulation
            actual_outcome: Actual outcome that occurred
            
        Returns:
            BacktestResult with accuracy and improvements
        """
        # Calculate accuracy
        accuracy = self._calculate_accuracy(prediction, actual_outcome)
        
        # Identify error categories
        errors = self._identify_errors(prediction, actual_outcome)
        
        # Suggest improvements
        improvements = self._suggest_improvements(errors, accuracy)
        
        result = BacktestResult(
            case_id=similar_historical_case.get("id", "unknown"),
            predicted_outcome=str(prediction.get("summary", "")),
            actual_outcome=str(actual_outcome.get("summary", "")),
            accuracy_score=accuracy,
            error_categories=errors,
            improvements=improvements,
        )
        
        self.history.append(result)
        self._save_history()
        
        return result
    
    def get_accuracy_trend(self) -> List[float]:
        """Get accuracy trend over time"""
        return [r.accuracy_score for r in self.history]
    
    def get_average_accuracy(self) -> float:
        """Get average accuracy across history"""
        if not self.history:
            return 0.0
        return sum(r.accuracy_score for r in self.history) / len(self.history)
    
    def _calculate_accuracy(
        self,
        prediction: Dict,
        actual: Dict,
    ) -> float:
        """Calculate accuracy score"""
        pred_text = json.dumps(prediction, sort_keys=True)
        actual_text = json.dumps(actual, sort_keys=True)
        
        # Simple word overlap (in production, use semantic similarity)
        pred_words = set(pred_text.lower().split())
        actual_words = set(actual_text.lower().split())
        
        if not pred_words or not actual_words:
            return 0.0
        
        intersection = pred_words & actual_words
        union = pred_words | actual_words
        
        return len(intersection) / len(union) if union else 0.0
    
    def _identify_errors(
        self,
        prediction: Dict,
        actual: Dict,
    ) -> List[str]:
        """Identify categories of errors"""
        errors = []
        
        if prediction.get("sentiment") != actual.get("sentiment"):
            errors.append("sentiment_misclassification")
        
        if abs(prediction.get("magnitude", 0) - actual.get("magnitude", 0)) > 0.3:
            errors.append("magnitude_misestimation")
        
        if not errors:
            errors.append("minor_inaccuracies")
        
        return errors
    
    def _suggest_improvements(
        self,
        errors: List[str],
        accuracy: float,
    ) -> List[str]:
        """Suggest model improvements"""
        improvements = []
        
        if "sentiment_misclassification" in errors:
            improvements.append("Improve sentiment analysis with more training data")
        
        if "magnitude_misestimation" in errors:
            improvements.append("Calibrate magnitude predictions with historical baselines")
        
        if accuracy < 0.6:
            improvements.append("Consider ensemble methods for better predictions")
            improvements.append("Add more domain-specific context to prompts")
        
        return improvements
    
    def _save_history(self) -> None:
        """Save history to disk"""
        path = os.path.join(self.storage_path, "history.json")
        with open(path, "w") as f:
            json.dump([r.to_dict() for r in self.history], f, indent=2)
