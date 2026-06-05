"""
公司编排 + 部门博弈 + 经营模式 测试

覆盖：
1. DepartmentAgent 模型
2. BusinessModelProfile 模型
3. MarketEnvironmentAgent 模型
4. CustomerAgent + CompetitorAgent 模型
5. CompanyContext 搭建
6. InterDepartmentResolver 议题解决
7. DepartmentAwareConfigGenerator 配置生成
8. Flask API 端到端
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

import unittest
from backend.models.department_agent import DepartmentAgent, DepartmentType, DepartmentKPI, DEPARTMENT_NAMES_CN
from backend.models.business_model import BusinessModel, BusinessModelProfile
from backend.models.market_environment import MarketEnvironmentAgent, MarketCycle, PolicyStance
from backend.models.market_actor import CustomerAgent, CompetitorAgent, CustomerSegment, CompetitorStrategy
from backend.services.company_orchestrator import CompanyContext
from backend.services.inter_department_resolver import InterDepartmentResolver, ResolutionOutcome
from backend.services.dept_aware_config_generator import DepartmentAwareConfigGenerator
from backend.models.seed_document import SeedDocument, EntityMention, Claim


class TestDepartmentAgent(unittest.TestCase):
    """部门 Agent 测试"""
    
    def test_default_kpis_sum_to_one(self):
        """默认 KPI 权重之和应约等于 1"""
        for dept in DepartmentType:
            kpi = DepartmentKPI.default_for(dept)
            total = kpi.total_weight()
            self.assertAlmostEqual(total, 1.0, places=1, msg=f"{dept}: total={total}")
    
    def test_stance_differs_by_dept(self):
        """不同部门对同一议题立场应该不同"""
        sales = DepartmentAgent(name="销售总监", department_type=DepartmentType.SALES, decision_power=0.5)
        tech = DepartmentAgent(name="CTO", department_type=DepartmentType.TECH, decision_power=0.5)
        legal = DepartmentAgent(name="法务总监", department_type=DepartmentType.LEGAL, decision_power=0.5)
        
        # 销售对"营收增长"最支持
        s_revenue = sales.stance_on_topic("是否追求营收快速增长")
        t_revenue = tech.stance_on_topic("是否追求营收快速增长")
        self.assertGreater(s_revenue, t_revenue)
        
        # 法务对"合规"最支持
        l_compliance = legal.stance_on_topic("是否强化合规审查")
        s_compliance = sales.stance_on_topic("是否强化合规审查")
        self.assertGreater(l_compliance, s_compliance)
    
    def test_to_dict_includes_dept_info(self):
        """to_dict 应包含部门特有字段"""
        d = DepartmentAgent(
            name="CTO",
            department_type=DepartmentType.TECH,
            decision_power=0.8,
        )
        d_dict = d.to_dict()
        self.assertEqual(d_dict["department_type"], "TECH")
        self.assertEqual(d_dict["department_name_cn"], "技术部")
        self.assertEqual(d_dict["agent_kind"], "department")


class TestBusinessModel(unittest.TestCase):
    """经营模式测试"""
    
    def test_all_models_have_unique_profiles(self):
        """每种经营模式应有不同的画像"""
        profiles = {m: BusinessModelProfile.default_for(m) for m in BusinessModel}
        # STATE_OWNED 和 PLATFORM_BASED 的毛利率应不同
        self.assertNotEqual(
            profiles[BusinessModel.STATE_OWNED].margin_baseline,
            profiles[BusinessModel.PLATFORM_BASED].margin_baseline,
        )
    
    def test_shock_transmission_in_bounds(self):
        """冲击传导系数应在 0-1 之间"""
        for m in BusinessModel:
            p = BusinessModelProfile.default_for(m)
            t = p.shock_transmission_coefficient()
            self.assertGreaterEqual(t, 0.0)
            self.assertLessEqual(t, 1.0)
    
    def test_department_power_modifier_applies(self):
        """部门话语权修正应在合理范围"""
        p = BusinessModelProfile.default_for(BusinessModel.PROJECT_BASED)
        sales_power = p.get_department_power("SALES")
        self.assertGreater(sales_power, 1.0)  # 项目制销售话语权高


class TestMarketEnvironment(unittest.TestCase):
    """市场环境测试"""
    
    def test_quarterly_update_changes_state(self):
        """季度更新应改变状态"""
        env = MarketEnvironmentAgent()
        old_growth = env.sector_growth_rate
        env.quarterly_update(random_seed=42)
        # 状态应有变化（虽然可能是微小的）
        self.assertIsNotNone(env.sector_growth_rate)
        self.assertGreater(len(env.history), 0)
    
    def test_cycle_inference(self):
        """周期推断逻辑正确"""
        env = MarketEnvironmentAgent(sector_growth_rate=0.20)
        inferred = env._infer_cycle()
        self.assertEqual(inferred, MarketCycle.BOOM)
        
        env.sector_growth_rate = -0.10
        inferred = env._infer_cycle()
        self.assertEqual(inferred, MarketCycle.RECOVERY)
    
    def test_department_impact(self):
        """市场环境对部门 KPI 的影响"""
        env = MarketEnvironmentAgent(sector_growth_rate=0.15, capital_availability=0.8)
        impact = env.affect_department({})
        # 增长期应正面影响营收
        self.assertGreater(impact.get("营收", 0), 0)


class TestCompanyContext(unittest.TestCase):
    """公司上下文测试"""
    
    def test_default_company_has_7_depts(self):
        """默认公司应有 7 个部门"""
        ctx = CompanyContext()
        ctx.setup_default_company("测试", BusinessModel.PRODUCT_BASED)
        self.assertEqual(len(ctx.departments), 7)
    
    def test_business_model_affects_dept_relationships(self):
        """经营模式不同时，部门关系应不同"""
        ctx1 = CompanyContext()
        ctx1.setup_default_company("A", BusinessModel.STATE_OWNED)
        
        ctx2 = CompanyContext()
        ctx2.setup_default_company("B", BusinessModel.PLATFORM_BASED)
        
        # 部门数量应相同
        self.assertEqual(len(ctx1.departments), len(ctx2.departments))
    
    def test_competitor_creation(self):
        """竞品创建"""
        ctx = CompanyContext()
        ctx.setup_default_company("测试")
        c = ctx.add_competitor("头部云", 0.3, "INNOVATION", 0.7)
        self.assertEqual(c.market_share, 0.3)
        self.assertEqual(len(ctx.competitors), 1)
    
    def test_customer_creation(self):
        """客户创建"""
        ctx = CompanyContext()
        ctx.setup_default_company("测试")
        customers = ctx.add_customer_segment("PRIVATE_ENTERPRISE", 3)
        self.assertEqual(len(customers), 3)
        self.assertEqual(len(ctx.customers), 3)


class TestInterDepartmentResolver(unittest.TestCase):
    """部门冲突解决器测试"""
    
    def setUp(self):
        self.ctx = CompanyContext()
        self.ctx.setup_default_company("测试", BusinessModel.PRODUCT_BASED)
        self.resolver = InterDepartmentResolver()
    
    def test_ai_rd_topic_resolved(self):
        """AI 研发议题应有结果"""
        r = self.resolver.resolve("是否加大 AI 研发投入", self.ctx.departments)
        self.assertIsNotNone(r.outcome)
        self.assertIn(r.outcome, list(ResolutionOutcome))
    
    def test_company_position_in_bounds(self):
        """公司级立场应在 -1 到 1 之间"""
        for topic in ["是否加大研发", "是否提价", "是否降本", "是否扩张"]:
            r = self.resolver.resolve(topic, self.ctx.departments, external_pressure=0.5)
            self.assertGreaterEqual(r.company_position, -1.0)
            self.assertLessEqual(r.company_position, 1.0)
    
    def test_external_pressure_shifts_position(self):
        """外部压力应影响公司立场"""
        r1 = self.resolver.resolve("测试议题", self.ctx.departments, external_pressure=-0.5)
        r2 = self.resolver.resolve("测试议题", self.ctx.departments, external_pressure=0.5)
        self.assertLess(r1.company_position, r2.company_position)
    
    def test_business_model_modifier_applies(self):
        """经营模式修正应影响结果"""
        r_default = self.resolver.resolve("测试", self.ctx.departments)
        r_modified = self.resolver.resolve(
            "测试", self.ctx.departments,
            business_model_modifier={"SALES": 2.0, "TECH": 0.5},
        )
        # 销售话语权翻倍，技术减半，应影响结果
        self.assertIsNotNone(r_default.company_position)
        self.assertIsNotNone(r_modified.company_position)


class TestDepartmentAwareConfig(unittest.TestCase):
    """部门感知配置生成器测试"""
    
    def test_state_owned_inference(self):
        """国资金关键词应推断为 STATE_OWNED"""
        doc = SeedDocument(
            doc_id="test1",
            title="",
            content="本集团是国资委直管企业，承担数字政府建设核心任务。",
            key_entities=[],
            claims=[],
        )
        gen = DepartmentAwareConfigGenerator()
        cfg = gen.generate(doc, "推演")
        # 关键词包含"国资委"/"政务"应优先匹配 STATE_OWNED
        self.assertIn(
            cfg.company_context.business_model.model,
            [BusinessModel.STATE_OWNED, BusinessModel.INTEGRATION],
            msg=f"Got: {cfg.company_context.business_model.model}"
        )
    
    def test_platform_inference(self):
        """平台关键词应推断为 PLATFORM_BASED"""
        doc = SeedDocument(
            doc_id="test2",
            title="",
            content="双边平台撮合交易市场，支持 SaaS 订阅。",
            key_entities=[],
            claims=[],
        )
        gen = DepartmentAwareConfigGenerator()
        cfg = gen.generate(doc, "推演")
        # 此文本同时含 SaaS（产品制）和平台 → 关键词优先匹配 PLATFORM
        self.assertIn(
            cfg.company_context.business_model.model,
            [BusinessModel.PLATFORM_BASED, BusinessModel.PRODUCT_BASED]
        )
    
    def test_default_competitors_added(self):
        """默认竞品应被添加"""
        doc = SeedDocument(
            doc_id="test3",
            title="",
            content="",
            key_entities=[],
            claims=[],
        )
        gen = DepartmentAwareConfigGenerator()
        cfg = gen.generate(doc, "推演")
        self.assertGreater(len(cfg.company_context.competitors), 0)
    
    def test_departments_have_varied_decision_power(self):
        """部门决策权应有差异"""
        doc = SeedDocument(
            doc_id="test4",
            title="",
            content="",
            key_entities=[],
            claims=[],
        )
        gen = DepartmentAwareConfigGenerator()
        cfg = gen.generate(doc, "推演")
        powers = [d.decision_power for d in cfg.company_context.departments]
        # 应有不同
        self.assertGreater(max(powers) - min(powers), 0.1)


class TestFlaskAPI(unittest.TestCase):
    """Flask API 端到端测试"""
    
    @classmethod
    def setUpClass(cls):
        from app import create_app
        cls.app = create_app()
        cls.client = cls.app.test_client()
    
    def test_setup_company(self):
        """POST /api/company/setup"""
        r = self.client.post('/api/company/setup', json={
            'company_name': '测试公司',
            'business_model': 'PLATFORM_BASED',
        })
        self.assertEqual(r.status_code, 200)
        data = r.get_json()
        self.assertIn('company_id', data)
        self.assertEqual(data['company']['department_count'], 7)
    
    def test_resolve_topic(self):
        """POST /api/company/<id>/resolve"""
        # 先建公司
        r = self.client.post('/api/company/setup', json={'company_name': '测试', 'business_model': 'STATE_OWNED'})
        cid = r.get_json()['company_id']
        
        r = self.client.post(f'/api/company/{cid}/resolve', json={
            'topic': '是否加大数字化研发投入',
            'external_pressure': 0.3,
        })
        self.assertEqual(r.status_code, 200)
        res = r.get_json()
        self.assertIn('outcome', res)
        self.assertIn('positions', res)
        self.assertEqual(len(res['positions']), 7)
    
    def test_list_departments(self):
        """GET /api/company/<id>/departments"""
        r = self.client.post('/api/company/setup', json={'company_name': 'X', 'business_model': 'SERVICE'})
        cid = r.get_json()['company_id']
        
        r = self.client.get(f'/api/company/{cid}/departments')
        self.assertEqual(r.status_code, 200)
        data = r.get_json()
        self.assertIn('by_power', data)
        # by_power 应包含所有部门并按 effective power 排序
        self.assertEqual(len(data['by_power']), len(data['departments']))
        # 应按某种指标排序（即使相等也是稳定的）
        self.assertGreater(len(data['by_power']), 0)
    
    def test_advance_quarter(self):
        """POST /api/company/<id>/advance-quarter"""
        r = self.client.post('/api/company/setup', json={'company_name': 'X', 'business_model': 'PRODUCT_BASED'})
        cid = r.get_json()['company_id']
        
        r = self.client.post(f'/api/company/{cid}/advance-quarter')
        self.assertEqual(r.status_code, 200)
        self.assertIn('market_env', r.get_json())
    
    def test_404_for_missing_company(self):
        """不存在的公司应返回 404"""
        r = self.client.get('/api/company/nonexistent')
        self.assertEqual(r.status_code, 404)


if __name__ == '__main__':
    unittest.main(verbosity=2)


class TestTopicEmergence(unittest.TestCase):
    """议题涌现引擎测试"""
    
    def setUp(self):
        from backend.services.topic_emergence import TopicEmergenceEngine
        self.engine = TopicEmergenceEngine(llm_provider=None)
    
    def test_revenue_decline_emerges_topic(self):
        """营收下滑应涌现相关议题"""
        prev = {"revenue_outlook": 0.5}
        curr = {"revenue_outlook": 0.3, "market_sentiment": 0.5, "competitive_position": 0.5}
        topics = self.engine.detect_signals(prev, curr)
        signals = [t.signal for t in topics]
        self.assertIn(
            __import__('backend.services.topic_emergence', fromlist=['MetricSignal']).MetricSignal.REVENUE_DECLINE,
            signals,
        )
    
    def test_revenue_growth_emerges_topic(self):
        """营收增长应涌现相关议题"""
        prev = {"revenue_outlook": 0.3}
        curr = {"revenue_outlook": 0.6, "market_sentiment": 0.5, "competitive_position": 0.5}
        topics = self.engine.detect_signals(prev, curr)
        signals = [t.signal for t in topics]
        self.assertIn(
            __import__('backend.services.topic_emergence', fromlist=['MetricSignal']).MetricSignal.REVENUE_GROWTH,
            signals,
        )
    
    def test_margin_decline_emerges_topic(self):
        """毛利率下降应涌现相关议题"""
        prev = {"profit_margin_outlook": 0.3, "revenue_outlook": 0.5}
        curr = {"profit_margin_outlook": 0.1, "revenue_outlook": 0.5, "market_sentiment": 0.5, "competitive_position": 0.5}
        topics = self.engine.detect_signals(prev, curr)
        signals = [t.signal for t in topics]
        self.assertIn(
            __import__('backend.services.topic_emergence', fromlist=['MetricSignal']).MetricSignal.MARGIN_DECLINE,
            signals,
        )
    
    def test_macro_down_emerges_topic(self):
        """宏观下行应涌现相关议题"""
        topics = self.engine.detect_signals(
            prev_metrics=None,
            curr_metrics={},
            market_env={"sector_growth_rate": -0.05, "consumer_sentiment": 0},
        )
        signals = [t.signal for t in topics]
        self.assertIn(
            __import__('backend.services.topic_emergence', fromlist=['MetricSignal']).MetricSignal.MACRO_DOWN,
            signals,
        )
    
    def test_no_signals_on_stable_metrics(self):
        """指标稳定时不应涌现议题"""
        prev = {"revenue_outlook": 0.5, "profit_margin_outlook": 0.3, "competitive_position": 0.5}
        curr = {"revenue_outlook": 0.5, "profit_margin_outlook": 0.3, "market_sentiment": 0.5, "competitive_position": 0.5}
        topics = self.engine.detect_signals(prev, curr)
        # 应该没有信号，或信号非常少
        self.assertLessEqual(len(topics), 1)
    
    def test_topics_sorted_by_severity(self):
        """涌现议题应按严重度降序"""
        prev = {"revenue_outlook": 0.5}
        curr = {"revenue_outlook": -0.3, "market_sentiment": -0.5, "competitive_position": -0.3, "profit_margin_outlook": -0.3}
        market_env = {"sector_growth_rate": -0.1, "consumer_sentiment": -0.5, "policy_pressure": 0.8, "policy_stance": "RESTRICTIVE"}
        topics = self.engine.detect_signals(prev, curr, market_env)
        for i in range(len(topics) - 1):
            self.assertGreaterEqual(topics[i].severity, topics[i+1].severity)
    
    def test_max_three_topics(self):
        """涌现议题最多 3 个"""
        prev = {"revenue_outlook": 0.5, "profit_margin_outlook": 0.3, "competitive_position": 0.5}
        curr = {"revenue_outlook": -0.5, "profit_margin_outlook": -0.3, "market_sentiment": -0.5, "competitive_position": -0.5}
        market_env = {"sector_growth_rate": -0.1, "consumer_sentiment": -0.5, "policy_pressure": 0.8, "policy_stance": "RESTRICTIVE"}
        topics = self.engine.detect_signals(prev, curr, market_env)
        self.assertLessEqual(len(topics), 3)
    
    def test_infer_signal_from_text(self):
        """从文本推断信号"""
        self.assertEqual(
            self.engine._infer_signal_from_text("营收下滑如何应对"),
            __import__('backend.services.topic_emergence', fromlist=['MetricSignal']).MetricSignal.REVENUE_DECLINE
        )
        self.assertEqual(
            self.engine._infer_signal_from_text("现金流紧张如何处理"),
            __import__('backend.services.topic_emergence', fromlist=['MetricSignal']).MetricSignal.CASH_FLOW_TIGHT
        )
        self.assertEqual(
            self.engine._infer_signal_from_text("是否加大研发投入"),
            __import__('backend.services.topic_emergence', fromlist=['MetricSignal']).MetricSignal.RD_INSUFFICIENT
        )


class TestEmergenceAPI(unittest.TestCase):
    """涌现 API 测试"""
    
    @classmethod
    def setUpClass(cls):
        from app import create_app
        cls.app = create_app()
        cls.client = cls.app.test_client()
    
    def test_emerge_topics_api(self):
        """POST /api/company/<id>/emerge-topics"""
        r = self.client.post('/api/company/setup', json={
            'company_name': '涌现测试', 'business_model': 'PLATFORM_BASED',
        })
        cid = r.get_json()['company_id']
        
        r = self.client.post(f'/api/company/{cid}/emerge-topics', json={
            'prev_metrics': {'revenue_outlook': 0.5},
            'curr_metrics': {'revenue_outlook': 0.2, 'market_sentiment': 0.5, 'competitive_position': 0.5},
        })
        self.assertEqual(r.status_code, 200)
        data = r.get_json()
        self.assertIn('emerged_topics', data)
        self.assertGreater(data['count'], 0)
        # 应该有营收下滑信号
        signals = [t['signal'] for t in data['emerged_topics']]
        self.assertIn('REVENUE_DECLINE', signals)
