"""
Report API - Fetch and chat with strategic reports.

Implements: US-035, US-065
"""
import os
import uuid
import json
from typing import Dict, Any
from flask import Blueprint, request, jsonify, send_from_directory

from backend.adapters.bailian_adapter import BailianAdapter
from backend.app.config import config
from backend.services.local_knowledge_store import LocalKnowledgeStore
from backend.services.local_graph_store import LocalGraphStore
from backend.tools.search_tool import SearchTool
from backend.app.agents.report_agent import ReportAgent

report_bp = Blueprint('report', __name__, url_prefix='/api/report')

# Where reports are stored
_env = os.environ.get("REPORTS_DIR")
REPORTS_DIR = _env if (_env and os.path.isabs(_env)) else (
    os.path.abspath(_env) if _env else os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../data/reports'))
)
os.makedirs(REPORTS_DIR, exist_ok=True)


def _build_agent() -> ReportAgent:
    """Build a default ReportAgent."""
    llm = BailianAdapter(api_key=config.LLM_API_KEY or "mock-key")
    graph = LocalGraphStore()
    ks = LocalKnowledgeStore(graph_store=graph, llm_provider=llm)
    tools = [SearchTool(ks)]
    return ReportAgent(tools=tools, llm_provider=llm)


@report_bp.route('/<report_id>', methods=['GET'])
def get_report(report_id: str):
    """Fetch a generated report by ID."""
    path = os.path.join(REPORTS_DIR, f"{report_id}.md")
    if not os.path.exists(path):
        # Synthesize a placeholder so the UI works even when no real run exists
        return jsonify({
            "report_id": report_id,
            "run_id": report_id,
            "content": (
                f"# Strategic Report (placeholder)\n\n"
                f"No report found for `{report_id}`. "
                f"Start a pipeline to generate a real report."
            ),
            "generated_at": None,
        })
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    meta_path = path + ".meta.json"
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
    return jsonify({
        "report_id": report_id,
        "run_id": meta.get("run_id", report_id),
        "content": content,
        "generated_at": meta.get("generated_at"),
    })


@report_bp.route('/<report_id>/chat', methods=['POST'])
def chat_report(report_id: str):
    """Chat with the report agent about a report."""
    data: Dict[str, Any] = request.get_json() or {}
    message = data.get("message", "").strip()
    if not message:
        return jsonify({"error": "message is required"}), 400
    context = data.get("context", {}) or {}

    try:
        agent = _build_agent()
        # The ReportAgent.chat signature is (message, context) -> str
        response = asyncio_run(agent.chat(message, context))
        return jsonify({"response": response})
    except Exception as e:
        return jsonify({
            "error": str(e),
            "response": (
                "I'm having trouble processing your question right now. "
                "Please check the backend LLM configuration."
            ),
        }), 500


@report_bp.route('/<report_id>/save', methods=['POST'])
def save_report(report_id: str):
    """Persist a generated report (used by pipeline on completion)."""
    data: Dict[str, Any] = request.get_json() or {}
    content = data.get("content", "")
    run_id = data.get("run_id", report_id)
    if not content:
        return jsonify({"error": "content is required"}), 400

    path = os.path.join(REPORTS_DIR, f"{report_id}.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    meta_path = path + ".meta.json"
    from datetime import datetime
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump({
            "run_id": run_id,
            "generated_at": datetime.now().isoformat(),
        }, f)
    return jsonify({"status": "saved", "report_id": report_id})


def asyncio_run(coro):
    """Helper: run an async coroutine in a sync Flask view."""
    import asyncio
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    if loop.is_running():
        # Already inside an event loop (Flask dev server) - run in a thread
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as ex:
            return ex.submit(lambda: asyncio.run(coro)).result()
    return loop.run_until_complete(coro)
