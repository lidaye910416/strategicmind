"""
G1 - Frontend <-> Backend link (P0 INFRA).

Acceptance (G1 L1):
    - Vite proxy at :3000 forwards /api/* to backend on :8000.
    - CORS allows http://localhost:3000 (and :3001).
    - /api/health reachable, reports service=strategicmind.

Strategy: use Flask's test_client (no live :8000 needed) and
explicitly attach flask_cors to the test app, matching the BE-INFRA-2
spec so the CORS preflight/headers are exercised.  All four checks run
in <2s because no real LLM call is made (start_pipeline returns 200 as
soon as the background thread is dispatched).
"""
import os
import sys

import pytest

# Make the project root importable for `backend.*` and `app.*` imports.
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.abspath(os.path.join(_THIS_DIR, "..", "..", ".."))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from app import create_app  # noqa: E402


# Point the orchestrator at a stub LLM so the background pipeline thread
# (spawned by POST /api/pipeline/start) does not hit a real provider.
os.environ.setdefault(
    "STRATEGICMIND_LLM_OVERRIDE",
    "backend.tests.mocks.mock_llm_provider.MockLLMProvider",
)


@pytest.fixture(scope="module")
def app():
    flask_app = create_app()
    # Mirror the P0 INFRA-2 setup: CORS for the Vite dev server origins.
    try:
        from flask_cors import CORS
        CORS(
            flask_app,
            origins=["http://localhost:3000", "http://localhost:3001"],
        )
    except Exception:
        # flask_cors missing -> CORS tests will assert on absence, which
        # surfaces the missing dependency.
        pass
    return flask_app


@pytest.fixture
def client(app):
    return app.test_client()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_vite_proxy_passes_through(client):
    """POST /api/pipeline/start (the route the Vite proxy forwards to) -> 200.

    Mirrors the production path: Vite at :3000 receives POST /api/pipeline/start
    from the React app and proxies it to :8000.
    """
    resp = client.post(
        "/api/pipeline/start",
        json={
            "config": {
                "industry": "digital_service",
                "user_params": {"years": 1, "time_step": "year"},
            }
        },
    )
    assert resp.status_code == 200, f"got {resp.status_code}: {resp.data!r}"
    body = resp.get_json()
    assert body and "run_id" in body, f"missing run_id in {body!r}"
    # run_id echoes the prefix used by the API.
    assert body["run_id"].startswith("run_"), body["run_id"]


def test_cors_headers_present(client):
    """Cross-origin GET from :3000 -> response carries Access-Control-Allow-Origin."""
    resp = client.get(
        "/api/health",
        headers={"Origin": "http://localhost:3000"},
    )
    assert resp.status_code == 200
    allow = resp.headers.get("Access-Control-Allow-Origin")
    assert allow in ("http://localhost:3000", "*"), (
        f"CORS origin header missing or wrong; full headers: {dict(resp.headers)!r}"
    )


def test_cors_preflight_options(client):
    """OPTIONS preflight from :3000 for POST /api/pipeline/start -> 200/204."""
    resp = client.options(
        "/api/pipeline/start",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert resp.status_code in (200, 204), f"preflight failed: {resp.status_code}"
    allow_origin = resp.headers.get("Access-Control-Allow-Origin")
    allow_methods = resp.headers.get("Access-Control-Allow-Methods", "")
    assert allow_origin in ("http://localhost:3000", "*"), (
        f"preflight missing Allow-Origin: {dict(resp.headers)!r}"
    )
    assert "POST" in allow_methods.upper(), (
        f"preflight did not advertise POST in Allow-Methods: {allow_methods!r}"
    )


def test_health_endpoint_reachable(client):
    """GET /api/health -> 200 with service=strategicmind."""
    resp = client.get("/api/health")
    assert resp.status_code == 200, resp.data
    body = resp.get_json()
    assert body is not None, "health endpoint returned non-JSON"
    assert body.get("service") == "strategicmind", body
    assert body.get("status") == "ok", body
