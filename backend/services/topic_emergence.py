"""
议题涌现引擎 - 从业务指标变化中自动生成下一回合的战略议题。

设计目的：
1. 让多轮推演从"用户预设议题"升级为"因果涌现"
2. 每回合行动 → 指标变化 → 自动生成下一回合议题
3. 形成真正的"决策-反馈"闭环

涌现规则：
- 营收下滑 → "是否收缩/转型/降价/扩客户"
- 现金流紧张 → "是否融资/收缩/调整账期"
- 毛利率下降 → "是否提价/降本/产品组合优化"
- 客户流失 → "如何提升客户满意度"
- 市场份额下降 → "如何应对竞争"
- 研发不足 → "是否加大研发"
- 组织效率低 → "是否优化组织"
- 消费者信心低 → "如何应对市场"

Implements: US-240 议题涌现
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional, Tuple
from enum import Enum
import re

from ..interfaces.llm_provider import ILLMProvider


class MetricSignal(str, Enum):
    """指标信号类型"""
    REVENUE_DECLINE = "REVENUE_DECLINE"          # 营收下滑
    REVENUE_GROWTH = "REVENUE_GROWTH"            # 营收增长
    CASH_FLOW_TIGHT = "CASH_FLOW_TIGHT"          # 现金流紧张
    MARGIN_DECLINE = "MARGIN_DECLINE"            # 毛利率下降
    CUSTOMER_LOSS = "CUSTOMER_LOSS"              # 客户流失
    MARKET_SHARE_LOSS = "MARKET_SHARE_LOSS"      # 市场份额下降
    RD_INSUFFICIENT = "RD_INSUFFICIENT"          # 研发不足
    COMPLIANCE_RISK = "COMPLIANCE_RISK"          # 合规风险
    COMPETITIVE_PRESSURE = "COMPETITIVE_PRESSURE"  # 竞争压力
    MACRO_DOWN = "MACRO_DOWN"                    # 宏观下行
    POLICY_CHANGE = "POLICY_CHANGE"              # 政策变化
    SENTIMENT_DOWN = "SENTIMENT_DOWN"            # 情绪下行


# 信号到议题模板的映射
SIGNAL_TO_TOPICS: Dict[MetricSignal, List[str]] = {
    MetricSignal.REVENUE_DECLINE: [
        "营收连续下滑，是否收缩非核心业务？",
        "营收下滑是周期性问题还是结构性问题？",
        "是否通过降价或促销活动挽回营收？",
        "如何在新市场寻找增量？",
    ],
    MetricSignal.REVENUE_GROWTH: [
        "营收快速增长，如何抓住窗口期扩大优势？",
        "增长是否可持续？是否需要提前布局产能？",
    ],
    MetricSignal.CASH_FLOW_TIGHT: [
        "现金流紧张，是否启动新一轮融资？",
        "是否收缩账期、优化应收账款？",
        "是否推迟非紧急资本支出？",
        "是否调整供应商账期？",
    ],
    MetricSignal.MARGIN_DECLINE: [
        "毛利率下滑，是否提价转嫁成本？",
        "是否优化产品组合，淘汰低毛利产品？",
        "是否通过规模效应降本？",
    ],
    MetricSignal.CUSTOMER_LOSS: [
        "客户流失率上升，是否启动客户成功计划？",
        "是否需要重新审视客户分层服务？",
        "是否加大客户体验投入？",
    ],
    MetricSignal.MARKET_SHARE_LOSS: [
        "市场份额被竞品蚕食，如何差异化竞争？",
        "是否启动价格战或创新反击？",
        "是否收购或合作补强能力短板？",
    ],
    MetricSignal.RD_INSUFFICIENT: [
        "研发投入占比偏低，是否加大研发？",
        "是否招聘高端技术人才？",
        "是否与高校/科研院所合作？",
    ],
    MetricSignal.COMPLIANCE_RISK: [
        "合规风险上升，法务部门建议？",
        "是否启动全公司合规审查？",
        "是否调整业务流程以适应新法规？",
    ],
    MetricSignal.COMPETITIVE_PRESSURE: [
        "竞品发布重磅产品/服务，公司如何应对？",
        "是否启动竞争情报监控？",
        "是否通过差异化避免正面竞争？",
    ],
    MetricSignal.MACRO_DOWN: [
        "宏观经济下行，公司防御策略？",
        "是否收紧投资、聚焦核心业务？",
        "是否寻找被低估的并购机会？",
    ],
    MetricSignal.POLICY_CHANGE: [
        "新政策出台，对公司业务影响？",
        "是否调整业务结构适应新政策？",
        "是否争取政策红利？",
    ],
    MetricSignal.SENTIMENT_DOWN: [
        "消费者信心下降，市场策略？",
        "是否加大品牌投入修复形象？",
        "是否开发下沉市场？",
    ],
}


@dataclass
class EmergedTopic:
    """涌现的议题"""
    topic: str
    signal: MetricSignal
    severity: float  # 0-1，紧急度
    rationale: str   # 为什么生成这个议题
    triggering_metrics: Dict[str, float] = field(default_factory=dict)
    confidence: float = 0.8
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "topic": self.topic,
            "signal": self.signal.value,
            "signal_label_cn": SIGNAL_LABELS_CN.get(self.signal, self.signal.value),
            "severity": self.severity,
            "rationale": self.rationale,
            "triggering_metrics": self.triggering_metrics,
            "confidence": self.confidence,
        }


# 信号中文名
SIGNAL_LABELS_CN: Dict[MetricSignal, str] = {
    MetricSignal.REVENUE_DECLINE: "营收下滑",
    MetricSignal.REVENUE_GROWTH: "营收增长",
    MetricSignal.CASH_FLOW_TIGHT: "现金流紧张",
    MetricSignal.MARGIN_DECLINE: "毛利率下降",
    MetricSignal.CUSTOMER_LOSS: "客户流失",
    MetricSignal.MARKET_SHARE_LOSS: "市场份额下降",
    MetricSignal.RD_INSUFFICIENT: "研发不足",
    MetricSignal.COMPLIANCE_RISK: "合规风险",
    MetricSignal.COMPETITIVE_PRESSURE: "竞争压力",
    MetricSignal.MACRO_DOWN: "宏观下行",
    MetricSignal.POLICY_CHANGE: "政策变化",
    MetricSignal.SENTIMENT_DOWN: "情绪下行",
}


class TopicEmergenceEngine:
    """
    议题涌现引擎。
    
    输入：上一回合的指标快照
    输出：本回合的涌现议题
    """
    
    def __init__(
        self,
        llm_provider: Optional[ILLMProvider] = None,
        config: Optional[Dict[str, Any]] = None,
    ):
        self.llm = llm_provider
        self.config = config or {}
        # 触发阈值
        self.revenue_decline_threshold = self.config.get("revenue_decline_threshold", -0.1)
        self.margin_decline_threshold = self.config.get("margin_decline_threshold", -0.05)
        self.cash_flow_threshold = self.config.get("cash_flow_threshold", -0.15)
        self.sentiment_threshold = self.config.get("sentiment_threshold", -0.2)
    
    def detect_signals(
        self,
        prev_metrics: Optional[Dict[str, Any]],
        curr_metrics: Dict[str, Any],
        market_env: Optional[Dict[str, Any]] = None,
    ) -> List[EmergedTopic]:
        """
        从指标变化中检测信号并生成议题。
        
        Args:
            prev_metrics: 上一回合的指标
            curr_metrics: 当前回合的指标
            market_env: 当前市场环境（可选）
            
        Returns:
            涌现议题列表（按 severity 降序）
        """
        topics: List[EmergedTopic] = []
        
        # === 信号 1: 营收下滑/增长 ===
        if prev_metrics and curr_metrics:
            prev_rev = prev_metrics.get("revenue_outlook", 0.5)
            curr_rev = curr_metrics.get("revenue_outlook", 0.5)
            change = curr_rev - prev_rev
            
            if change < self.revenue_decline_threshold:
                # 营收显著下滑
                topics.append(self._make_topic(
                    MetricSignal.REVENUE_DECLINE,
                    severity=min(1.0, abs(change) * 3),
                    rationale=f"营收指标从 {prev_rev:+.2f} 下滑到 {curr_rev:+.2f}，变化 {change:+.2f}",
                    metrics={"revenue_change": change, "prev": prev_rev, "curr": curr_rev},
                ))
            elif change > 0.1:
                # 营收显著增长
                topics.append(self._make_topic(
                    MetricSignal.REVENUE_GROWTH,
                    severity=min(1.0, change * 2),
                    rationale=f"营收指标从 {prev_rev:+.2f} 增长到 {curr_rev:+.2f}，变化 {change:+.2f}",
                    metrics={"revenue_change": change, "prev": prev_rev, "curr": curr_rev},
                ))
        
        # === 信号 2: 毛利率下降 ===
        if prev_metrics and curr_metrics:
            prev_margin = prev_metrics.get("profit_margin_outlook", 0)
            curr_margin = curr_metrics.get("profit_margin_outlook", 0)
            change = curr_margin - prev_margin
            
            if change < self.margin_decline_threshold:
                topics.append(self._make_topic(
                    MetricSignal.MARGIN_DECLINE,
                    severity=min(1.0, abs(change) * 4),
                    rationale=f"毛利率从 {prev_margin:+.2f} 下降到 {curr_margin:+.2f}",
                    metrics={"margin_change": change},
                ))
        
        # === 信号 3: 现金流紧张 ===
        # 推论：从指标中如果没有直接 cash_flow，可以从 market_sentiment + competitive_position 推断
        if curr_metrics:
            market_sentiment = curr_metrics.get("market_sentiment", 0.5)
            competitive_position = curr_metrics.get("competitive_position", 0.5)
            cash_flow_score = market_sentiment * 0.3 + (1 - competitive_position) * 0.3 - 0.3
            
            if cash_flow_score < self.cash_flow_threshold:
                topics.append(self._make_topic(
                    MetricSignal.CASH_FLOW_TIGHT,
                    severity=min(1.0, abs(cash_flow_score) * 3),
                    rationale=f"市场情绪 {market_sentiment:+.2f} + 竞争位 {competitive_position:+.2f} 暗示现金流压力",
                    metrics={"cash_flow_score": cash_flow_score},
                ))
        
        # === 信号 4: 消费者情绪下行 ===
        if market_env:
            sentiment = market_env.get("consumer_sentiment", 0)
            if sentiment < self.sentiment_threshold:
                topics.append(self._make_topic(
                    MetricSignal.SENTIMENT_DOWN,
                    severity=min(1.0, abs(sentiment) * 2),
                    rationale=f"消费者信心 {sentiment:+.2f} 持续低迷",
                    metrics={"sentiment": sentiment},
                ))
        
        # === 信号 5: 竞争压力 ===
        if prev_metrics and curr_metrics:
            prev_pos = prev_metrics.get("competitive_position", 0.5)
            curr_pos = curr_metrics.get("competitive_position", 0.5)
            change = curr_pos - prev_pos
            
            if change < -0.1:
                topics.append(self._make_topic(
                    MetricSignal.MARKET_SHARE_LOSS,
                    severity=min(1.0, abs(change) * 4),
                    rationale=f"竞争位从 {prev_pos:+.2f} 下降到 {curr_pos:+.2f}",
                    metrics={"position_change": change},
                ))
        
        # === 信号 6: 宏观下行 ===
        if market_env:
            growth = market_env.get("sector_growth_rate", 0.05)
            if growth < 0.0:
                topics.append(self._make_topic(
                    MetricSignal.MACRO_DOWN,
                    severity=min(1.0, abs(growth) * 5),
                    rationale=f"行业增速 {growth:+.2%} 跌入负区间",
                    metrics={"growth": growth},
                ))
        
        # === 信号 7: 政策变化 ===
        if market_env:
            policy_pressure = market_env.get("policy_pressure", 0)
            policy_stance = market_env.get("policy_stance", "NEUTRAL")
            if policy_pressure > 0.6 and policy_stance == "RESTRICTIVE":
                topics.append(self._make_topic(
                    MetricSignal.POLICY_CHANGE,
                    severity=policy_pressure,
                    rationale=f"政策立场变为限制性，压力 {policy_pressure:.2f}",
                    metrics={"policy_pressure": policy_pressure},
                ))
        
        # 按 severity 降序，最多返回 3 个
        topics.sort(key=lambda t: -t.severity)
        return topics[:3]
    
    def _make_topic(
        self,
        signal: MetricSignal,
        severity: float,
        rationale: str,
        metrics: Dict[str, float],
    ) -> EmergedTopic:
        """从信号生成一个具体议题"""
        templates = SIGNAL_TO_TOPICS.get(signal, ["如何应对当前挑战？"])
        # 基于 severity 选择模板
        idx = min(int(severity * len(templates)), len(templates) - 1)
        topic = templates[idx]
        
        return EmergedTopic(
            topic=topic,
            signal=signal,
            severity=severity,
            rationale=rationale,
            triggering_metrics=metrics,
            confidence=min(0.95, 0.5 + severity * 0.5),
        )
    
    async def generate_with_llm(
        self,
        prev_metrics: Optional[Dict[str, Any]],
        curr_metrics: Dict[str, Any],
        market_env: Optional[Dict[str, Any]] = None,
        business_model: str = "",
        max_topics: int = 2,
    ) -> List[EmergedTopic]:
        """
        用 LLM 生成更精准的议题（如果 LLM 可用）。
        """
        # 1. 先用规则检测
        rule_based = self.detect_signals(prev_metrics, curr_metrics, market_env)
        
        # 2. 如果 LLM 不可用，直接返回规则结果
        if self.llm is None:
            return rule_based[:max_topics]
        
        # 3. 用 LLM 重新生成（基于规则的信号）
        try:
            signals_text = "\n".join(
                f"- {SIGNAL_LABELS_CN.get(t.signal, '?')}（紧急度 {t.severity:.2f}）: {t.rationale}"
                for t in rule_based
            ) or "暂无显著信号"
            
            prompt = f"""你是一位资深战略顾问。基于以下公司当前状态，生成 1-2 个最关键的下一步战略议题。

