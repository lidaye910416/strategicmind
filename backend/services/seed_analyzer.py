"""
SeedAnalyzer - 从种子文件抽取 3 类结构化参数 (company_name + org_structure + financials + market)

供 ConfigCard 的 "🤖 AI 一键提取" 按钮调用。
补上 document_intelligence.py 那个 _parse_response 的 TODO (那个是抽 entity+fact, 这里是抽 user_params patch)。
"""
import json
import re
from typing import Dict, Any, List, Optional
from ..interfaces.llm_provider import ILLMProvider


# 中文 prompt (与 report_agent 风格一致)
_PROMPT_TEMPLATE = """你是一位资深商业分析顾问。请阅读以下种子文档片段, 提取该公司推演所需的关键参数。

# 任务
输出一个 JSON 对象, 包含以下字段:
- company_name: string (公司/组织名称, 文档中最常被提到的主体)
- org_structure: 数组, 每个元素 {{name, reports_to?, headcount?, kpi_focus?}}
  - reports_to 用部门名 (自由文本) 而非 id; 顶层部门 reports_to 省略
  - headcount 是数字, 不知道就 null
  - kpi_focus 是该部门关注的 1-2 个 KPI 关键词, 例 "营收/客户满意度"
- financials: 对象, 字段全部可选 (不知道就 null):
  - revenue_yi (年营收, 亿元)
  - gross_margin_pct (毛利率, %)
  - net_margin_pct (净利率, %)
  - growth_rate_pct (同比增长率, %)
  - cash_runway_months (现金跑道, 月)
  - total_headcount (公司总人数)
  - monthly_burn_wan (月度烧钱, 万元)
- market: 对象:
  - tam_yi (总市场规模, 亿元)
  - market_growth_pct (行业增速, %)
  - stance: "supportive" | "neutral" | "restrictive" (整体市场态度)
  - competitors: string[] (主要竞品名称, 不含 company_name 本身)
  - regulation: string[] (监管/合规约束)

# 重要约束
- 仅输出 JSON, 不要 markdown ```json``` 围栏, 不要任何解释
- 字段值若文档中未提及, 填 null 或 []
- 公司名以最常出现 / 最权威的版本为准 (例: 文档多次提到 "华为" 而非 "华为技术有限公司" → 用 "华为")
- 不要编造数据; 找不到就 null

# 文档
Title: {title}
Content:
{content}
"""


def _safe_strip_json(text: str) -> str:
    """从 LLM 输出抽 JSON: 兼容 ```json 围栏 / 裸 JSON / 混杂文字"""
    # 先尝试 ```json ... ``` 围栏
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        return m.group(1)
    # 再尝试首个 { 到末尾 }
    first = text.find("{")
    last = text.rfind("}")
    if first != -1 and last > first:
        return text[first:last + 1]
    return text


def _coerce_number(v: Any) -> Optional[float]:
    if v is None or v == "" or v == "-":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = re.sub(r"[^0-9.\-]", "", v)
        if not s or s in (".", "-", "-."):
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None


def _coerce_int(v: Any) -> Optional[int]:
    n = _coerce_number(v)
    return int(n) if n is not None else None


def _coerce_stance(v: Any) -> str:
    if not isinstance(v, str):
        return "neutral"
    s = v.lower().strip()
    if s in ("supportive", "利好", "positive", "favorable", "favourable"):
        return "supportive"
    if s in ("restrictive", "不利", "negative", "unfavorable", "unfavourable"):
        return "restrictive"
    return "neutral"


def _coerce_string_list(v: Any) -> List[str]:
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()][:20]
    if isinstance(v, str):
        return [s.strip() for s in re.split(r"[\n;,，；]", v) if s.strip()][:20]
    return []


def _coerce_org(v: Any, max_n: int = 12) -> List[Dict[str, Any]]:
    """接受 [{name, reports_to?, headcount?, kpi_focus?}, ...] 或空"""
    if not isinstance(v, list):
        return []
    out: List[Dict[str, Any]] = []
    for i, item in enumerate(v[:max_n]):
        if not isinstance(item, dict):
            continue
        name = item.get("name") or item.get("department") or item.get("title")
        if not isinstance(name, str) or not name.strip():
            continue
        node: Dict[str, Any] = {
            "id": f"org_{i}_{abs(hash(name.strip())) % 100000}",
            "name": name.strip(),
        }
        if isinstance(item.get("reports_to"), str) and item["reports_to"].strip():
            node["reports_to"] = item["reports_to"].strip()
        hc = _coerce_int(item.get("headcount"))
        if hc is not None and hc > 0:
            node["headcount"] = hc
        if isinstance(item.get("kpi_focus"), str) and item["kpi_focus"].strip():
            node["kpi_focus"] = item["kpi_focus"].strip()
        out.append(node)
    return out


