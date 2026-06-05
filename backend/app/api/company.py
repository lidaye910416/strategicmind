"""
公司编排 API - 提供公司级配置、市场环境、部门建模的 REST 接口。

Endpoints:
- POST /api/company/setup - 初始化一个公司（部门 + 经营模式 + 市场环境）
- GET /api/company/<id> - 获取公司配置
- POST /api/company/<id>/resolve - 解决一个议题（部门博弈）
- GET /api/company/<id>/departments - 列出所有部门
- POST /api/company/<id>/add-competitor - 添加竞争对手
- POST /api/company/<id>/add-customers - 添加客户

Implements: US-206 公司级 API
"""

from flask import Blueprint, request, jsonify
import uuid
from typing import Dict, Any

from backend.models.business_model import BusinessModel
from backend.models.market_actor import CustomerSegment, CompetitorStrategy
from backend.services.company_orchestrator import CompanyContext
from backend.services.inter_department_resolver import InterDepartmentResolver


company_bp = Blueprint("company", __name__, url_prefix="/api/company")

# 进程内公司存储（生产环境可换 Redis / DB）
_COMPANY_REGISTRY: Dict[str, CompanyContext] = {}


def _to_json_safe(obj: Any) -> Any:
    """递归转换为可 JSON 序列化的对象"""
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    if isinstance(obj, dict):
        return {k: _to_json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_json_safe(v) for v in obj]
    if hasattr(obj, "value"):  # Enum
        return obj.value
    return obj


@company_bp.route("/setup", methods=["POST"])
def setup_company():
    """初始化一个公司配置"""
    data = request.get_json() or {}
    company_name = data.get("company_name", "示例公司")
    business_model = data.get("business_model", "PRODUCT_BASED")
    
    try:
        bm = BusinessModel(business_model)
    except ValueError:
        return jsonify({"error": f"未知经营模式: {business_model}"}), 400
    
    ctx = CompanyContext()
    ctx.setup_default_company(company_name=company_name, business_model=bm)
    
    # 可选：加入默认竞品
    competitors = data.get("competitors", [])
    for c in competitors:
        ctx.add_competitor(
            name=c.get("name", "竞品"),
            market_share=c.get("market_share", 0.1),
            strategy=c.get("strategy", "FOLLOWER"),
            aggressiveness=c.get("aggressiveness", 0.5),
        )
    
    # 可选：加入默认客户
    customer_segments = data.get("customer_segments", ["PRIVATE_ENTERPRISE", "GOVERNMENT"])
    for seg in customer_segments:
        try:
            ctx.add_customer_segment(segment=seg, count=2)
        except ValueError:
            pass
    
    _COMPANY_REGISTRY[ctx.company_id] = ctx
    
    return jsonify({
        "company_id": ctx.company_id,
        "company_name": ctx.company_name,
        "company": _to_json_safe(ctx),
    })


@company_bp.route("/<company_id>", methods=["GET"])
def get_company(company_id: str):
    """获取公司完整配置"""
    ctx = _COMPANY_REGISTRY.get(company_id)
    if not ctx:
        return jsonify({"error": "公司不存在"}), 404
    return jsonify(_to_json_safe(ctx))


@company_bp.route("/<company_id>/departments", methods=["GET"])
def list_departments(company_id: str):
    """列出公司所有部门"""
    ctx = _COMPANY_REGISTRY.get(company_id)
    if not ctx:
        return jsonify({"error": "公司不存在"}), 404
    
    return jsonify({
        "company_id": company_id,
        "departments": [_to_json_safe(d) for d in ctx.departments],
        "by_power": [
            _to_json_safe(d) for d in ctx.get_departments_by_power()
        ],
    })


@company_bp.route("/<company_id>/resolve", methods=["POST"])
def resolve_topic(company_id: str):
    """解决一个战略议题（部门博弈）"""
    ctx = _COMPANY_REGISTRY.get(company_id)
    if not ctx:
        return jsonify({"error": "公司不存在"}), 404
    
    data = request.get_json() or {}
    topic = data.get("topic", "")
    if not topic:
        return jsonify({"error": "议题不能为空"}), 400
    
    external_pressure = float(data.get("external_pressure", 0.0))
    
    resolver = InterDepartmentResolver()
    resolution = resolver.resolve(
        topic=topic,
        departments=ctx.departments,
        external_pressure=external_pressure,
        business_model_modifier=ctx.business_model.department_power_modifier,
    )
    
    # 记录到公司历史
    ctx.resolution_history.append(_to_json_safe(resolution))
    
    return jsonify(_to_json_safe(resolution))


