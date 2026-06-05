"""
公司级仿真报告生成器 - 把多回合部门博弈推演结果生成结构化报告。

报告章节：
1. 公司概览（经营模式、市场环境、关键参数）
2. 部门结构（7-10 个部门的 KPI 和决策权）
3. 推演汇总（决议结果分布、部门立场分布）
4. 议题逐项分析（每回合的议题、立场、决议、原因）
5. 战略建议（基于推演结果）

Implements: US-220 公司级仿真报告
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional
from datetime import datetime

from ..models.business_model import BUSINESS_MODEL_NAMES_CN
from ..models.department_agent import DEPARTMENT_NAMES_CN, DepartmentType
from ..models.market_environment import MARKET_CYCLE_LABELS_CN, POLICY_STANCE_LABELS_CN
from .company_orchestrator import CompanyContext


@dataclass
class CompanyReport:
    """公司级仿真报告"""
    company_id: str
    company_name: str
    generated_at: str
    
    chapters: Dict[str, str] = field(default_factory=dict)
    raw_data: Dict[str, Any] = field(default_factory=dict)
    
    def to_markdown(self) -> str:
        """生成完整 Markdown 报告"""
        lines = []
        lines.append(f"# {self.company_name} · 部门博弈推演报告")
        lines.append("")
        lines.append(f"> 生成时间：{self.generated_at}")
        lines.append(f"> 公司 ID：`{self.company_id}`")
        lines.append("")
        for chapter_title, chapter_content in self.chapters.items():
            lines.append(f"## {chapter_title}")
            lines.append("")
            lines.append(chapter_content)
            lines.append("")
        return "\n".join(lines)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "company_id": self.company_id,
            "company_name": self.company_name,
            "generated_at": self.generated_at,
            "chapters": self.chapters,
            "raw_data": self.raw_data,
        }


class CompanyReportGenerator:
    """公司级报告生成器"""
    
    def __init__(self, company_context: CompanyContext):
        self.company = company_context
    
    def generate(self) -> CompanyReport:
        """生成完整报告"""
        report = CompanyReport(
            company_id=self.company.company_id,
            company_name=self.company.company_name,
            generated_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        )
        
        # 章节 1：公司概览
        report.chapters["1. 公司概览"] = self._chapter_overview()
        
        # 章节 2：部门结构
        report.chapters["2. 部门结构"] = self._chapter_departments()
        
        # 章节 3：市场环境
        report.chapters["3. 市场环境"] = self._chapter_market_env()
        
        # 章节 4：竞品与客户
        report.chapters["4. 竞品与客户"] = self._chapter_competitors_customers()
        
        # 章节 5：推演汇总
        report.chapters["5. 推演汇总"] = self._chapter_resolution_summary()
        
        # 章节 6：议题逐项分析
        report.chapters["6. 议题逐项分析"] = self._chapter_topic_analysis()
        
        # 章节 7：部门立场分布
        report.chapters["7. 部门立场分布"] = self._chapter_department_distribution()
        
        # 章节 8：战略建议
        report.chapters["8. 战略建议"] = self._chapter_recommendations()
        
        # 原始数据
        report.raw_data = self.company.to_dict()
        
        return report
    
    def _chapter_overview(self) -> str:
        """公司概览"""
        bm = self.company.business_model
        return f"""**公司名称**：{self.company.company_name}

**经营模式**：{bm.model_name_cn}

| 指标 | 数值 |
|------|------|
| 基准毛利率 | {bm.margin_baseline:.0%} |
| 毛利率波动 | {bm.margin_volatility:.0%} |
| 资本支出强度 | {bm.capex_intensity:.0%} |
| 决策周期 | {bm.decision_cycle_days} 天 |
| 外部依赖度 | {bm.external_dependency:.2f} |
| 抗冲击韧性 | {bm.shock_resilience:.2f} |
| 客户集中度 | {bm.customer_concentration:.2f} |
| 合同周期 | {bm.contract_duration_months} 月 |
| 冲击传导系数 | {bm.shock_transmission_coefficient():.2f} |

