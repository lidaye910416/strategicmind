"""
部门感知配置生成器 - 在原 StrategicConfigGenerator 基础上增加部门建模。

基于种子文档识别公司类型，自动创建：
1. 部门 Agent 集群（产品/销售/技术/财务等）
2. 经营模式画像
3. 市场环境
4. 竞品 / 客户

Implements: US-207 部门感知配置
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field

from ..models.seed_document import SeedDocument
from ..models.business_model import BusinessModel, BusinessModelProfile
from ..models.department_agent import DepartmentType, DEPARTMENT_NAMES_CN
from ..models.market_environment import MarketEnvironmentAgent
from .company_orchestrator import CompanyContext
from .inter_department_resolver import InterDepartmentResolver


# 关键词 → 经营模式映射
KEYWORD_TO_BUSINESS_MODEL: List[tuple] = [
    (["政务", "国资", "国资委", "城投", "数字政府"], BusinessModel.STATE_OWNED),
    (["平台", "双边", "撮合", "marketplace"], BusinessModel.PLATFORM_BASED),
    (["SaaS", "订阅", "云服务", "云平台", "软件"], BusinessModel.PRODUCT_BASED),
    (["集成", "解决方案", "总包", "SI"], BusinessModel.INTEGRATION),
    (["项目", "工程", "施工", "交付", "咨询"], BusinessModel.PROJECT_BASED),
    (["咨询", "服务", "外包", "人力"], BusinessModel.SERVICE),
    (["制造", "工厂", "重资产", "设备"], BusinessModel.ASSET_HEAVY),
    (["电商", "贸易", "流通"], BusinessModel.ASSET_LIGHT),
]


@dataclass
class DepartmentAwareConfig:
    """部门感知的仿真配置"""
    seed_doc_id: str
    company_context: CompanyContext
    max_rounds: int = 10
    simulated_hours: int = 72
    metrics: List[str] = field(default_factory=list)
    topics: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "seed_doc_id": self.seed_doc_id,
            "max_rounds": self.max_rounds,
            "simulated_hours": self.simulated_hours,
            "metrics": self.metrics,
            "topics": self.topics,
            "company": self.company_context.to_dict(),
        }


class DepartmentAwareConfigGenerator:
    """
    部门感知的配置生成器。
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
    
    def generate(
        self,
        seed_doc: SeedDocument,
        requirement: str,
    ) -> DepartmentAwareConfig:
        """生成部门感知的仿真配置"""
        # 1. 推断经营模式
        business_model = self._infer_business_model(seed_doc)
        
        # 2. 搭建公司
        ctx = CompanyContext()
        ctx.setup_default_company(
            company_name=self._extract_company_name(seed_doc),
            business_model=business_model,
        )
        
        # 3. 定制部门（基于种子文档中的角色和话题）
        self._customize_departments(ctx, seed_doc, requirement)
        
        # 4. 推断市场环境
        self._infer_market_env(ctx, seed_doc, requirement)
        
        # 5. 添加竞品
        self._add_competitors(ctx, seed_doc, business_model)
        
        # 6. 添加客户
        self._add_customers(ctx, business_model)
        
        # 7. 提取仿真议题
        topics = self._extract_topics(seed_doc, requirement)
        
        # 8. 仿真配置
        return DepartmentAwareConfig(
            seed_doc_id=seed_doc.doc_id,
            company_context=ctx,
            max_rounds=self.config.get("max_rounds", 10),
            simulated_hours=self.config.get("simulated_hours", 72),
            metrics=[
                "营收", "毛利率", "客户满意度", "用户增长", "留存",
                "部门博弈分歧度", "市场环境适应性", "冲击韧性",
            ],
            topics=topics,
        )
    
    def _infer_business_model(self, seed_doc: SeedDocument) -> BusinessModel:
        """根据关键词推断经营模式"""
        full_text = " ".join(
            [seed_doc.title or ""] +
            [c.content for c in (seed_doc.claims or [])[:20]] +
            [seed_doc.content[:2000] if hasattr(seed_doc, 'content') else ""]
        )
        text_lower = full_text.lower()
        
        for keywords, model in KEYWORD_TO_BUSINESS_MODEL:
            for kw in keywords:
                if kw.lower() in text_lower:
                    return model
        
        return BusinessModel.PRODUCT_BASED  # 默认
    
    def _extract_company_name(self, seed_doc: SeedDocument) -> str:
        """从种子文档提取公司名"""
        # 优先用标题
        if seed_doc.title and len(seed_doc.title) < 50:
            return seed_doc.title
        # 从关键实体找
        for entity in (seed_doc.key_entities or []):
            if "company" in entity.entity_type.lower() or "组织" in entity.entity_type:
                return entity.text
        return "示例公司"
    
    def _customize_departments(
        self,
        ctx: CompanyContext,
        seed_doc: SeedDocument,
        requirement: str,
    ) -> None:
        """根据文档内容定制部门设置"""
        full_text = (seed_doc.title or "") + " " + (
            seed_doc.content[:3000] if hasattr(seed_doc, 'content') else ""
        )
        text_lower = full_text.lower()
        
        # 根据文档重点调整部门决策权
        for dept in ctx.departments:
            adjustment = 0.0
            
            # 文档强调技术 → 技术部话语权高
            if dept.department_type == DepartmentType.TECH and any(
                k in text_lower for k in ["技术", "研发", "科技", "创新", "数字化", "ai"]
            ):
                adjustment += 0.15
            
            # 文档强调市场/营收 → 销售/市场话语权高
            if dept.department_type in (DepartmentType.SALES, DepartmentType.MARKETING) and any(
                k in text_lower for k in ["市场", "营收", "增长", "份额", "客户"]
            ):
                adjustment += 0.15
            
            # 文档强调合规/政策 → 法务/战略话语权高
            if dept.department_type in (DepartmentType.LEGAL, DepartmentType.STRATEGY) and any(
                k in text_lower for k in ["政策", "合规", "国资", "监管", "战略"]
            ):
                adjustment += 0.20
            
            # 文档强调成本 → 财务话语权高
            if dept.department_type == DepartmentType.FINANCE and any(
                k in text_lower for k in ["利润", "成本", "预算", "降本", "增效"]
            ):
                adjustment += 0.15
            
            # 应用调整
            if adjustment != 0.0:
                dept.decision_power = max(0.1, min(1.0, dept.decision_power + adjustment))
    
    def _infer_market_env(
        self,
        ctx: CompanyContext,
        seed_doc: SeedDocument,
        requirement: str,
    ) -> None:
        """推断市场环境"""
        full_text = (seed_doc.title or "") + " " + (
            seed_doc.content[:3000] if hasattr(seed_doc, 'content') else ""
        )
        text_lower = full_text.lower()
        
        # 行业增速（基于关键词）
        if any(k in text_lower for k in ["高速增长", "爆发", "蓝海", "新增市场"]):
            ctx.market_env.sector_growth_rate = 0.15
        elif any(k in text_lower for k in ["红海", "竞争激烈", "增速放缓"]):
            ctx.market_env.sector_growth_rate = 0.04
        elif any(k in text_lower for k in ["稳定", "成熟"]):
            ctx.market_env.sector_growth_rate = 0.08
        
        # 政策立场
        if any(k in text_lower for k in ["政策支持", "鼓励", "补贴", "专项资金"]):
            ctx.market_env.policy_stance = ctx.market_env.policy_stance.__class__.SUPPORTIVE
        elif any(k in text_lower for k in ["限制", "管控", "监管收紧"]):
            ctx.market_env.policy_stance = ctx.market_env.policy_stance.__class__.RESTRICTIVE
    
    def _add_competitors(
        self,
        ctx: CompanyContext,
        seed_doc: SeedDocument,
        business_model: BusinessModel,
    ) -> None:
        """基于经营模式添加典型竞品"""
        competitors_by_model = {
            BusinessModel.STATE_OWNED: [
                ("地方平台公司 A", 0.15, "FOLLOWER", 0.3),
                ("民营科技公司 B", 0.20, "INNOVATION", 0.6),
            ],
            BusinessModel.PRODUCT_BASED: [
                ("头部 SaaS 厂商", 0.30, "DIFFERENTIATION", 0.6),
                ("新晋创业公司", 0.05, "PRICE_WAR", 0.8),
            ],
            BusinessModel.PLATFORM_BASED: [
                ("现有巨头平台", 0.40, "DEFENSIVE", 0.4),
                ("垂直领域新平台", 0.10, "INNOVATION", 0.7),
            ],
            BusinessModel.PROJECT_BASED: [
                ("传统集成商 A", 0.20, "FOLLOWER", 0.4),
                ("技术驱动新势力 B", 0.10, "INNOVATION", 0.6),
            ],
        }
        
        defaults = competitors_by_model.get(business_model, [
            ("竞品 A", 0.15, "FOLLOWER", 0.5),
            ("竞品 B", 0.10, "INNOVATION", 0.5),
        ])
        
        for name, share, strategy, aggressive in defaults:
            ctx.add_competitor(
                name=name,
                market_share=share,
                strategy=strategy,
                aggressiveness=aggressive,
            )
    
    def _add_customers(
        self,
        ctx: CompanyContext,
        business_model: BusinessModel,
    ) -> None:
        """基于经营模式添加典型客户群"""
        segments_by_model = {
            BusinessModel.STATE_OWNED: ["GOVERNMENT", "STATE_OWNED"],
            BusinessModel.PRODUCT_BASED: ["PRIVATE_ENTERPRISE", "SMB", "DEVELOPER"],
            BusinessModel.PLATFORM_BASED: ["PRIVATE_ENTERPRISE", "CONSUMER", "DEVELOPER"],
            BusinessModel.PROJECT_BASED: ["GOVERNMENT", "STATE_OWNED", "PRIVATE_ENTERPRISE"],
            BusinessModel.INTEGRATION: ["GOVERNMENT", "STATE_OWNED"],
        }
        
        segments = segments_by_model.get(business_model, ["PRIVATE_ENTERPRISE"])
        for seg in segments:
            ctx.add_customer_segment(segment=seg, count=2)
    
    def _extract_topics(
        self,
        seed_doc: SeedDocument,
        requirement: str,
    ) -> List[str]:
        """提取仿真议题"""
        topics = []
        
        # 从用户需求提取
        if requirement:
            topics.append(requirement[:80])
        
        # 从声明中提取
        for claim in (seed_doc.claims or [])[:5]:
            if claim.content:
                topics.append(claim.content[:80])
        
        # 通用战略议题
        topics.extend([
            "是否加大研发投入",
            "是否进入新市场",
            "是否提价/降价",
            "如何应对竞争",
            "是否进行组织调整",
        ])
        
        return topics[:10]
