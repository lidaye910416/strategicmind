"""
SeedAnalyzer 单测 — 覆盖 coerce 函数 (4 类) + LLM 集成路径
"""
import json
import pytest
from backend.services.seed_analyzer import (
    SeedAnalyzer, _coerce_number, _coerce_int, _coerce_stance,
    _coerce_string_list, _coerce_org, _coerce_financials, _coerce_market,
    _safe_strip_json,
)


# ====== 纯函数测试 ======

class TestCoerceNumber:
    def test_int(self):
        assert _coerce_number(5) == 5.0

    def test_float(self):
        assert _coerce_number(3.14) == 3.14

    def test_string_with_unit(self):
        assert _coerce_number("5.8亿") == 5.8
        assert _coerce_number("12 个月") == 12.0
        # "3-5" → 数字字符留下 "3-5", float() 失败 → 返 None
        assert _coerce_number("3-5 个") is None

    def test_empty(self):
        assert _coerce_number("") is None
        assert _coerce_number(None) is None
        assert _coerce_number("-") is None

    def test_negative(self):
        assert _coerce_number("-15") == -15.0


class TestCoerceStance:
    def test_english(self):
        assert _coerce_stance("supportive") == "supportive"
        assert _coerce_stance("neutral") == "neutral"
        assert _coerce_stance("restrictive") == "restrictive"

    def test_chinese(self):
        assert _coerce_stance("利好") == "supportive"
        assert _coerce_stance("不利") == "restrictive"

    def test_unknown(self):
        assert _coerce_stance("乱写") == "neutral"
        assert _coerce_stance(None) == "neutral"


class TestCoerceStringList:
    def test_list(self):
        assert _coerce_string_list(["a", "b", ""]) == ["a", "b"]

    def test_string_with_separators(self):
        assert _coerce_string_list("a\nb; c，d") == ["a", "b", "c", "d"]

    def test_empty(self):
        assert _coerce_string_list([]) == []
        assert _coerce_string_list("") == []


class TestCoerceOrg:
    def test_basic(self):
        result = _coerce_org([
            {"name": "销售部", "headcount": 50, "kpi_focus": "营收"},
            {"name": "技术部", "reports_to": "CEO", "headcount": 100},
        ])
        assert len(result) == 2
        assert result[0]["name"] == "销售部"
        assert result[0]["headcount"] == 50
        assert result[0]["kpi_focus"] == "营收"
        assert "id" in result[0]  # 自动生成
        assert result[1]["reports_to"] == "CEO"

    def test_skip_invalid(self):
        result = _coerce_org([
            {"name": "Valid"},
            {"name": ""},  # 空名
            {},  # 无名
            "not a dict",  # 错类型
        ])
        assert len(result) == 1

    def test_max_n(self):
        result = _coerce_org([{"name": f"dept{i}"} for i in range(20)], max_n=5)
        assert len(result) == 5


class TestCoerceFinancials:
    def test_partial(self):
        result = _coerce_financials({
            "revenue_yi": 5.8,
            "growth_rate_pct": 15,
            "tam_yi": "this is not a financial",  # 误入字段, 应忽略
        })
        assert result == {"revenue_yi": 5.8, "growth_rate_pct": 15}

    def test_empty(self):
        assert _coerce_financials({}) == {}
        assert _coerce_financials(None) == {}


class TestCoerceMarket:
    def test_full(self):
        result = _coerce_market({
            "tam_yi": 1200, "market_growth_pct": 18, "stance": "利好",
            "competitors": ["A", "B"], "regulation": ["GDPR"],
        })
        assert result["stance"] == "supportive"
        assert result["competitors"] == ["A", "B"]

    def test_default_stance(self):
        result = _coerce_market({})
        assert result["stance"] == "neutral"
        assert result["competitors"] == []
        assert result["regulation"] == []


class TestSafeStripJson:
    def test_with_fence(self):
        text = '```json\n{"a": 1}\n```'
        assert json.loads(_safe_strip_json(text)) == {"a": 1}

    def test_bare_json(self):
        text = 'some prefix {"a": 1} some suffix'
        assert json.loads(_safe_strip_json(text)) == {"a": 1}

    def test_no_json(self):
        text = 'no json here'
        assert _safe_strip_json(text) == text


# ====== 集成测试: Mock LLM ======

class _MockLLM:
    def __init__(self, response: str):
        self.response = response
        self.calls = 0

    async def chat(self, messages, **kwargs):
        self.calls += 1
        return self.response


@pytest.mark.asyncio
async def test_extract_params_happy_path():
    mock = _MockLLM("""```json
{
  "company_name": "某科技公司",
  "org_structure": [
    {"name": "技术部", "headcount": 100, "kpi_focus": "交付质量"},
    {"name": "销售部", "reports_to": "CEO", "headcount": 50}
  ],
  "financials": {
    "revenue_yi": 5.8, "growth_rate_pct": 15,
    "cash_runway_months": 18, "total_headcount": 200
  },
  "market": {
    "tam_yi": 1200, "stance": "利好",
    "competitors": ["A公司", "B公司"],
    "regulation": ["数据安全法"]
  }
}
```""")
    analyzer = SeedAnalyzer(mock)
    docs = [{"title": "战略规划.txt", "content": "某科技公司 5.8亿营收..."}]
    result = await analyzer.extract_params(docs)
    assert result["company_name"] == "某科技公司"
    assert len(result["org_structure"]) == 2
    assert result["financials"]["revenue_yi"] == 5.8
    assert result["financials"]["total_headcount"] == 200
    assert result["market"]["stance"] == "supportive"
    assert result["market"]["competitors"] == ["A公司", "B公司"]


@pytest.mark.asyncio
async def test_extract_params_llm_fails_returns_empty():
    class _FailingLLM:
        async def chat(self, messages, **kwargs):
            raise RuntimeError("LLM down")

    analyzer = SeedAnalyzer(_FailingLLM())
    result = await analyzer.extract_params([{"title": "x.txt", "content": "y"}])
    assert result["company_name"] is None
    assert result["org_structure"] == []
    assert result["financials"] == {}
    assert result["market"]["stance"] == "neutral"


@pytest.mark.asyncio
async def test_extract_params_malformed_json():
    mock = _MockLLM("not json at all, just some text")
    analyzer = SeedAnalyzer(mock)
    result = await analyzer.extract_params([{"title": "x", "content": "y"}])
    assert result["company_name"] is None
    assert result["financials"] == {}


@pytest.mark.asyncio
async def test_extract_params_merges_multiple_docs():
    """后出现的文档覆盖前一个 (假设后 = 较新)"""
    mock = _MockLLM("""{"company_name": "X公司", "financials": {"revenue_yi": 5.0}}""")
    analyzer = SeedAnalyzer(mock)
    docs = [
        {"title": "doc1", "content": "..."},
        {"title": "doc2", "content": "..."},
    ]
    result = await analyzer.extract_params(docs)
    # mock 每次返相同响应, 但 merge 逻辑会跑 2 次
    assert mock.calls == 2
    assert result["company_name"] == "X公司"
    assert result["financials"]["revenue_yi"] == 5.0
