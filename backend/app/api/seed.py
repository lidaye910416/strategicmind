"""
Seed analyze API — 暴露 LLM 预填 user_params (company_name + org_structure + financials + market).

POST /api/seed/analyze
  body: { doc_ids: string[] }
  response: { company_name, org_structure, financials, market, sources: [{doc_id, ...}] }

GET  /api/seed/list
  response: { docs: [{doc_id, title, size}] }
"""
import os
from typing import Any, Dict, List
from flask import Blueprint, jsonify, request

seed_bp = Blueprint("seed", __name__, url_prefix="/api/seed")


def _get_orchestrator():
    """延迟导入, 避免循环"""
    from backend.app.api import get_orchestrator
    return get_orchestrator()


def _get_llm_provider():
    """走 LLM factory, 支持 STRATEGICMIND_LLM_OVERRIDE (测试用 mock)"""
    from backend.services.llm_factory import create_llm_provider
    return create_llm_provider()


@seed_bp.route("/list", methods=["GET"])
def list_seed_docs():
    """列出已上传的种子文件 (用于前端 AI 预填前确认 doc_ids)."""
    upload_folder = os.environ.get("UPLOAD_FOLDER", "./uploads")
    docs: List[Dict[str, Any]] = []
    if os.path.isdir(upload_folder):
        for fname in sorted(os.listdir(upload_folder)):
            doc_id = fname.split("_", 1)[0] if "_" in fname else fname
            fpath = os.path.join(upload_folder, fname)
            try:
                size = os.path.getsize(fpath)
            except OSError:
                size = 0
            docs.append({
                "doc_id": doc_id,
                "title": fname,
                "size": size,
            })
    return jsonify({"count": len(docs), "docs": docs})


@seed_bp.route("/analyze", methods=["POST"])
def analyze_seeds():
    """
    从指定 doc_ids 的种子文件提取 user_params patch.

    Body: {"doc_ids": ["xxx", "yyy"], "focus": "company" | "financial" | "market" | "all"}
    Response: {
      "company_name": "...",
      "org_structure": [{name, reports_to?, headcount?, kpi_focus?}, ...],
      "financials": {revenue_yi?, ...},
      "market": {tam_yi?, market_growth_pct?, stance, competitors[], regulation[]},
      "sources": [{doc_id, title, chars}],
    }
    """
    body = request.get_json(silent=True) or {}
    doc_ids: List[str] = body.get("doc_ids") or []
    if not doc_ids:
        return jsonify({"error": "doc_ids is required"}), 400
    if not isinstance(doc_ids, list) or not all(isinstance(d, str) for d in doc_ids):
        return jsonify({"error": "doc_ids must be a list of strings"}), 400

    upload_folder = os.environ.get("UPLOAD_FOLDER", "./uploads")
    documents: List[Dict[str, Any]] = []
    sources: List[Dict[str, Any]] = []
    for fname in sorted(os.listdir(upload_folder) if os.path.isdir(upload_folder) else []):
        doc_id = fname.split("_", 1)[0] if "_" in fname else fname
        if doc_id not in doc_ids:
            continue
        fpath = os.path.join(upload_folder, fname)
        try:
            with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except OSError:
            continue
        if not content.strip():
            continue
        documents.append({
            "doc_id": doc_id,
            "title": fname,
            "content": content,
        })
        sources.append({"doc_id": doc_id, "title": fname, "chars": len(content)})

    if not documents:
        return jsonify({"error": "no valid documents found for the given doc_ids"}), 404

    # 跑 LLM
    import asyncio
    from backend.services.seed_analyzer import SeedAnalyzer

    llm = _get_llm_provider()
    analyzer = SeedAnalyzer(llm)
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        patch = loop.run_until_complete(analyzer.extract_params(documents))
    except Exception as e:
        return jsonify({"error": f"LLM analyze failed: {str(e)}", "fallback": {
            "company_name": None, "org_structure": [], "financials": {},
            "market": {"stance": "neutral", "competitors": [], "regulation": []}
        }}), 500
    finally:
        try:
            loop.close()
        except Exception:
            pass

    return jsonify({
        **patch,
        "sources": sources,
    })