**核心部门数**：{len(self.company.departments)} 个
**竞品数**：{len(self.company.competitors)} 个
**客户群数**：{len(self.company.customers)} 个"""
    
    def _chapter_departments(self) -> str:
        """部门结构"""
        lines = [
            "公司现有 **{}** 个核心部门，每个部门有自己的 KPI 权重和决策权。",
            "",
            "| 部门 | 负责人 | 决策权 | 核心 KPI |",
            "|------|--------|--------|----------|",
        ]
        
        for dept in sorted(self.company.departments, key=lambda d: -d.decision_power):
            from ..models.department_agent import DEPARTMENT_NAMES_CN, DepartmentType as DEPT_CN
            # 找到本部门最重要的 3 个 KPI
            kpi_dict = dept.kpi.to_dict()
            top_kpis = sorted(kpi_dict.items(), key=lambda x: -x[1])[:3]
            kpi_str = ", ".join(f"{k}({v:.0%})" for k, v in top_kpis if v > 0)
            
            lines.append(
                f"| {DEPARTMENT_NAMES_CN.get(dept.department_type, dept.department_type)} | {dept.name} | "
                f"{dept.decision_power:.2f} | {kpi_str or '通用'} |"
            )
        
        lines.append("")
        lines.append("**部门关系**：")
        for dept in self.company.departments:
            for other_id, weight in dept.dept_relationships.items():
                if abs(weight) > 0.2:
                    other = next((d for d in self.company.departments if d.agent_id == other_id), None)
                    if other:
                        rel = "协作" if weight > 0 else "冲突"
                        lines.append(f"- {DEPARTMENT_NAMES_CN.get(dept.department_type, dept.department_type)} ⇄ {DEPARTMENT_NAMES_CN.get(other.department_type, other.department_type)}：{rel}（强度 {weight:+.2f}）")
        
        return "\n".join(lines)
    
    def _chapter_market_env(self) -> str:
        """市场环境"""
        env = self.company.market_env
        return f"""当前市场环境关键参数：

