"""
部门级 Agent 模型 - 把公司经营推演细化到部门粒度。

参考 OASIS 平台化设计思路，但把"个人 Agent"升级为"部门 Agent"，
每个部门有自己的 KPI 权重、决策权、信息源、内部议价机制。

设计目标：
1. 部门 KPI 差异化（销售要冲量、财务要保利润、技术要投入）
2. 部门间议价（同一议题各部门的立场不同）
3. 经营方式依赖（项目制/产品制/平台型 部门反应路径不同）
4. 可与现有 StrategicAgent 兼容

Implements: US-200 部门级建模
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional
from enum import Enum
from uuid import uuid4

from .strategic_agent import StrategicAgent, AgentType, BeliefState, InterestProfile


class DepartmentType(str, Enum):
    """公司部门类型"""
    PRODUCT = "PRODUCT"              # 产品部
    SALES = "SALES"                 # 销售部
    TECH = "TECH"                   # 技术部
    FINANCE = "FINANCE"             # 财务部
    HR = "HR"                       # 人力资源部
    LEGAL = "LEGAL"                 # 法务合规部
    OPERATIONS = "OPERATIONS"       # 运营部
    STRATEGY = "STRATEGY"           # 战略发展部
    MARKETING = "MARKETING"         # 市场部
    CUSTOMER_SUCCESS = "CUSTOMER_SUCCESS"  # 客户成功部


# 部门名称（中文）
DEPARTMENT_NAMES_CN: Dict[DepartmentType, str] = {
    DepartmentType.PRODUCT: "产品部",
    DepartmentType.SALES: "销售部",
    DepartmentType.TECH: "技术部",
    DepartmentType.FINANCE: "财务部",
    DepartmentType.HR: "人力资源部",
    DepartmentType.LEGAL: "法务合规部",
    DepartmentType.OPERATIONS: "运营部",
    DepartmentType.STRATEGY: "战略发展部",
    DepartmentType.MARKETING: "市场部",
    DepartmentType.CUSTOMER_SUCCESS: "客户成功部",
}


@dataclass
class DepartmentKPI:
    """
    部门 KPI 权重定义。
    
    每个部门有自己的 KPI 组合（营收/利润/用户数/合规度/客户满意度等），
    推演时基于 KPI 权重计算部门立场。
    """
    revenue_weight: float = 0.0
    profit_margin_weight: float = 0.0
    cost_control_weight: float = 0.0
    user_growth_weight: float = 0.0
    customer_satisfaction_weight: float = 0.0
    retention_weight: float = 0.0
    tech_investment_weight: float = 0.0
    innovation_weight: float = 0.0
    compliance_weight: float = 0.0
    risk_control_weight: float = 0.0
    talent_acquisition_weight: float = 0.0
    org_efficiency_weight: float = 0.0
    
    def total_weight(self) -> float:
        return (
            self.revenue_weight + self.profit_margin_weight +
            self.cost_control_weight + self.user_growth_weight +
            self.customer_satisfaction_weight + self.retention_weight +
            self.tech_investment_weight + self.innovation_weight +
            self.compliance_weight + self.risk_control_weight +
            self.talent_acquisition_weight + self.org_efficiency_weight
        )
    
    def to_dict(self) -> Dict[str, float]:
        return {
            "营收": self.revenue_weight,
            "毛利率": self.profit_margin_weight,
            "成本控制": self.cost_control_weight,
            "用户增长": self.user_growth_weight,
            "客户满意度": self.customer_satisfaction_weight,
            "留存": self.retention_weight,
            "研发投入": self.tech_investment_weight,
            "创新": self.innovation_weight,
            "合规": self.compliance_weight,
            "风险控制": self.risk_control_weight,
            "人才获取": self.talent_acquisition_weight,
            "组织效率": self.org_efficiency_weight,
        }
    
    @classmethod
    def default_for(cls, dept: "DepartmentType") -> "DepartmentKPI":
        defaults = {
            DepartmentType.PRODUCT: cls(
                user_growth_weight=0.30, customer_satisfaction_weight=0.30,
                innovation_weight=0.20, revenue_weight=0.20,
            ),
            DepartmentType.SALES: cls(
                revenue_weight=0.50, user_growth_weight=0.20,
                customer_satisfaction_weight=0.15, retention_weight=0.15,
            ),
            DepartmentType.TECH: cls(
                tech_investment_weight=0.40, innovation_weight=0.25,
                cost_control_weight=0.15, user_growth_weight=0.10,
                org_efficiency_weight=0.10,
            ),
            DepartmentType.FINANCE: cls(
                profit_margin_weight=0.40, cost_control_weight=0.30,
                revenue_weight=0.20, risk_control_weight=0.10,
            ),
            DepartmentType.HR: cls(
                talent_acquisition_weight=0.45, org_efficiency_weight=0.30,
                cost_control_weight=0.15, compliance_weight=0.10,
            ),
            DepartmentType.LEGAL: cls(
                compliance_weight=0.50, risk_control_weight=0.40,
                cost_control_weight=0.10,
            ),
            DepartmentType.OPERATIONS: cls(
                org_efficiency_weight=0.35, customer_satisfaction_weight=0.25,
                cost_control_weight=0.20, retention_weight=0.20,
            ),
            DepartmentType.STRATEGY: cls(
                innovation_weight=0.25, revenue_weight=0.25,
                profit_margin_weight=0.20, compliance_weight=0.15,
                tech_investment_weight=0.15,
            ),
            DepartmentType.MARKETING: cls(
                user_growth_weight=0.35, customer_satisfaction_weight=0.25,
                revenue_weight=0.20, innovation_weight=0.10,
                retention_weight=0.10,
            ),
            DepartmentType.CUSTOMER_SUCCESS: cls(
                customer_satisfaction_weight=0.40, retention_weight=0.30,
                revenue_weight=0.20, user_growth_weight=0.10,
            ),
        }
        return defaults.get(dept, cls(revenue_weight=1.0))


@dataclass
class DepartmentAgent(StrategicAgent):
    """
    部门级 Agent - 继承自 StrategicAgent，增加部门特征。
    """
    
    department_type: DepartmentType = DepartmentType.PRODUCT
    kpi: DepartmentKPI = field(default_factory=DepartmentKPI)
    decision_power: float = 0.5
    
    # 部门私有信息（其他部门看不到）
    private_signals: List[str] = field(default_factory=list)
    
    # 部门间关系（与其它部门 Agent 的协作/冲突强度）
    dept_relationships: Dict[str, float] = field(default_factory=dict)
    
    # 议价历史
    recent_proposals: List[Dict[str, Any]] = field(default_factory=list)
    
    def __post_init__(self):
        if not self.name:
            self.name = f"{DEPARTMENT_NAMES_CN.get(self.department_type, '部门')}-负责人"
        if not self.action_repertoire:
            self.action_repertoire = self._default_dept_actions()
        # If kpi is empty (all zeros), use default for this department
        if self.kpi.total_weight() == 0.0:
            self.kpi = DepartmentKPI.default_for(self.department_type)
        self.agent_type = AgentType.CORPORATE_EXEC
    
    def _default_dept_actions(self) -> List[str]:
        base = ["MAKE_STATEMENT", "PROPOSE_DEAL", "PRIVATE_MEETING"]
        dept_specific = {
            DepartmentType.SALES: ["TRADE_ASSET", "SPREAD_NARRATIVE"],
            DepartmentType.FINANCE: ["ACCUMULATE_POSITION", "FILE_DOCUMENT"],
            DepartmentType.TECH: ["FILE_DOCUMENT", "SHARE_INTEL"],
            DepartmentType.LEGAL: ["PUBLISH_REPORT", "COORDINATE_POSITION"],
            DepartmentType.MARKETING: ["SPREAD_NARRATIVE", "GATHER_INTEL"],
            DepartmentType.STRATEGY: ["PUBLISH_REPORT", "PROPOSE_DEAL", "FORM_COALITION"],
        }
        return base + dept_specific.get(self.department_type, [])
    
    def stance_on_topic(self, topic: str) -> float:
        """
        基于 KPI 权重计算本部门对某个议题的立场。
        返回 -1.0（强烈反对）到 1.0（强烈支持）。
        """
        topic_lower = topic.lower()
        score = 0.0
        
        if any(k in topic_lower for k in ["营收", "增长", "扩张", "市场", "revenue", "growth"]):
            score += self.kpi.revenue_weight * 1.0
        if any(k in topic_lower for k in ["利润", "毛利", "成本", "profit", "margin"]):
            score -= self.kpi.profit_margin_weight * 0.8
        if any(k in topic_lower for k in ["研发", "技术", "创新", "r&d", "rd", "innovation"]):
            score += self.kpi.tech_investment_weight * 0.9
        if any(k in topic_lower for k in ["合规", "风险", "compliance", "risk"]):
            score += self.kpi.compliance_weight * 0.7
        if any(k in topic_lower for k in ["降本", "裁员", "紧缩", "cut"]):
            score -= self.kpi.tech_investment_weight * 0.5
            score += self.kpi.cost_control_weight * 0.8
        if any(k in topic_lower for k in ["客户", "customer", "服务"]):
            score += self.kpi.customer_satisfaction_weight * 0.8
        if any(k in topic_lower for k in ["人才", "招聘", "talent"]):
            score += self.kpi.talent_acquisition_weight * 0.8
        if any(k in topic_lower for k in ["用户", "流量", "获客", "user"]):
            score += self.kpi.user_growth_weight * 0.7
        
        return max(-1.0, min(1.0, score))
    
    def to_dict(self) -> Dict[str, Any]:
        base = super().to_dict()
        base.update({
            "agent_kind": "department",
            "department_type": self.department_type.value,
            "department_name_cn": DEPARTMENT_NAMES_CN.get(self.department_type, ""),
            "kpi": self.kpi.to_dict(),
            "decision_power": self.decision_power,
            "private_signals_count": len(self.private_signals),
            "dept_relationships": self.dept_relationships,
            "recent_proposals_count": len(self.recent_proposals),
        })
        return base
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DepartmentAgent":
        dept_type = DepartmentType(data.get("department_type", "PRODUCT"))
        return cls(
            agent_id=data.get("agent_id", str(uuid4())),
            name=data.get("name", ""),
            agent_type=AgentType.CORPORATE_EXEC,
            department_type=dept_type,
            kpi=DepartmentKPI.default_for(dept_type),
            decision_power=data.get("decision_power", 0.5),
            private_signals=data.get("private_signals", []),
            dept_relationships=data.get("dept_relationships", {}),
            recent_proposals=data.get("recent_proposals", []),
        )
