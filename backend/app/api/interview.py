"""
Interview IPC API (Goal G9) — agent interview over per-round JSONL trace.

Routes (mounted at /api/interview):

* POST /api/interview/<run_id>/agents/<agent_id>/message
    body  : {"question": str, "round_ref"?: int}
    reply : 200 {"role": "agent", "agent_id", "content", "timestamp", "metadata"}
            404 if the run is unknown, 400 if the body is invalid.
            Persists both the user turn and the agent reply to
            ``backend/data/interviews/<run_id>_<agent_id>.jsonl``.

* GET  /api/interview/<run_id>/trace?agent_id=<id>&limit=200
    Returns the per-agent transcript as a JSON array of InterviewMessage
    dicts. The default limit is 200; capped at 5000 by the writer.

* GET  /api/interview/<run_id>/trace?kind=round
    Returns the per-round trace (one line per ``round_completed`` event)
    from ``backend/data/interviews/<run_id>.jsonl``.

    Precedence: ``?kind=round`` wins over ``?agent_id=`` so the wizard
    can use one URL family. Missing both → 400.

* GET  /api/interview/<run_id>/events
    SSE channel. Emits ``interview_token`` / ``interview_done`` frames
    when an interview message is in flight, plus ``round_appended``
    whenever a new line lands in ``<run_id>.jsonl``. The first frame is
    the standard ``retry: 3000`` preamble.

The blueprint deliberately defers to existing services:

* ``services/agent_interview.AgentInterviewService`` for the actual Q/A
* ``services/loop.engine.LoopEngine`` writes ``<run_id>.jsonl`` already

This file is the thin Flask layer that ties them together.
"""
from __future__ import annotations

import json
import os
import queue
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from flask import Blueprint, Response, jsonify, request

interview_bp = Blueprint("interview", __name__, url_prefix="/api/interview")

# ---------------------------------------------------------------------------
# Storage helpers
# ---------------------------------------------------------------------------

_THIS_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _THIS_DIR.parent  # .../backend
_INTERVIEWS_DIR = _BACKEND_DIR / "data" / "interviews"


def _interviews_dir() -> Path:
    """Lazy directory resolver so tests can monkeypatch the path."""
    _INTERVIEWS_DIR.mkdir(parents=True, exist_ok=True)
    return _INTERVIEWS_DIR


def _agent_jsonl_path(run_id: str, agent_id: str) -> Path:
    return _interviews_dir() / f"{run_id}_{agent_id}.jsonl"


def _round_jsonl_path(run_id: str) -> Path:
    return _interviews_dir() / f"{run_id}.jsonl"


def _append_jsonl(path: Path, record: Dict[str, Any]) -> None:
    """Append a single record to ``path`` as one JSONL line.

    Best-effort: never raises into the request thread. We log instead.
    """
    try:
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
    except Exception:
        # Defensive — the request should still succeed even if the
        # filesystem is unhappy.
        import logging

        logging.getLogger(__name__).warning(
            "interview: failed to append %s", path, exc_info=True
        )


def _read_jsonl(path: Path, limit: int = 200) -> List[Dict[str, Any]]:
    """Tail ``path`` and return up to ``limit`` most recent records."""
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8") as fh:
            lines = [ln for ln in fh if ln.strip()]
    except Exception:
        return []
    tail = lines[-limit:] if limit > 0 else lines
    out: List[Dict[str, Any]] = []
    for ln in tail:
        try:
            out.append(json.loads(ln))
        except Exception:
            continue
    return out


# ---------------------------------------------------------------------------
# Orchestrator + LLM provider resolution
# ---------------------------------------------------------------------------


def _get_orchestrator():
    """Lazy import the orchestrator to avoid module-load cycles."""
    from backend.app.api import get_orchestrator  # type: ignore

    return get_orchestrator()


def _get_llm_provider():
    from backend.services.llm_factory import create_llm_provider  # type: ignore

    return create_llm_provider()


def _run_known(run_id: str) -> bool:
    """Return True if the orchestrator knows about this run_id."""
    try:
        orch = _get_orchestrator()
    except Exception:
        return False
    try:
        return orch.get_run(run_id) is not None
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Interview bus (for SSE fan-out)
# ---------------------------------------------------------------------------
# A per-run_id thread-safe queue of frames. Used only by
# ``/api/interview/<run_id>/events``. Frames are plain dicts with
# ``type`` ∈ {interview_token, interview_done, round_appended}.
_INTERVIEW_SUBS: Dict[str, List["queue.Queue[Any]"]] = {}
_INTERVIEW_LOCK = threading.Lock()