@company_bp.route("/<company_id>/add-competitor", methods=["POST"])
def add_competitor(company_id: str):
    """添加竞争对手"""
    ctx = _COMPANY_REGISTRY.get(company_id)
    if not ctx:
        return jsonify({"error": "公司不存在"}), 404
    
    data = request.get_json() or {}
    comp = ctx.add_competitor(
        name=data.get("name", "新竞品"),
        market_share=float(data.get("market_share", 0.1)),
        strategy=data.get("strategy", "FOLLOWER"),
        aggressiveness=float(data.get("aggressiveness", 0.5)),
    )
    return jsonify({"added": _to_json_safe(comp)})


@company_bp.route("/<company_id>/add-customers", methods=["POST"])
def add_customers(company_id: str):
    """添加客户群"""
    ctx = _COMPANY_REGISTRY.get(company_id)
    if not ctx:
        return jsonify({"error": "公司不存在"}), 404
    
    data = request.get_json() or {}
    segment = data.get("segment", "PRIVATE_ENTERPRISE")
    count = int(data.get("count", 1))
    
    customers = ctx.add_customer_segment(segment=segment, count=count)
    return jsonify({
        "added_count": len(customers),
        "total_customers": len(ctx.customers),
    })


@company_bp.route("/<company_id>/advance-quarter", methods=["POST"])
def advance_quarter(company_id: str):
    """推进一个季度的市场环境"""
    ctx = _COMPANY_REGISTRY.get(company_id)
    if not ctx:
        return jsonify({"error": "公司不存在"}), 404
    
    changes = ctx.market_env.quarterly_update()
    return jsonify({
        "company_id": company_id,
        "market_env": _to_json_safe(ctx.market_env),
        "changes": changes,
    })


@company_bp.route("/<company_id>/department-stance", methods=["POST"])
def department_stance(company_id: str):
    """查询部门对某议题的立场"""
    ctx = _COMPANY_REGISTRY.get(company_id)
    if not ctx:
        return jsonify({"error": "公司不存在"}), 404
    
    data = request.get_json() or {}
    topic = data.get("topic", "")
    if not topic:
        return jsonify({"error": "议题不能为空"}), 400
    
    result = []
    for dept in ctx.departments:
        stance = dept.stance_on_topic(topic)
        result.append({
            "dept_type": dept.department_type.value,
            "dept_name": dept.name,
            "stance": stance,
            "stance_label": (
                "强烈支持" if stance > 0.5 else
                "支持" if stance > 0.2 else
                "中立" if stance > -0.2 else
                "反对" if stance > -0.5 else
                "强烈反对"
            ),
        })
    
    return jsonify({
        "company_id": company_id,
        "topic": topic,
        "positions": result,
    })


@company_bp.route("/<company_id>/simulate", methods=["POST"])
def simulate_company(company_id: str):
    """运行公司感知仿真（多回合部门博弈）"""
    ctx = _COMPANY_REGISTRY.get(company_id)
    if not ctx:
        return jsonify({"error": "公司不存在"}), 404
    
    data = request.get_json() or {}
    max_rounds = int(data.get("max_rounds", 4))
    topics = data.get("topics", [
        "是否加大 AI 研发投入",
        "是否拓展新市场",
        "是否提价保住毛利率",
        "如何应对竞争",
    ])
    
    from backend.services.inter_department_resolver import InterDepartmentResolver
    resolver = InterDepartmentResolver()
    round_results = []
    
    for i in range(max_rounds):
        topic = topics[i % len(topics)]
        # 外部压力随回合变化（模拟不同情境）
        pressure = 0.1 + i * 0.1
        resolution = resolver.resolve(
            topic=topic,
            departments=ctx.departments,
            external_pressure=pressure,
            business_model_modifier=ctx.business_model.department_power_modifier,
        )
        # 记录到公司历史
        ctx.resolution_history.append(_to_json_safe(resolution))
        round_results.append({
            "round_num": i + 1,
            "topic": topic,
            "external_pressure": pressure,
            "resolution": _to_json_safe(resolution),
        })
    
    # 业务指标快照（基于结果统计）
    from collections import Counter
    outcomes = [r["resolution"]["outcome"] for r in round_results]
    outcome_dist = dict(Counter(outcomes))
    
    return jsonify({
        "company_id": company_id,
        "mode": "company_aware",
        "max_rounds": max_rounds,
        "round_results": round_results,
        "summary": {
            "outcome_distribution": outcome_dist,
            "company_name": ctx.company_name,
            "business_model": ctx.business_model.model_name_cn,
        },
    })


