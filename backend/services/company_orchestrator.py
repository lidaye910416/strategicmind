"""
公司编排器 - 把公司视为多个部门 + 经营模式 + 市场环境的协调整体。

设计目的：
1. 统一管理公司内部的部门 Agent、市场环境、客户、竞品
2. 提供"公司级决策"的入口（在推演每个回合）
3. 让推演从"个人 Agent 行动"升级为"公司整体协同"

Implements: US-205 公司级编排
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional
from enum import Enum
from uuid import uuid4

from ..models.strategic_agent import StrategicAgent, AgentType
from ..models.department_agent import (
    DepartmentAgent, DepartmentType, DEPARTMENT_NAMES_CN, DepartmentKPI,
)
from ..models.business_model import BusinessModelProfile, BusinessModel
from ..models.market_environment import MarketEnvironmentAgent
from ..models.market_actor import CustomerAgent, CompetitorAgent


@dataclass
class CompanyContext:
    """
    公司经营推演的统一上下文。
    
    包含：
    - 部门 Agent 集群
    - 经营模式画像
    - 市场环境
    - 客户/竞品集群
    - 推演配置
    """
    
    company_id: str = field(default_factory=lambda: f"co_{uuid4().hex[:8]}")
    company_name: str = "示例公司"
    
    # 部门 Agent
    departments: List[DepartmentAgent] = field(default_factory=list)
    
    # 经营模式
    business_model: BusinessModelProfile = field(default_factory=BusinessModelProfile)
    
    # 市场环境
    market_env: MarketEnvironmentAgent = field(default_factory=MarketEnvironmentAgent)
    
    # 客户/竞品
    customers: List[CustomerAgent] = field(default_factory=list)
    competitors: List[CompetitorAgent] = field(default_factory=list)
    
    # 业务指标快照
    business_metrics_history: List[Dict[str, Any]] = field(default_factory=list)
    
    # 部门议价历史
    resolution_history: List[Dict[str, Any]] = field(default_factory=list)
    
    def get_department(self, dept_type: DepartmentType) -> Optional[DepartmentAgent]:
        for d in self.departments:
            if d.department_type == dept_type:
                return d
        return None
    
    def get_departments_by_power(self) -> List[DepartmentAgent]:
        return sorted(
            self.departments,
            key=lambda d: d.decision_power * self.business_model.get_department_power(d.department_type.value),
            reverse=True,
        )
    
    def setup_default_company(
        self,
        company_name: str = "示例公司",
        business_model: BusinessModel = BusinessModel.PRODUCT_BASED,
    ) -> None:
        """
        用默认配置搭建一个标准公司。
        """
        self.company_name = company_name
        self.business_model = BusinessModelProfile.default_for(business_model)
        
        # 默认部门：核心 7 个
        default_depts = [
            (DepartmentType.PRODUCT, "张明", 0.6),
            (DepartmentType.SALES, "李强", 0.7),
            (DepartmentType.TECH, "王芳", 0.6),
            (DepartmentType.FINANCE, "陈静", 0.5),
            (DepartmentType.HR, "刘洋", 0.4),
            (DepartmentType.LEGAL, "赵敏", 0.3),
            (DepartmentType.STRATEGY, "周伟", 0.7),
        ]
        
        for dept_type, name, power in default_depts:
            dept = DepartmentAgent(
                name=f"{name}-{DEPARTMENT_NAMES_CN[dept_type]}",
                department_type=dept_type,
                kpi=DepartmentKPI.default_for(dept_type),
                decision_power=power,
            )
            # 设置初始兴趣
            dept.interests.primary_interests = [
                f"{DEPARTMENT_NAMES_CN[dept_type]}核心目标：完成 KPI",
            ]
            self.departments.append(dept)
        
        # 部门间关系（现实中的典型冲突/协作）
        self._setup_dept_relationships()
    
    def _setup_dept_relationships(self) -> None:
        """设置部门间典型关系"""
        # 销售 vs 财务（冲量 vs 保利润）
        sales = self.get_department(DepartmentType.SALES)
        finance = self.get_department(DepartmentType.FINANCE)
        if sales and finance:
            sales.dept_relationships[finance.agent_id] = -0.4
            finance.dept_relationships[sales.agent_id] = -0.4
        
        # 产品 vs 技术（理想 vs 实现）
        product = self.get_department(DepartmentType.PRODUCT)
        tech = self.get_department(DepartmentType.TECH)
        if product and tech:
            product.dept_relationships[tech.agent_id] = 0.2
            tech.dept_relationships[product.agent_id] = 0.2
        
        # 战略部 vs 销售（长 vs 短）
        strategy = self.get_department(DepartmentType.STRATEGY)
        if strategy and sales:
            strategy.dept_relationships[sales.agent_id] = -0.1
            sales.dept_relationships[strategy.agent_id] = -0.1
    
    def add_competitor(
        self,
        name: str,
        market_share: float = 0.1,
        strategy: str = "FOLLOWER",
        aggressiveness: float = 0.5,
    ) -> CompetitorAgent:
        """添加竞争对手"""
        from ..models.market_actor import CompetitorStrategy
        comp = CompetitorAgent(
            name=name,
            name_label=name,
            agent_type=AgentType.COMPETITOR,
            market_share=market_share,
            strategy=CompetitorStrategy(strategy),
            aggressiveness=aggressiveness,
        )
        self.competitors.append(comp)
        return comp
    
    def add_customer_segment(
        self,
        segment: str = "PRIVATE_ENTERPRISE",
        count: int = 1,
    ) -> List[CustomerAgent]:
        """添加客户细分"""
        from ..models.market_actor import CustomerSegment
        customers = []
        for i in range(count):
            c = CustomerAgent(
                segment=CustomerSegment(segment),
                satisfaction_score=0.5,
            )
            customers.append(c)
        self.customers.extend(customers)
        return customers
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "company_id": self.company_id,
            "company_name": self.company_name,
            "departments": [d.to_dict() for d in self.departments],
            "department_count": len(self.departments),
            "business_model": self.business_model.to_dict(),
            "market_env": self.market_env.to_dict(),
            "customers_count": len(self.customers),
            "competitors_count": len(self.competitors),
            "competitors": [c.to_dict() for c in self.competitors[:5]],
            "business_metrics_history_count": len(self.business_metrics_history),
            "resolution_history_count": len(self.resolution_history),
        }