def _coerce_financials(v: Any) -> Dict[str, Any]:
    if not isinstance(v, dict):
        return {}
    out: Dict[str, Any] = {}
    for src, dst in [
        ("revenue_yi", "revenue_yi"),
        ("gross_margin_pct", "gross_margin_pct"),
        ("net_margin_pct", "net_margin_pct"),
        ("growth_rate_pct", "growth_rate_pct"),
        ("cash_runway_months", "cash_runway_months"),
        ("total_headcount", "total_headcount"),
        ("monthly_burn_wan", "monthly_burn_wan"),
    ]:
        n = _coerce_number(v.get(src))
        if n is not None:
            out[dst] = n
    return out


def _coerce_market(v: Any) -> Dict[str, Any]:
    if not isinstance(v, dict):
        return {"stance": "neutral", "competitors": [], "regulation": []}
    return {
        "tam_yi": _coerce_number(v.get("tam_yi")),
        "market_growth_pct": _coerce_number(v.get("market_growth_pct")),
        "stance": _coerce_stance(v.get("stance")),
        "competitors": _coerce_string_list(v.get("competitors"))[:8],
        "regulation": _coerce_string_list(v.get("regulation"))[:6],
    }


class SeedAnalyzer:
    """
    从种子文档提取 user_params 的 3 类结构化字段。
    """

    def __init__(self, llm_provider: ILLMProvider):
        self.llm_provider = llm_provider

    async def extract_params(
        self,
        documents: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Args:
            documents: [{title, content}, ...]
        Returns:
            {
              company_name: str,
              org_structure: [...],
              financials: {...},
              market: {...}
            }
            任何字段缺失返回空占位 (不抛错, 让前端不覆盖)
        """
        merged: Dict[str, Any] = {
            "company_name": None,
            "org_structure": [],
            "financials": {},
            "market": {"stance": "neutral", "competitors": [], "regulation": []},
        }
        for doc in documents:
            if not doc.get("content"):
                continue
            patch = await self._analyze_one(doc)
            # 后出现的文档覆盖前面的 (assumes later = more recent)
            if patch.get("company_name"):
                merged["company_name"] = patch["company_name"]
            if patch.get("org_structure"):
                merged["org_structure"] = patch["org_structure"]
            if patch.get("financials"):
                # 合并: 后面覆盖前面
                merged["financials"] = {**merged["financials"], **patch["financials"]}
            if patch.get("market"):
                m = patch["market"]
                cur = merged["market"]
                if m.get("competitors"):
                    cur["competitors"] = m["competitors"]
                if m.get("regulation"):
                    cur["regulation"] = m["regulation"]
                if m.get("stance") and m["stance"] != "neutral":
                    cur["stance"] = m["stance"]
                if m.get("tam_yi") is not None:
                    cur["tam_yi"] = m["tam_yi"]
                if m.get("market_growth_pct") is not None:
                    cur["market_growth_pct"] = m["market_growth_pct"]
                merged["market"] = cur
        return merged

    async def _analyze_one(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        title = doc.get("title", "")
        content = (doc.get("content") or "")[:5000]
        prompt = _PROMPT_TEMPLATE.format(title=title, content=content)
        messages = [{"role": "user", "content": prompt}]
        try:
            response = await self.llm_provider.chat(messages)
        except Exception as e:
            # LLM 失败不阻塞前端, 返回空
            return {"company_name": None, "org_structure": [], "financials": {}, "market": {}}
        try:
            raw = _safe_strip_json(response)
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return {"company_name": None, "org_structure": [], "financials": {}, "market": {}}
        return {
            "company_name": (data.get("company_name") or "").strip() or None if isinstance(data.get("company_name"), str) else None,
            "org_structure": _coerce_org(data.get("org_structure")),
            "financials": _coerce_financials(data.get("financials")),
            "market": _coerce_market(data.get("market")),
        }