@company_bp.route("/<company_id>/department-distribution", methods=["GET"])
def department_distribution(company_id: str):
    """获取部门立场分布汇总（用于报告）"""
    ctx = _COMPANY_REGISTRY.get(company_id)
    if not ctx:
        return jsonify({"error": "公司不存在"}), 404
    
    outcome_dist: Dict[str, int] = {}
    position_by_dept: Dict[str, List[float]] = {}
    
    for res in ctx.resolution_history:
        if not isinstance(res, dict):
            continue
        outcome = res.get("outcome", "DEFERRED")
        outcome_dist[outcome] = outcome_dist.get(outcome, 0) + 1
        
        for pos in res.get("positions", []):
            dept = pos.get("dept_type", "UNKNOWN")
            position_by_dept.setdefault(dept, []).append(pos.get("position", 0))
    
    dept_avg = {}
    for dept, positions in position_by_dept.items():
        avg = sum(positions) / len(positions) if positions else 0
        dept_avg[dept] = {
            "avg_position": avg,
            "sample_count": len(positions),
            "stance_label": (
                "支持倾向" if avg > 0.2 else
                "反对倾向" if avg < -0.2 else
                "中立"
            ),
        }
    
    return jsonify({
        "company_id": company_id,
        "company_name": ctx.company_name,
        "business_model": ctx.business_model.model_name_cn,
        "total_resolutions": len(ctx.resolution_history),
        "outcome_distribution": outcome_dist,
        "department_stance_summary": dept_avg,
    })


@company_bp.route("/<company_id>/report", methods=["GET"])
def get_company_report(company_id: str):
    """生成公司级仿真报告（Markdown）"""
    ctx = _COMPANY_REGISTRY.get(company_id)
    if not ctx:
        return jsonify({"error": "公司不存在"}), 404
    
    from backend.services.company_report_generator import CompanyReportGenerator
    generator = CompanyReportGenerator(ctx)
    report = generator.generate()
    
    format_type = request.args.get("format", "json")
    if format_type == "markdown":
        md = report.to_markdown()
        return md, 200, {"Content-Type": "text/markdown; charset=utf-8"}
    
    return jsonify(report.to_dict())


@company_bp.route("/<company_id>/report/download", methods=["GET"])
def download_company_report(company_id: str):
    """下载公司级报告（Markdown 文件）"""
    ctx = _COMPANY_REGISTRY.get(company_id)
    if not ctx:
        return jsonify({"error": "公司不存在"}), 404
    
    from backend.services.company_report_generator import CompanyReportGenerator
    from flask import Response
    generator = CompanyReportGenerator(ctx)
    report = generator.generate()
    md = report.to_markdown()
    
    # 添加 UTF-8 BOM 让 Windows Excel 也能正确识别中文
    bom_md = "﻿" + md
    
    filename = f"{ctx.company_name}-部门博弈推演报告.md"
    
    return Response(
        bom_md,
        mimetype="text/markdown",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{filename}",
            "Content-Type": "text/markdown; charset=utf-8",
        },
    )