def _interview_subscribe(run_id: str) -> "queue.Queue[Any]":
    q: "queue.Queue[Any]" = queue.Queue(maxsize=512)
    with _INTERVIEW_LOCK:
        _INTERVIEW_SUBS.setdefault(run_id, []).append(q)
    return q


def _interview_unsubscribe(run_id: str, q: "queue.Queue[Any]") -> None:
    with _INTERVIEW_LOCK:
        subs = _INTERVIEW_SUBS.get(run_id) or []
        if q in subs:
            subs.remove(q)
        if not subs:
            _INTERVIEW_SUBS.pop(run_id, None)


def _interview_publish(run_id: str, frame: Dict[str, Any]) -> None:
    with _INTERVIEW_LOCK:
        subs = list(_INTERVIEW_SUBS.get(run_id) or [])
    for q in subs:
        try:
            q.put_nowait(frame)
        except queue.Full:
            # Drop the slowest consumer; never let one bad client stall
            # the rest of the fan-out.
            try:
                _ = q.get_nowait()
            except queue.Empty:
                pass
            try:
                q.put_nowait(frame)
            except queue.Full:
                pass


# ---------------------------------------------------------------------------
# Interview service cache (per run_id) — reuses AgentInterviewService
# ---------------------------------------------------------------------------
_SERVICE_CACHE: Dict[str, Any] = {}
_SERVICE_LOCK = threading.Lock()


def _get_interview_service(run_id: str):
    """Return a cached AgentInterviewService for ``run_id``.

    The service needs both a ``CompanyContext`` and an LLM provider.
    We pull the CompanyContext out of the orchestrator's snapshot if
    possible; otherwise we synthesize a minimal stub. The LLM provider
    is created from the factory (it honors STRATEGICMIND_LLM_OVERRIDE).
    """
    with _SERVICE_LOCK:
        if run_id in _SERVICE_CACHE:
            return _SERVICE_CACHE[run_id]

    from backend.services.agent_interview import AgentInterviewService  # type: ignore
    from backend.services.company_orchestrator import CompanyContext  # type: ignore

    company_ctx: Any = None
    try:
        company_ctx = CompanyContext()
        # If the orchestrator has a richer snapshot, mutate the
        # company_name so the agent's role prompt reflects it.
        try:
            orch = _get_orchestrator()
            snap = orch.get_run(run_id) or {}
            artifacts = (snap.get("artifacts") or {})
            sim = artifacts.get("SIMULATION_RUNNING") or artifacts.get(
                "CONFIG_GENERATION"
            ) or {}
            company_state = sim.get("company_state") if isinstance(sim, dict) else None
            if isinstance(company_state, dict) and company_state.get("name"):
                company_ctx.company_name = str(company_state.get("name"))
        except Exception:
            pass
    except Exception:
        company_ctx = None

    try:
        llm = _get_llm_provider()
    except Exception:
        llm = None

    if company_ctx is None or llm is None:
        return None

    svc = AgentInterviewService(company_context=company_ctx, llm_provider=llm)
    with _SERVICE_LOCK:
        _SERVICE_CACHE[run_id] = svc
    return svc


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@interview_bp.route("/<run_id>/agents/<agent_id>/message", methods=["POST"])
def post_message(run_id: str, agent_id: str):
    """Send a question to ``agent_id`` and persist the conversation."""
    if not _run_known(run_id):
        return jsonify({"error": "Run not found"}), 404

    payload: Dict[str, Any] = {}
    try:
        payload = request.get_json(force=True, silent=True) or {}
    except Exception:
        payload = {}
    question = (payload.get("question") or "").strip()
    if not question:
        return jsonify({"error": "question is required"}), 400
    round_ref = payload.get("round_ref")

    # Build the user turn record.
    user_record = {
        "role": "user",
        "agent_id": agent_id,
        "agent_name": None,
        "content": question,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()),
        "metadata": {"question": question, "round_ref": round_ref},
    }
    _append_jsonl(_agent_jsonl_path(run_id, agent_id), user_record)

    svc = _get_interview_service(run_id)
    if svc is None:
        # No service available — record a synthetic reply so the wizard
        # has something to render.
        answer = f"[interview 未就绪] run_id={run_id} agent_id={agent_id}"
        agent_record = {
            "role": "agent",
            "agent_id": agent_id,
            "agent_name": None,
            "content": answer,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()),
            "metadata": {
                "question": question,
                "round_ref": round_ref,
                "model": "stub",
                "latency_ms": 0,
            },
        }
        _append_jsonl(_agent_jsonl_path(run_id, agent_id), agent_record)
        _interview_publish(run_id, {"type": "interview_done", "agent_id": agent_id, "message": agent_record})
        return jsonify(agent_record), 200

    # Fire the LLM call (sync wrapper for the async service).
    started = time.time()
    try:
        import asyncio

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # We're inside an event loop already; spin a fresh one
                # in a thread-safe manner.
                import concurrent.futures

                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                    reply = ex.submit(
                        asyncio.run, svc.ask(agent_id, question, context={"round_ref": round_ref})
                    ).result()
            else:
                reply = svc.ask(agent_id, question, context={"round_ref": round_ref})
                if asyncio.iscoroutine(reply):
                    reply = loop.run_until_complete(reply)
        except RuntimeError:
            reply = asyncio.run(svc.ask(agent_id, question, context={"round_ref": round_ref}))
    except Exception as exc:  # pragma: no cover - defensive
        reply = None
        content = f"[interview error] {exc}"
        model = "unknown"
    else:
        content = getattr(reply, "content", "") or ""
        llm_obj = getattr(svc, "llm", None)
        name_attr = getattr(llm_obj, "name", None)
        if callable(name_attr):
            try:
                model = name_attr()
            except Exception:
                model = "unknown"
        elif isinstance(name_attr, str):
            model = name_attr
        else:
            model = type(llm_obj).__name__ if llm_obj is not None else "unknown"

    latency_ms = int((time.time() - started) * 1000)

    agent_record = {
        "role": "agent",
        "agent_id": agent_id,
        "agent_name": getattr(reply, "agent_name", None) if reply else None,
        "content": content,
        "timestamp": getattr(reply, "timestamp", None)
        if reply and getattr(reply, "timestamp", None)
        else time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()),
        "metadata": {
            "question": question,
            "round_ref": round_ref,
            "model": model,
            "latency_ms": latency_ms,
        },
    }
    _append_jsonl(_agent_jsonl_path(run_id, agent_id), agent_record)

    # SSE fan-out
    _interview_publish(
        run_id,
        {
            "type": "interview_token",
            "agent_id": agent_id,
            "delta": content[:120],
        },
    )
    _interview_publish(
        run_id,
        {"type": "interview_done", "agent_id": agent_id, "message": agent_record},
    )
    return jsonify(agent_record), 200