| 指标 | 数值 | 解读 |
|------|------|------|
| 行业增速 | {env.sector_growth_rate:.2%} | {'高速增长' if env.sector_growth_rate > 0.12 else '稳定' if env.sector_growth_rate > 0.04 else '下行'} |
| 市场规模 | {env.market_size_billion:.0f} 亿元 | - |
| 竞争激烈度 | {env.competition_intensity:.2f} | {'激烈' if env.competition_intensity > 0.6 else '适中' if env.competition_intensity > 0.3 else '宽松'} |
| 政策立场 | {POLICY_STANCE_LABELS_CN.get(env.policy_stance, '中性')} | - |
| 政策压力 | {env.policy_pressure:.2f} | {'高压' if env.policy_pressure > 0.6 else '中压' if env.policy_pressure > 0.3 else '低压'} |
| 资金可获得性 | {env.capital_availability:.2f} | {'充裕' if env.capital_availability > 0.6 else '一般' if env.capital_availability > 0.3 else '紧缩'} |
| 利率水平 | {env.interest_rate_level:.2%} | - |
| 技术成熟度 | {env.tech_maturity:.2f} | - |
| 创新节奏 | {env.innovation_pace:.2f} | - |
| 消费者信心 | {env.consumer_sentiment:+.2f} | {'乐观' if env.consumer_sentiment > 0.3 else '谨慎' if env.consumer_sentiment > -0.3 else '悲观'} |
| 价格敏感度 | {env.customer_price_sensitivity:.2f} | - |
| **市场周期** | **{MARKET_CYCLE_LABELS_CN.get(env.current_cycle, '未知')}** | - |
| 当前季度 | Q{env.fiscal_quarter} | 推进年数 {env.fiscal_year_offset} |"""
    
    def _chapter_competitors_customers(self) -> str:
        """竞品与客户"""
        lines = []
        
        if self.company.competitors:
            lines.append("### 竞品分析")
            lines.append("")
            lines.append("| 竞品 | 市场份额 | 攻击性 | 策略 | 营收估计 |")
            lines.append("|------|----------|--------|------|----------|")
            for c in self.company.competitors:
                from ..models.market_actor import COMPETITOR_STRATEGY_LABELS_CN
                lines.append(
                    f"| {c.name} | {c.market_share:.0%} | {c.aggressiveness:.2f} | "
                    f"{COMPETITOR_STRATEGY_LABELS_CN.get(c.strategy, c.strategy.value)} | {c.revenue_estimate:.1f} 亿 |"
                )
            lines.append("")
        
        if self.company.customers:
            from collections import Counter
            seg_counts = Counter(c.segment.value for c in self.company.customers)
            lines.append("### 客户群分析")
            lines.append("")
            lines.append("| 客户细分 | 数量 | 平均满意度 | 平均购买意向 |")
            lines.append("|----------|------|------------|-------------|")
            for seg, count in seg_counts.items():
                seg_customers = [c for c in self.company.customers if c.segment.value == seg]
                avg_sat = sum(c.satisfaction_score for c in seg_customers) / len(seg_customers)
                avg_int = sum(c.purchase_intent for c in seg_customers) / len(seg_customers)
                lines.append(
                    f"| {seg} | {count} | {avg_sat:.2f} | {avg_int:.2f} |"
                )
        
        return "\n".join(lines) if lines else "无竞品/客户数据"
    
    def _chapter_resolution_summary(self) -> str:
        """推演汇总"""
        if not self.company.resolution_history:
            return "尚无推演数据。请先在系统中输入议题进行部门博弈推演。"
        
        from collections import Counter
        outcomes = [r.get("outcome", "DEFERRED") for r in self.company.resolution_history]
        outcome_dist = Counter(outcomes)
        
        total = len(self.company.resolution_history)
        lines = [
            f"已完成 **{total}** 个议题的部门博弈推演。决议结果分布：",
            "",
            "| 决议结果 | 数量 | 占比 |",
            "|----------|------|------|",
        ]
        outcome_labels_cn = {
            "ADOPTED": "✅ 采纳",
            "REJECTED": "❌ 拒绝",
            "COMPROMISED": "⚖️ 妥协",
            "DEFERRED": "⏸ 暂缓",
        }
        for outcome, count in outcome_dist.most_common():
            lines.append(f"| {outcome_labels_cn.get(outcome, outcome)} | {count} | {count/total:.0%} |")
        
        return "\n".join(lines)
    
    def _chapter_topic_analysis(self) -> str:
        """议题逐项分析"""
        if not self.company.resolution_history:
            return "尚无议题分析数据。"
        
        lines = []
        for i, res in enumerate(self.company.resolution_history[-10:], 1):
            topic = res.get("topic", "(未知议题)")
            pos = res.get("company_position", 0)
            outcome = res.get("outcome", "DEFERRED")
            outcome_cn = res.get("outcome_label_cn", outcome)
            
            lines.append(f"### 议题 {i}：{topic}")
            lines.append("")
            lines.append(f"- **公司立场**：{pos:+.2f}")
            lines.append(f"- **决议结果**：{outcome_cn}")
            lines.append(f"- **决议摘要**：{res.get('summary', '')}")
            lines.append("")
            lines.append("**部门立场**：")
            lines.append("")
            lines.append("| 部门 | 立场 | 信心 | 投票权重 |")
            lines.append("|------|------|------|----------|")
            for p in sorted(res.get("positions", []), key=lambda x: -x["position"]):
                lines.append(
                    f"| {p['dept_name']} | {p['position']:+.2f} | "
                    f"{p['confidence']:.2f} | {p['voting_weight']:.2f} |"
                )
            lines.append("")
        
        return "\n".join(lines)
    
    def _chapter_department_distribution(self) -> str:
        """部门立场分布"""
        if not self.company.resolution_history:
            return "尚无部门立场数据。"
        
        # 聚合
        position_by_dept: Dict[str, List[float]] = {}
        outcome_count: Dict[str, int] = {}
        
        for res in self.company.resolution_history:
            outcome = res.get("outcome", "DEFERRED")
            outcome_count[outcome] = outcome_count.get(outcome, 0) + 1
            for pos in res.get("positions", []):
                dept = pos.get("dept_type", "UNKNOWN")
                position_by_dept.setdefault(dept, []).append(pos.get("position", 0))
        
        lines = ["### 部门立场分布（按平均立场排序）", ""]
        lines.append("| 部门 | 平均立场 | 样本数 | 倾向 |")
        lines.append("|------|----------|--------|------|")
        
        for dept, positions in sorted(position_by_dept.items(), key=lambda x: -sum(x[1])/len(x[1])):
            avg = sum(positions) / len(positions)
            dept_name_cn = DEPARTMENT_NAMES_CN.get(
                DepartmentType(dept),
                dept,
            )
            stance = "支持倾向" if avg > 0.2 else "反对倾向" if avg < -0.2 else "中立"
            lines.append(f"| {dept_name_cn} | {avg:+.3f} | {len(positions)} | {stance} |")
        
        return "\n".join(lines)
    
    def _chapter_recommendations(self) -> str:
        """战略建议"""
        lines = []
        
        # 分析结果
        bm = self.company.business_model
        bm_name = bm.model_name_cn
        
        # 部门立场分布
        dept_stance = {}
        for res in self.company.resolution_history:
            for p in res.get("positions", []):
                dept_stance.setdefault(p["dept_type"], []).append(p["position"])
        
        most_supportive = max(dept_stance.items(), key=lambda x: sum(x[1])/len(x[1]), default=(None, [0]))
        most_opposed = min(dept_stance.items(), key=lambda x: sum(x[1])/len(x[1]), default=(None, [0]))
        
        if most_supportive[0]:
            from ..models.department_agent import DepartmentType
            try:
                dept_cn = DEPARTMENT_NAMES_CN.get(DepartmentType(most_supportive[0]), most_supportive[0])
            except ValueError:
                dept_cn = most_supportive[0]
            avg = sum(most_supportive[1]) / len(most_supportive[1])
            lines.append(f"**最支持部门**：`{dept_cn}`（平均立场 {avg:+.2f}）")
        
        if most_opposed[0] and most_opposed[0] != most_supportive[0]:
            try:
                dept_cn = DEPARTMENT_NAMES_CN.get(DepartmentType(most_opposed[0]), most_opposed[0])
            except (ValueError, ImportError):
                dept_cn = most_opposed[0]
            avg = sum(most_opposed[1]) / len(most_opposed[1])
            lines.append(f"**最反对部门**：`{dept_cn}`（平均立场 {avg:+.2f}）")
        
        lines.append("")
        lines.append("### 战略建议")
        lines.append("")
        
        if bm.model.value == "STATE_OWNED":
            lines.append(
                "1. **优先合规与政策响应**：国资导向型公司应密切关注政策动向，法务合规部的话语权"
                "已在经营模式中加权提升（1.3×），战略发展部也拥有更高话语权（1.4×）。"
            )
            lines.append(
                "2. **稳健推进新业务**：避免激进的市场扩张，优先通过合资、合作等方式分散风险。"
            )
        elif bm.model.value == "PLATFORM_BASED":
            lines.append(
                "1. **技术驱动优先**：平台型公司的技术部门话语权已加权（1.5×），应持续投入"
                "平台基础设施和双边网络效应。"
            )
            lines.append(
                "2. **平衡增长与盈利**：用户增长 KPI 优先级已提升（1.4×），但要避免单纯冲量忽视留存。"
            )
        elif bm.model.value == "PROJECT_BASED":
            lines.append(
                "1. **销售部主导**：项目制公司销售话语权最高（1.4×），决策周期最短（14 天），"
                "适合快速跟进客户需求。"
            )
            lines.append(
                "2. **降本增效**：毛利率基准较低（25%），需要严格控制项目交付成本。"
            )
        else:  # PRODUCT_BASED
            lines.append(
                "1. **产品+技术双轮驱动**：产品制公司产品/技术部门话语权均提升，应持续打磨产品力。"
            )
            lines.append(
                "2. **关注留存**：毛利率基准较高（60%），但要警惕客户流失对长期价值的影响。"
            )
        
        # 部门冲突分析
        if self.company.resolution_history:
            compromise_count = sum(1 for r in self.company.resolution_history if r.get("outcome") == "COMPROMISED")
            total = len(self.company.resolution_history)
            if compromise_count / total > 0.5:
                lines.append("")
                lines.append(
                    f"3. **降低部门分歧**：{compromise_count}/{total} 议题以妥协收场，"
                    f"建议加强部门间的横向沟通机制（如月度战略对齐会）。"
                )
        
        return "\n".join(lines) if lines else "暂无建议"
