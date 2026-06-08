"""
Integration test: /api/seed/analyze endpoint
- happy path (mock LLM 返合法 JSON)
- empty doc_ids → 400
- missing files → 404
- LLM 异常 → 500 with fallback
"""
import json
import os
import tempfile
import pytest

from backend.app import create_app


@pytest.fixture
def app_with_seed(monkeypatch, tmp_path):
    """起 Flask app + 写 2 个种子文件到临时 UPLOAD_FOLDER."""
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    (upload_dir / "abc_annual_report.txt").write_text(
        "某科技股份有限公司 2024 年年报。年营收 5.8 亿元，"
        "同比增长 15%，毛利率 42%。技术部 100 人，销售部 50 人。", encoding="utf-8"
    )
    (upload_dir / "def_market.txt").write_text(
        "中国云计算市场总规模 1200 亿元，年增速 18%。主要竞品: 阿里云, 腾讯云, 华为云。"
        "监管: 数据安全法, GDPR。", encoding="utf-8"
    )
    monkeypatch.setenv("UPLOAD_FOLDER", str(upload_dir))

    # mock LLM via STRATEGICMIND_LLM_OVERRIDE
    import sys, types
    mock_module = types.ModuleType("mock_llm")
    class _MockProvider:
        def __init__(self, *a, **kw): pass
        async def chat(self, messages, **kwargs):
            return json.dumps({
                "company_name": "某科技股份有限公司",
                "org_structure": [
                    {"name": "技术部", "headcount": 100, "kpi_focus": "交付"},
                    {"name": "销售部", "reports_to": "CEO", "headcount": 50},
                ],
                "financials": {"revenue_yi": 5.8, "growth_rate_pct": 15, "gross_margin_pct": 42},
                "market": {
                    "tam_yi": 1200, "market_growth_pct": 18, "stance": "利好",
                    "competitors": ["阿里云", "腾讯云", "华为云"],
                    "regulation": ["数据安全法", "GDPR"],
                }
            }, ensure_ascii=False)
    mock_module.MiniMaxAdapter = _MockProvider
    # 替换 factory 中所有可能的 provider 类
    for name in ["MiniMaxAdapter", "BailianAdapter", "OllamaAdapter", "MockLLMProvider"]:
        setattr(mock_module, name, _MockProvider)
    sys.modules["backend.adapters.minimax_adapter"] = mock_module
    sys.modules["backend.adapters.bailian_adapter"] = mock_module
    sys.modules["backend.adapters.ollama_adapter"] = mock_module
    # mock 自身的 overrides env
    monkeypatch.setenv("STRATEGICMIND_LLM_OVERRIDE", "mock")

    app = create_app()
    app.config["TESTING"] = True
    yield app, ["abc", "def"]


@pytest.fixture
def client(app_with_seed):
    app, _ = app_with_seed
    return app.test_client()


def test_list_seed_docs(client, app_with_seed):
    r = client.get("/api/seed/list")
    assert r.status_code == 200
    data = r.get_json()
    assert data["count"] == 2
    titles = [d["title"] for d in data["docs"]]
    assert any("annual_report" in t for t in titles)


def test_analyze_happy_path(client):
    r = client.post("/api/seed/analyze", json={"doc_ids": ["abc", "def"]})
    assert r.status_code == 200, r.get_data(as_text=True)
    data = r.get_json()
    assert data["company_name"] == "某科技股份有限公司"
    assert len(data["org_structure"]) == 2
    assert data["financials"]["revenue_yi"] == 5.8
    assert data["market"]["tam_yi"] == 1200
    assert data["market"]["stance"] == "supportive"
    assert "阿里云" in data["market"]["competitors"]
    assert "数据安全法" in data["market"]["regulation"]
    assert len(data["sources"]) == 2


def test_analyze_empty_doc_ids(client):
    r = client.post("/api/seed/analyze", json={"doc_ids": []})
    assert r.status_code == 400
    assert "doc_ids" in r.get_json()["error"]


def test_analyze_missing_doc_ids_field(client):
    r = client.post("/api/seed/analyze", json={})
    assert r.status_code == 400


def test_analyze_unknown_doc_ids(client):
    r = client.post("/api/seed/analyze", json={"doc_ids": ["nonexistent"]})
    assert r.status_code == 404
    assert "no valid documents" in r.get_json()["error"]
