"""
经营模式模型 - 把"项目制/产品制/平台型"等经营方式作为全局参数注入推演。

设计目的：
1. 同样的外部冲击，对不同经营模式产生完全不同的部门反应
2. 部门行动时考虑本公司的经营方式约束
3. 业务指标根据经营模式有不同的基准和变化率

Implements: US-201 经营模式建模
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any
from enum import Enum


class BusinessModel(str, Enum):
    """公司经营模式"""
    PROJECT_BASED = "PROJECT_BASED"          # 项目制（低复用、高定制）
    PRODUCT_BASED = "PRODUCT_BASED"          # 产品制（中复用、订阅）
    PLATFORM_BASED = "PLATFORM_BASED"        # 平台型（双边、网络效应）
    ASSET_HEAVY = "ASSET_HEAVY"              # 重资产（高 CapEx）
    ASSET_LIGHT = "ASSET_LIGHT"              # 轻资产（高 OpEx）
    INTEGRATION = "INTEGRATION"              # 系统集成（依赖伙伴生态）
    SERVICE = "SERVICE"                      # 服务型（人力密集）
    STATE_OWNED = "STATE_OWNED"              # 国资委导向型


# 经营模式中文名
BUSINESS_MODEL_NAMES_CN: Dict[BusinessModel, str] = {
    BusinessModel.PROJECT_BASED: "项目制",
    BusinessModel.PRODUCT_BASED: "产品制",
    BusinessModel.PLATFORM_BASED: "平台型",
    BusinessModel.ASSET_HEAVY: "重资产型",
    BusinessModel.ASSET_LIGHT: "轻资产型",
    BusinessModel.INTEGRATION: "系统集成",
    BusinessModel.SERVICE: "服务型",
    BusinessModel.STATE_OWNED: "国资导向型",
}


@dataclass
class BusinessModelProfile:
    """
    经营模式画像。
    
    关键参数：
    - margin_baseline: 基准毛利率
    - capex_intensity: 资本支出强度
    - decision_cycle_days: 决策周期
    - external_dependency: 外部依赖度（影响冲击传导）
    - shock_resilience: 抗冲击韧性
    - 部门反应系数: 不同部门在不同模式下的反应强度
    """
    
    model: BusinessModel = BusinessModel.PRODUCT_BASED
    
    # 财务特征
    margin_baseline: float = 0.30           # 基准毛利率 30%
    margin_volatility: float = 0.10         # 毛利率波动 10%
    capex_intensity: float = 0.20           # 资本支出强度 20%
    
    # 经营特征
    decision_cycle_days: int = 30           # 决策周期（天）
    external_dependency: float = 0.4       # 外部依赖度 0-1
    shock_resilience: float = 0.6           # 抗冲击韧性 0-1
    
    # 客户特征
    customer_concentration: float = 0.3     # 客户集中度（0=分散，1=极集中）
    contract_duration_months: int = 12      # 合同周期
    
    # 部门反应系数：经营模式对部门行为的影响
    # 例：项目制下销售部门话语权更高，平台型下技术部门话语权更高
    department_power_modifier: Dict[str, float] = field(default_factory=dict)
    
    # 部门决策速度修正（项目制销售快、产品制产品部门快等）
    department_speed_modifier: Dict[str, float] = field(default_factory=dict)
    
    # 部门 KPI 修正（不同模式对同一 KPI 重要性不同）
    kpi_priority_modifier: Dict[str, float] = field(default_factory=dict)
    
    @property
    def model_name_cn(self) -> str:
        """经营模式中文名"""
        return BUSINESS_MODEL_NAMES_CN.get(self.model, "")

    def get_department_power(self, dept_name: str) -> float:
        """获取经营模式对某部门话语权的影响"""
        return self.department_power_modifier.get(dept_name, 1.0)
    
    def get_department_speed(self, dept_name: str) -> float:
        """获取经营模式对某部门决策速度的影响"""
        return self.department_speed_modifier.get(dept_name, 1.0)
    
    def get_kpi_priority(self, kpi_name: str) -> float:
        """获取经营模式对某 KPI 优先级的修正"""
        return self.kpi_priority_modifier.get(kpi_name, 1.0)
    
    def shock_transmission_coefficient(self) -> float:
        """
        冲击传导系数。
        
        返回 0-1，表示外部冲击有多大比例会传导到本公司的业务指标。
        外部依赖度越高，传导越强；抗冲击韧性越高，传导越弱。
        """
        return max(0.0, min(1.0, self.external_dependency * (1.0 - self.shock_resilience * 0.5)))
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "model": self.model.value,
            "model_name_cn": self.model_name_cn,
            "margin_baseline": self.margin_baseline,
            "margin_volatility": self.margin_volatility,
            "capex_intensity": self.capex_intensity,
            "decision_cycle_days": self.decision_cycle_days,
            "external_dependency": self.external_dependency,
            "shock_resilience": self.shock_resilience,
            "customer_concentration": self.customer_concentration,
            "contract_duration_months": self.contract_duration_months,
            "department_power_modifier": self.department_power_modifier,
            "department_speed_modifier": self.department_speed_modifier,
            "kpi_priority_modifier": self.kpi_priority_modifier,
            "shock_transmission_coefficient": self.shock_transmission_coefficient(),
        }
    
    @classmethod
    def default_for(cls, model: BusinessModel) -> "BusinessModelProfile":
        """返回某经营模式的默认画像"""
        profiles = {
            BusinessModel.PROJECT_BASED: cls(
                model=model,
                margin_baseline=0.25,
                margin_volatility=0.15,
                capex_intensity=0.10,
                decision_cycle_days=14,
                external_dependency=0.6,
                shock_resilience=0.5,
                customer_concentration=0.5,
                contract_duration_months=6,
                department_power_modifier={
                    "SALES": 1.4, "TECH": 0.7, "PRODUCT": 0.8,
                    "FINANCE": 0.9, "OPERATIONS": 1.2, "STRATEGY": 0.9,
                },
                department_speed_modifier={
                    "SALES": 1.5, "OPERATIONS": 1.3, "TECH": 0.6,
                    "FINANCE": 0.7, "LEGAL": 0.6,
                },
                kpi_priority_modifier={
                    "营收": 1.3, "毛利率": 0.7, "客户满意度": 1.2,
                },
            ),
            BusinessModel.PRODUCT_BASED: cls(
                model=model,
                margin_baseline=0.60,
                margin_volatility=0.08,
                capex_intensity=0.15,
                decision_cycle_days=30,
                external_dependency=0.3,
                shock_resilience=0.7,
                customer_concentration=0.2,
                contract_duration_months=12,
                department_power_modifier={
                    "PRODUCT": 1.4, "TECH": 1.3, "MARKETING": 1.2,
                    "SALES": 0.8, "FINANCE": 1.0,
                },
                department_speed_modifier={
                    "PRODUCT": 1.3, "TECH": 1.0, "MARKETING": 1.1,
                    "FINANCE": 0.8, "LEGAL": 0.7,
                },
                kpi_priority_modifier={
                    "毛利率": 1.3, "用户增长": 1.2, "留存": 1.2, "营收": 0.9,
                },
            ),
            BusinessModel.PLATFORM_BASED: cls(
                model=model,
                margin_baseline=0.55,
                margin_volatility=0.12,
                capex_intensity=0.35,
                decision_cycle_days=45,
                external_dependency=0.5,
                shock_resilience=0.4,
                customer_concentration=0.3,
                contract_duration_months=24,
                department_power_modifier={
                    "TECH": 1.5, "PRODUCT": 1.3, "OPERATIONS": 1.2,
                    "STRATEGY": 1.1, "SALES": 0.7, "FINANCE": 0.9,
                },
                department_speed_modifier={
                    "TECH": 1.2, "PRODUCT": 1.1, "OPERATIONS": 1.0,
                    "FINANCE": 0.6, "LEGAL": 0.6,
                },
                kpi_priority_modifier={
                    "用户增长": 1.4, "留存": 1.3, "创新": 1.3, "研发投入": 1.2,
                },
            ),
            BusinessModel.STATE_OWNED: cls(
                model=model,
                margin_baseline=0.20,
                margin_volatility=0.10,
                capex_intensity=0.40,
                decision_cycle_days=60,
                external_dependency=0.7,
                shock_resilience=0.8,
                customer_concentration=0.6,
                contract_duration_months=36,
                department_power_modifier={
                    "STRATEGY": 1.4, "LEGAL": 1.3, "HR": 1.2,
                    "SALES": 0.7, "TECH": 0.8, "PRODUCT": 0.7,
                },
                department_speed_modifier={
                    "STRATEGY": 0.6, "LEGAL": 0.5, "FINANCE": 0.6,
                    "HR": 0.7, "OPERATIONS": 0.7,
                },
                kpi_priority_modifier={
                    "合规": 1.5, "风险控制": 1.4, "组织效率": 1.2, "营收": 0.8,
                },
            ),
            BusinessModel.INTEGRATION: cls(
                model=model,
                margin_baseline=0.22,
                margin_volatility=0.12,
                capex_intensity=0.15,
                decision_cycle_days=30,
                external_dependency=0.8,
                shock_resilience=0.4,
                customer_concentration=0.4,
                contract_duration_months=18,
                department_power_modifier={
                    "SALES": 1.3, "OPERATIONS": 1.2, "TECH": 1.1,
                    "PRODUCT": 0.8, "FINANCE": 0.9,
                },
                kpi_priority_modifier={
                    "客户满意度": 1.3, "营收": 1.2, "合规": 1.1,
                },
            ),
            BusinessModel.SERVICE: cls(
                model=model,
                margin_baseline=0.30,
                margin_volatility=0.08,
                capex_intensity=0.05,
                decision_cycle_days=21,
                external_dependency=0.5,
                shock_resilience=0.6,
                customer_concentration=0.4,
                contract_duration_months=12,
                department_power_modifier={
                    "HR": 1.3, "OPERATIONS": 1.2, "SALES": 1.1,
                    "TECH": 0.7,
                },
                kpi_priority_modifier={
                    "人才获取": 1.3, "组织效率": 1.2, "客户满意度": 1.2,
                },
            ),
            BusinessModel.ASSET_HEAVY: cls(
                model=model,
                margin_baseline=0.28,
                margin_volatility=0.10,
                capex_intensity=0.60,
                decision_cycle_days=90,
                external_dependency=0.6,
                shock_resilience=0.5,
                customer_concentration=0.3,
                contract_duration_months=60,
                department_power_modifier={
                    "FINANCE": 1.4, "OPERATIONS": 1.3, "STRATEGY": 1.2,
                    "TECH": 0.8, "SALES": 0.9,
                },
                kpi_priority_modifier={
                    "成本控制": 1.4, "风险控制": 1.3, "毛利率": 1.2,
                },
            ),
            BusinessModel.ASSET_LIGHT: cls(
                model=model,
                margin_baseline=0.40,
                margin_volatility=0.15,
                capex_intensity=0.10,
                decision_cycle_days=21,
                external_dependency=0.7,
                shock_resilience=0.3,
                customer_concentration=0.5,
                contract_duration_months=6,
                department_power_modifier={
                    "SALES": 1.3, "MARKETING": 1.2, "FINANCE": 1.1,
                    "TECH": 0.9,
                },
                kpi_priority_modifier={
                    "营收": 1.3, "毛利率": 1.1, "客户满意度": 1.1,
                },
            ),
        }
        return profiles.get(model, cls(model=model))
