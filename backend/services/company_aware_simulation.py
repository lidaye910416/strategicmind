"""
公司感知仿真 - 把 CompanyContext 接入到 SimulationLoop，
让仿真在每回合前先经过部门博弈决议，再让 Agent 行动。

设计：
1. 仿真开始时，初始化 CompanyContext（部门 + 经营 + 市场 + 客户/竞品）
2. 每个回合开始前，根据当前市场环境和议题，用 InterDepartmentResolver 做公司级决议
3. 决议影响该回合的 Agent 行为（action_modifier）
4. 行动结果反馈到业务指标（BusinessMetricsTracker）

Implements: US-210 公司感知仿真
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional, Callable
from enum import Enum
import asyncio

from ..models.strategic_agent import StrategicAgent
from ..models.department_agent import DepartmentAgent, DepartmentType
from ..models.business_model import BusinessModel, BusinessModelProfile
from ..models.market_environment import MarketEnvironmentAgent
from ..interfaces.llm_provider import ILLMProvider
from .belief_engine import BeliefEngine
from .propagation_layer import PropagationLayer
from .inter_department_resolver import (
    InterDepartmentResolver, ResolutionOutcome, TopicResolution
)
from .business_metrics_tracker import BusinessMetricsTracker
from .company_orchestrator import CompanyContext
from .topic_emergence import TopicEmergenceEngine, EmergedTopic
from .simulation_loop import RoundResult


@dataclass
class CompanyAwareRoundResult:
    """公司感知的一回合结果"""
    round_num: int
    simulated_hour: int
    start_time: str
    end_time: Optional[str] = None
    
    # 该回合的公司级决议
    resolution: Optional[TopicResolution] = None
    
    # 该回合的议题来源（"user_preset" 或 "emerged:SIGNAL"）
    topic_source: str = "user_preset"
    
    # 部门行动
    department_actions: List[Dict[str, Any]] = field(default_factory=list)
    
    # 业务指标快照
    metrics_snapshot: Optional[Dict[str, Any]] = None
    
    # 市场环境快照
    market_env_snapshot: Optional[Dict[str, Any]] = None
    
    # 涌现的议题（基于上一回合指标）
    emerged_topics: List[EmergedTopic] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "round_num": self.round_num,
            "simulated_hour": self.simulated_hour,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "resolution": self.resolution.to_dict() if self.resolution else None,
            "topic_source": self.topic_source,
            "department_actions_count": len(self.department_actions),
            "metrics": self.metrics_snapshot,
            "market_env": self.market_env_snapshot,
            "emerged_topics": [t.to_dict() for t in self.emerged_topics],
        }


class CompanyAwareSimulation:
    """
    公司感知仿真引擎。
    
    流程（每回合）：
    1. 推进市场环境（季度）
    2. 提取本回合议题
    3. 部门博弈决议（InterDepartmentResolver）
    4. 部门 Agent 基于决议执行行动
    5. 业务指标更新
    6. 反馈到市场环境
    """
    
    def __init__(
        self,
        company_context: CompanyContext,
        llm_provider: ILLMProvider,
        config: Optional[Dict[str, Any]] = None,
    ):
        self.company = company_context
        self.llm = llm_provider
        self.config = config or {}
        
        # 仿真组件
        self.belief_engine = BeliefEngine()
        self.propagation = PropagationLayer()
        self.resolver = InterDepartmentResolver()
        self.metrics_tracker = BusinessMetricsTracker(llm_provider)
        self.emergence_engine = TopicEmergenceEngine(llm_provider)
        
        # 配置
        self.hours_per_round = self.config.get("hours_per_round", 6)
        self.max_concurrent = self.config.get("max_concurrent_agents", 5)
        self.semaphore = asyncio.Semaphore(self.max_concurrent)
        
        # 议题列表（用户输入或从种子文档推断）
        self.topics: List[str] = self.config.get("topics", [
            "是否加大 AI 研发投入",
            "是否拓展新市场",
            "是否提价保住毛利率",
            "如何应对竞争",
        ])
    
    async def run(
        self,
        max_rounds: int = 5,
        progress_callback: Optional[Callable[[Dict], None]] = None,
    ) -> Dict[str, Any]:
        """
        运行公司感知仿真。
        """
        results: List[CompanyAwareRoundResult] = []
        topic_idx = 0
        prev_metrics: Optional[Dict[str, Any]] = None
        emerged_topics_history: List[EmergedTopic] = []
        
        for round_num in range(1, max_rounds + 1):
            # 1. 推进市场环境
            self.company.market_env.quarterly_update(random_seed=round_num)
            market_env_snapshot = self.company.market_env.snapshot()
            
            # 2. 【涌现驱动】根据当前市场环境自动生成议题
            # 思路：每回合开始时，根据市场环境（不依赖历史）检测信号
            # 这样保证涌现一定会发生
            if round_num == 1:
                current_topic = self.topics[0]
                topic_source = "user_preset"
            else:
                try:
                    # 用当前市场环境状态构造"假想"指标
                    # 然后与"基线"对比检测信号
                    baseline = {
                        "revenue_outlook": 0.5,
                        "profit_margin_outlook": 0.0,
                        "market_sentiment": 0.5,
                        "competitive_position": 0.5,
                    }
                    # 用市场环境推断"当前预期指标"
                    predicted = {
                        "revenue_outlook": 0.4 + market_env_snapshot.get("sector_growth_rate", 0.05) * 2,
                        "profit_margin_outlook": self.company.business_model.margin_baseline - 0.5 + market_env_snapshot.get("policy_pressure", 0) * 0.2,
                        "market_sentiment": market_env_snapshot.get("consumer_sentiment", 0.5),
                        "competitive_position": 0.5 - market_env_snapshot.get("competition_intensity", 0.5) * 0.3,
                    }
                    
                    emerged = self.emergence_engine.detect_signals(
                        prev_metrics=baseline,
                        curr_metrics=predicted,
                        market_env=market_env_snapshot,
                    )
                    
                    if emerged:
                        current_topic = emerged[0].topic
                        topic_source = f"emerged:{emerged[0].signal.value}"
                        emerged_topics_history.extend(emerged)
                    else:
                        # 无显著信号时用下一个用户预设议题
                        current_topic = self.topics[topic_idx % len(self.topics)]
                        topic_idx += 1
                        topic_source = "user_preset"
                except Exception as e:
                    current_topic = self.topics[topic_idx % len(self.topics)]
                    topic_idx += 1
                    topic_source = f"user_preset:fallback({e})"
            
            _ = topic_idx  # Suppress unused warning
            
            # 3. 部门博弈决议
            resolution = self.resolver.resolve(
                topic=current_topic,
                departments=self.company.departments,
                external_pressure=self._infer_external_pressure(),
                business_model_modifier=self.company.business_model.department_power_modifier,
            )
            
            # 4. 部门 Agent 基于决议行动
            dept_actions = await self._execute_department_actions(
                resolution, round_num,
            )
            
            # 5. 业务指标更新
            metrics = await self._update_metrics(dept_actions, round_num)
            
            # 6. 构造结果
            # 收集本回合的涌现议题（基于本回合的指标）
            round_emerged = (
                self.emergence_engine.detect_signals(
                    prev_metrics=prev_metrics,
                    curr_metrics=metrics,
                    market_env=self.company.market_env.snapshot(),
                )
                if prev_metrics else []
            )
            
            result = CompanyAwareRoundResult(
                round_num=round_num,
                simulated_hour=round_num * self.hours_per_round,
                start_time=asyncio.get_event_loop().time(),
                resolution=resolution,
                topic_source=topic_source,
                department_actions=dept_actions,
                metrics_snapshot=metrics,
                market_env_snapshot=self.company.market_env.snapshot(),
                emerged_topics=round_emerged,
            )
            results.append(result)
            
            # 7. 进度回调
            if progress_callback:
                progress_callback({
                    "round": round_num,
                    "total_rounds": max_rounds,
                    "progress": round_num / max_rounds,
                    "outcome": resolution.outcome.value,
                    "company_position": resolution.company_position,
                })
        
        return {
            "current_round": len(results),
            "total_rounds": max_rounds,
            "round_results": [r.to_dict() for r in results],
            "company_summary": self._summarize_company(results),
            "final_metrics": self._final_metrics(),
        }
    
    def _infer_external_pressure(self) -> float:
        """根据市场环境推断外部压力"""
        env = self.company.market_env
        # 行业增速低 + 政策紧 + 资金紧 → 外部压力大
        growth_factor = -env.sector_growth_rate * 3
        policy_factor = env.policy_pressure * 0.5
        capital_factor = -(env.capital_availability - 0.5) * 0.5
        return max(-1.0, min(1.0, growth_factor + policy_factor + capital_factor))
    
    async def _execute_department_actions(
        self,
        resolution: TopicResolution,
        round_num: int,
    ) -> List[Dict[str, Any]]:
        """
        部门 Agent 基于决议执行行动。
        """
        actions = []
        
        async def act_for_dept(dept: DepartmentAgent) -> Dict[str, Any]:
            async with self.semaphore:
                # 找到本部门对该议题的立场
                dept_position = next(
                    (p for p in resolution.positions if p.dept_type == dept.department_type),
                    None,
                )
                
                if not dept_position:
                    return {"dept": dept.name, "action": "no_position"}
                
                # 基于立场和决议生成行动
                if resolution.outcome == ResolutionOutcome.ADOPTED:
                    if dept_position.position > 0.2:
                        action_type = "EXECUTE_PROPOSAL"
                        description = f"积极推动决议执行"
                    else:
                        action_type = "ACCEPT_RELUCTANTLY"
                        description = f"虽保留意见但接受决议"
                elif resolution.outcome == ResolutionOutcome.REJECTED:
                    if dept_position.position < -0.2:
                        action_type = "EXECUTE_BLOCK"
                        description = f"成功阻止决议"
                    else:
                        action_type = "ACCEPT_RELUCTANTLY"
                        description = f"尊重公司决策"
                elif resolution.outcome == ResolutionOutcome.COMPROMISED:
                    action_type = "PROPOSE_COMPROMISE"
                    description = f"提出妥协方案"
                else:  # DEFERRED
                    action_type = "REQUEST_MORE_DATA"
                    description = f"要求补充数据后再议"
                
                return {
                    "dept": dept.name,
                    "dept_type": dept.department_type.value,
                    "action_type": action_type,
                    "description": description,
                    "position": dept_position.position,
                    "voting_weight": dept_position.voting_weight,
                    "round_num": round_num,
                }
        
        # 并发执行所有部门行动
        action_results = await asyncio.gather(
            *[act_for_dept(d) for d in self.company.departments],
            return_exceptions=True,
        )
        
        for a in action_results:
            if isinstance(a, dict):
                actions.append(a)
        
        return actions
    
    async def _update_metrics(
        self,
        dept_actions: List[Dict[str, Any]],
        round_num: int,
    ) -> Dict[str, Any]:
        """
        根据部门行动和市场环境变化更新业务指标。
        
        关键：让指标在回合间有显著变化，触发涌现。
        """
        # 行动统计
        exec_count = sum(1 for a in dept_actions if a.get("action_type") == "EXECUTE_PROPOSAL")
        block_count = sum(1 for a in dept_actions if a.get("action_type") == "EXECUTE_BLOCK")
        compromise_count = sum(1 for a in dept_actions if a.get("action_type") == "PROPOSE_COMPROMISE")
        
        # 业务指标变化
        env = self.company.market_env
        bm = self.company.business_model
        
        # 基础值（受市场环境驱动）
        base_revenue = 0.4 + env.sector_growth_rate * 2
        base_profit = bm.margin_baseline
        base_sentiment = env.consumer_sentiment
        
        # 行动影响（更显著）
        revenue_change = exec_count * 0.08 - block_count * 0.05
        profit_change = compromise_count * 0.03 - exec_count * 0.02
        
        # 冲击传导（让指标随外部环境波动）
        shock_impact = self.company.business_model.shock_transmission_coefficient()
        
        # 引入基于回合的累积效应（前几回合建设，后几回合收获）
        cumulative_effect = 0
        if round_num >= 2:
            # 后续回合的指标更受市场环境驱动
            cumulative_effect = (env.sector_growth_rate - 0.05) * 0.5
        
        snapshot = {
            "round": round_num,
            "revenue_outlook": max(-1, min(1, base_revenue + revenue_change + cumulative_effect)),
            "profit_margin_outlook": max(-1, min(1, base_profit + profit_change - 0.5 + env.policy_pressure * 0.2)),
            "market_sentiment": base_sentiment + revenue_change * 0.3,
            "competitive_position": 0.5 + (exec_count - block_count) * 0.05 - env.competition_intensity * 0.2,
            "exec_count": exec_count,
            "block_count": block_count,
            "compromise_count": compromise_count,
            "shock_impact": shock_impact,
        }
        
        return snapshot
    
    def _summarize_company(
        self,
        results: List[CompanyAwareRoundResult],
    ) -> Dict[str, Any]:
        """公司级汇总"""
        outcomes = {}
        emerged_count = 0
        preset_count = 0
        for r in results:
            if r.resolution:
                outcomes[r.resolution.outcome.value] = outcomes.get(r.resolution.outcome.value, 0) + 1
            if r.topic_source.startswith("emerged:"):
                emerged_count += 1
            else:
                preset_count += 1
        
        avg_position = sum(
            r.resolution.company_position for r in results if r.resolution
        ) / max(len(results), 1)
        
        return {
            "company_name": self.company.company_name,
            "business_model": self.company.business_model.model_name_cn,
            "total_rounds": len(results),
            "outcome_distribution": outcomes,
            "avg_company_position": avg_position,
            "final_market_cycle": self.company.market_env.current_cycle.value,
            # 【新增】涌现统计
            "emergence_stats": {
                "emerged_topics_count": emerged_count,
                "preset_topics_count": preset_count,
                "emergence_rate": emerged_count / max(len(results), 1),
                "emerged_signals": [
                    {"round": r.round_num, "signal": t.signal.value, "topic": t.topic}
                    for r in results for t in r.emerged_topics
                ],
            },
        }
    
    def _final_metrics(self) -> Dict[str, Any]:
        """最终业务指标"""
        return {
            "company_name": self.company.company_name,
            "metrics_history_count": len(self.company.business_metrics_history),
            "resolutions_count": len(self.company.resolution_history),
        }
