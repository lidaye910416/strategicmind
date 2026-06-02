"""
Acceptance tests for the Flask API layer.

Verifies that the API factory boots, blueprints are registered,
and core endpoints respond to smoke-test requests.
"""
import sys
from pathlib import Path

import pytest

# Ensure backend/ is on sys.path so `import app` works
ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture
def client():
    from app import create_app
    app = create_app({"TESTING": True})
    return app.test_client()


def test_health_endpoint(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.get_json()
    assert data["status"] == "ok"
    assert data["service"] == "strategicmind"


def test_index_endpoint(client):
    r = client.get("/")
    assert r.status_code == 200
    data = r.get_json()
    assert data["service"] == "StrategicMind"
    assert "/api/health" in data["endpoints"]


def test_uploaded_files_listing(client):
    r = client.get("/api/graph/uploaded_files")
    assert r.status_code == 200
    data = r.get_json()
    assert "files" in data
    assert isinstance(data["files"], list)


def test_graph_upload_missing_file(client):
    r = client.post("/api/graph/upload", data={})
    assert r.status_code == 400


def test_pipeline_start(client):
    r = client.post("/api/pipeline/start", json={"config": {"max_rounds": 1}})
    assert r.status_code == 200
    data = r.get_json()
    assert "run_id" in data
    assert data["message"] == "Pipeline started"


def test_pipeline_status_not_found(client):
    r = client.get("/api/pipeline/nonexistent_id")
    assert r.status_code == 404


def test_simulation_get_not_found(client):
    r = client.get("/api/simulation/nonexistent_run")
    assert r.status_code == 404


def test_report_placeholder(client):
    """Report endpoint should return a placeholder when no real report exists."""
    r = client.get("/api/report/never-existed-xyz")
    assert r.status_code == 200
    data = r.get_json()
    assert data["report_id"] == "never-existed-xyz"
    assert "content" in data
    assert "Strategic Report" in data["content"]


def test_report_save_and_fetch(client):
    """Round-trip: save a report, then fetch it."""
    save = client.post(
        "/api/report/run_smoke_001/save",
        json={
            "content": "# Saved Report\n\nHello from acceptance test.",
            "run_id": "run_smoke_001",
        },
    )
    assert save.status_code == 200
    r = client.get("/api/report/run_smoke_001")
    assert r.status_code == 200
    data = r.get_json()
    assert "Saved Report" in data["content"]
    assert data["run_id"] == "run_smoke_001"