【经营模式】
{business_model}

【指标变化】
{signals_text}

【当前关键指标】
营收展望: {curr_metrics.get('revenue_outlook', 0):+.2f}
毛利率: {curr_metrics.get('profit_margin_outlook', 0):+.2f}
市场情绪: {curr_metrics.get('market_sentiment', 0):+.2f}
竞争位: {curr_metrics.get('competitive_position', 0):+.2f}

【市场环境】
行业增速: {market_env.get('sector_growth_rate', 0):+.2%} (如提供)
消费者信心: {market_env.get('consumer_sentiment', 0):+.2f} (如提供)

【要求】
1. 议题要直接、可操作（不要空泛）
2. 议题之间应有因果关系或递进关系
3. 议题应该回应上面的信号
4. 用中文输出，每条一行，不要编号

请生成议题："""

            response = await self.llm.chat([{"role": "user", "content": prompt}])
            text = response if isinstance(response, str) else response.get("content", "")
            
            # 解析 LLM 生成的议题
            llm_topics = self._parse_llm_topics(text)
            
            # 合并：LLM 生成的 + 规则生成的（去重）
            seen = set()
            merged = []
            for t in llm_topics + rule_based:
                topic_key = t.topic[:30]
                if topic_key not in seen:
                    seen.add(topic_key)
                    merged.append(t)
                    if len(merged) >= max_topics:
                        break
            
            return merged
        except Exception as e:
            # LLM 失败时降级到规则
            return rule_based[:max_topics]
    
    def _parse_llm_topics(self, text: str) -> List[EmergedTopic]:
        """从 LLM 输出解析议题"""
        topics = []
        # 按行分割，过滤空行
        lines = [l.strip() for l in text.split("\n") if l.strip()]
        
        for line in lines:
            # 移除可能的编号
            line = re.sub(r"^[\d\.\-\*•]+\s*", "", line)
            line = line.strip()
            
            # 过滤太短或太长的
            if 5 <= len(line) <= 100:
                # 推断信号（基于关键词）
                signal = self._infer_signal_from_text(line)
                topics.append(EmergedTopic(
                    topic=line,
                    signal=signal,
                    severity=0.6,  # LLM 生成的给中等严重度
                    rationale="由 LLM 基于指标变化推断",
                    confidence=0.75,
                ))
        
        return topics[:3]
    
    def _infer_signal_from_text(self, text: str) -> MetricSignal:
        """从议题文本推断信号"""
        text_lower = text.lower()
        if any(k in text_lower for k in ["营收", "收入", "下滑", "下降"]):
            return MetricSignal.REVENUE_DECLINE
        if any(k in text_lower for k in ["现金流", "融资", "账期"]):
            return MetricSignal.CASH_FLOW_TIGHT
        if any(k in text_lower for k in ["毛利", "成本", "降本"]):
            return MetricSignal.MARGIN_DECLINE
        if any(k in text_lower for k in ["客户", "流失", "满意度"]):
            return MetricSignal.CUSTOMER_LOSS
        if any(k in text_lower for k in ["竞争", "对手", "市场份额"]):
            return MetricSignal.MARKET_SHARE_LOSS
        if any(k in text_lower for k in ["研发", "技术", "创新"]):
            return MetricSignal.RD_INSUFFICIENT
        if any(k in text_lower for k in ["合规", "监管", "法规"]):
            return MetricSignal.COMPLIANCE_RISK
        if any(k in text_lower for k in ["宏观", "经济", "下行"]):
            return MetricSignal.MACRO_DOWN
        return MetricSignal.COMPETITIVE_PRESSURE