@company_bp.route("/<company_id>/interview/agents", methods=["GET"])
def list_interview_agents(company_id: str):
    """列出可采访的所有 Agent（部门/竞品/客户）"""
    ctx = _COMPANY_REGISTRY.get(company_id)
    if not ctx:
        return jsonify({"error": "公司不存在"}), 404
    
    from backend.services.agent_interview import AgentInterviewService
    
    # Get LLM provider (best effort)
    try:
        from backend.services.llm_factory import get_llm_provider
        llm = get_llm_provider()
    except Exception:
        llm = None
    
    if llm is None:
        # Fallback: return agent list without LLM
        from backend.services.agent_interview import AgentInterviewService
        class DummyLLM:
            async def chat(self, messages):
                return "[LLM 不可用]"
        llm = DummyLLM()
    
    service = AgentInterviewService(ctx, llm)
    return jsonify({
        "company_id": company_id,
        "interviewable_agents": service.list_interviewable_agents(),
    })


@company_bp.route("/<company_id>/interview", methods=["POST"])
def interview_agent(company_id: str):
    """采访指定 Agent"""
    ctx = _COMPANY_REGISTRY.get(company_id)
    if not ctx:
        return jsonify({"error": "公司不存在"}), 404
    
    data = request.get_json() or {}
    agent_id = data.get("agent_id", "")
    question = data.get("question", "")
    
    if not agent_id or not question:
        return jsonify({"error": "agent_id 和 question 必填"}), 400
    
    from backend.services.agent_interview import AgentInterviewService
    
    try:
        from backend.services.llm_factory import get_llm_provider
        llm = get_llm_provider()
    except Exception:
        class DummyLLM:
            async def chat(self, messages):
                # 简单 fallback：基于 Agent 角色生成模板化回答
                sys_prompt = messages[0]["content"] if messages else ""
                user_msg = messages[1]["content"] if len(messages) > 1 else ""
                
                if "战略部" in sys_prompt or "STRATEGY" in sys_prompt:
                    return f"作为战略发展部，我认为这个问题需要从公司中长期布局角度审视。基于当前 {ctx.business_model.model_name_cn} 的经营模式，我们应当平衡短期收益和长期价值。"
                elif "技术部" in sys_prompt or "TECH" in sys_prompt:
                    return f"从技术部角度，我们更关注技术可行性和研发投入产出比。任何重大决策都需要评估对技术债务和创新能力的影响。"
                elif "销售部" in sys_prompt or "SALES" in sys_prompt:
                    return f"销售部立场很明确：能否带来营收增长？客户买不买账？市场反馈如何？"
                elif "财务部" in sys_prompt or "FINANCE" in sys_prompt:
                    return f"财务部关心的是 ROI、毛利率影响和现金流。任何决策都需要明确的财务模型支持。"
                elif "竞品" in sys_prompt or "COMPETITOR" in sys_prompt:
                    return f"作为竞争对手，我们的策略是 {ctx.competitors[0].strategy.value if ctx.competitors else 'FOLLOWER'}。我们会对该公司的动作做出应对：可能跟进、可能观望、可能加速差异化。"
                else:
                    return f"基于我的角色和 KPI，我对这个问题持 [支持/反对/中立] 态度，需要更多数据才能给出明确建议。"
        llm = DummyLLM()
    
    service = AgentInterviewService(ctx, llm)
    
    import asyncio
    msg = asyncio.run(service.ask(agent_id, question))
    return jsonify({
        "agent_id": agent_id,
        "message": msg.to_dict(),
        "history_count": len(service.get_conversation(agent_id)),
    })


@company_bp.route("/<company_id>/interview/<agent_id>/history", methods=["GET"])
def get_interview_history(company_id: str, agent_id: str):
    """获取与某 Agent 的采访历史"""
    ctx = _COMPANY_REGISTRY.get(company_id)
    if not ctx:
        return jsonify({"error": "公司不存在"}), 404
    
    from backend.services.agent_interview import AgentInterviewService
    
    try:
        from backend.services.llm_factory import get_llm_provider
        llm = get_llm_provider()
    except Exception:
        class DummyLLM:
            async def chat(self, messages): return ""
        llm = DummyLLM()
    
    service = AgentInterviewService(ctx, llm)
    history = service.get_conversation(agent_id)
    return jsonify({
        "agent_id": agent_id,
        "history": [m.to_dict() for m in history],
    })