@interview_bp.route("/<run_id>/trace", methods=["GET"])
def get_trace(run_id: str):
    """Tail either the per-agent transcript or the per-round JSONL trace."""
    kind = request.args.get("kind")
    agent_id = request.args.get("agent_id")
    try:
        limit = int(request.args.get("limit", "200"))
    except (TypeError, ValueError):
        limit = 200
    limit = max(1, min(limit, 5000))

    # ?kind=round wins per the spec.
    if kind == "round":
        return jsonify(_read_jsonl(_round_jsonl_path(run_id), limit=limit)), 200
    if kind and kind != "round":
        return jsonify({"error": f"unknown kind: {kind}"}), 400

    if not agent_id:
        return jsonify({"error": "agent_id or kind required"}), 400

    return jsonify(_read_jsonl(_agent_jsonl_path(run_id, agent_id), limit=limit)), 200


@interview_bp.route("/<run_id>/events", methods=["GET"])
def interview_events(run_id: str):
    """SSE stream of ``interview_token`` / ``interview_done`` /
    ``round_appended`` frames for the wizard's Step 5 panel.
    """
    sub_q = _interview_subscribe(run_id)
    retry_prefix = "retry: 3000\n\n"

    def generate():
        try:
            yield retry_prefix
            # Optional: emit a snapshot of the current trace so the
            # client can re-hydrate after a reload.
            round_path = _round_jsonl_path(run_id)
            if round_path.exists():
                tail = _read_jsonl(round_path, limit=5)
                for rec in tail:
                    yield (
                        "event: round_appended\ndata: "
                        + json.dumps(rec, ensure_ascii=False, default=str)
                        + "\n\n"
                    )
            while True:
                try:
                    frame = sub_q.get(timeout=1.0)
                except queue.Empty:
                    # Heartbeat keeps proxies from idling the socket.
                    yield ": ping\n\n"
                    continue
                evt_name = frame.get("type", "message")
                yield (
                    f"event: {evt_name}\ndata: "
                    + json.dumps(frame, ensure_ascii=False, default=str)
                    + "\n\n"
                )
        finally:
            _interview_unsubscribe(run_id, sub_q)

    return Response(generate(), mimetype="text/event-stream")
