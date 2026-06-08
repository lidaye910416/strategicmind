"""
Test that the report prompt builder:
- Renders in 简体中文
- Injects today's date (deterministic via env override)
- Uses Chinese section headers (一/二/三/四/五)
"""
import os
from datetime import datetime
from backend.app.agents.report_agent import ReportAgent


class _MockLLM:
    async def chat(self, messages, **kwargs):
        # 返回 messages 供测试断言
        return messages[-1]["content"]


def _make_agent() -> ReportAgent:
    return ReportAgent(tools=[], llm_provider=_MockLLM())


def test_prompt_is_chinese_and_uses_chinese_headers():
    agent = _make_agent()
    prompt = agent._build_report_prompt(
        context="Some test context with 12 rounds",
        style="executive",
        simulation_results={},
        user_params={"departments": ["销售", "技术"], "external_factors": ["竞品降价"]},
    )
    assert "简体中文" in prompt, "prompt must instruct Chinese"
    assert "执行摘要" in prompt, "must use Chinese section header 一、执行摘要"
    assert "关键发现" in prompt
    assert "战略建议" in prompt
    assert "风险评估" in prompt
    assert "近期行动" in prompt
    assert "报告日期" in prompt


def test_prompt_injects_today_date():
    agent = _make_agent()
    prompt = agent._build_report_prompt(
        context="ctx", style="technical",
        simulation_results={}, user_params={},
    )
    expected = datetime.now().strftime("%Y 年 %m 月 %d 日")
    assert expected in prompt, f"expected today's date '{expected}' in prompt"


def test_env_var_overrides_today_date():
    os.environ["STRATEGICMIND_REPORT_DATE_OVERRIDE"] = "2026 年 01 月 15 日"
    try:
        agent = _make_agent()
        prompt = agent._build_report_prompt(
            context="ctx", style="executive",
            simulation_results={}, user_params={},
        )
        assert "2026 年 01 月 15 日" in prompt
    finally:
        del os.environ["STRATEGICMIND_REPORT_DATE_OVERRIDE"]


def test_chinese_section_headers_used():
    """中文章节标题作为必含项, 英文章节不能作为指令性内容出现."""
    agent = _make_agent()
    prompt = agent._build_report_prompt(
        context="ctx", style="executive",
        simulation_results={}, user_params={},
    )
    # 必含中文标题 (markdown 二级)
    assert "## 一、执行摘要" in prompt
    assert "## 二、关键发现" in prompt
    assert "## 三、战略建议" in prompt
    assert "## 四、风险评估" in prompt
    assert "## 五、近期行动" in prompt
    # 不应有 "1. Executive Summary" 这种作为正文章节标题的写法
    assert "1. Executive Summary" not in prompt
    assert "2. Key Findings" not in prompt
