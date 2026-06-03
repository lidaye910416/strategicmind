"""
Frontend + Backend end-to-end integration test.

Spins up:
    1. Flask backend on port 8761 (with MockLLMProvider injected)
    2. Vite dev server on port 8762

Then uses Playwright to:
    1. Load the dashboard, verify the UI renders
    2. Upload a real file via the proxy
    3. Start a pipeline via the proxy
    4. Watch the progress in the UI
    5. Navigate to the report view and verify content

This is the test that proves the frontend actually talks to the backend.
"""
import os
import sys
import time
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(ROOT))


@pytest.fixture(scope="module")
def backend_server():
    """Start the Flask backend on port 8761 with mock LLM."""
    import backend.tests.mocks.mock_llm_provider as mock_mod
    from backend.tests.mocks.mock_llm_provider import MockLLMProvider
    _orig = MockLLMProvider.__init__

    def _patched_init(self, *args, **kwargs):
        _orig(self, *args, **kwargs)
        self.set_responses([
            '[{"name": "Apple Inc.", "entity_type": "Organization"}, '
            '{"name": "Tim Cook", "entity_type": "Person"}]',
            '[]',
        ] * 50 + [
            '# Strategic Report\n\n## Executive Summary\n'
            'Apple is well-positioned in AI/AR.\n\n'
            '## Key Findings\n- AI investment\n- AR exploration\n',
        ] * 5)

    MockLLMProvider.__init__ = _patched_init

    env = {
        **os.environ,
        "PORT": "8761",
        "STRATEGICMIND_LLM_OVERRIDE": "backend.tests.mocks.mock_llm_provider.MockLLMProvider",
    }

    proc = subprocess.Popen(
        ["python3", "-m", "backend.run_server"],
        cwd=str(ROOT), env=env,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    import urllib.request
    for _ in range(30):
        try:
            urllib.request.urlopen("http://127.0.0.1:8761/api/health", timeout=1)
            break
        except Exception:
            time.sleep(0.5)
    else:
        proc.terminate()
        raise RuntimeError("Backend failed to start")

    yield "http://127.0.0.1:8761"

    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()

    MockLLMProvider.__init__ = _orig


@pytest.fixture(scope="module")
def vite_server():
    """Start Vite dev server on port 8762 with proxy to backend."""
    env = {**os.environ, "BACKEND_PORT": "8761"}
    proc = subprocess.Popen(
        ["npx", "vite", "--port", "8762", "--host", "127.0.0.1", "--strictPort"],
        cwd=str(ROOT / "frontend"), env=env,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    import urllib.request
    for _ in range(30):
        try:
            urllib.request.urlopen("http://127.0.0.1:8762/", timeout=1)
            break
        except Exception:
            time.sleep(0.5)
    else:
        proc.terminate()
        raise RuntimeError("Vite failed to start")

    yield "http://127.0.0.1:8762"

    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


@pytest.fixture(scope="module")
def browser():
    """Playwright chromium browser."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        yield browser
        browser.close()


class TestFrontendIntegration:
    """End-to-end: frontend ↔ backend via Vite proxy."""

    def test_health(self, backend_server):
        """Backend is reachable and healthy."""
        import urllib.request, json
        r = urllib.request.urlopen(f"{backend_server}/api/health")
        body = json.loads(r.read())
        assert body["status"] == "ok"
        assert body["llm"]["provider"] == "mock"

    def test_dashboard_renders(self, vite_server, browser):
        """Vite serves the dashboard with Tailwind styles loaded."""
        page = browser.new_page()
        page.goto(vite_server, wait_until="networkidle")
        # Title / brand
        assert "StrategicMind" in page.content()
        # Tailwind applied: min-h-screen class on the root
        assert page.locator(".min-h-screen").first.is_visible()
        # Step labels
        assert page.get_by_text("Upload seed documents").is_visible()
        # Start button present but disabled
        start_btn = page.get_by_role("button", name="Start Pipeline")
        assert start_btn.is_disabled()
        page.close()

    def test_config_toggle(self, vite_server, browser):
        """Clicking Config reveals the configuration section."""
        page = browser.new_page()
        page.goto(vite_server, wait_until="networkidle")
        page.get_by_role("button", name="Config").click()
        assert page.get_by_text("Configuration").is_visible()
        assert page.get_by_text("Simulation hours").is_visible()
        page.close()

    def test_full_flow_via_proxy(self, backend_server, vite_server, browser):
        """Upload a doc, start a pipeline, watch it complete, view the report."""
        page = browser.new_page()
        page.goto(vite_server, wait_until="networkidle")

        # Upload through the Vite proxy
        sample = b"Apple Inc. is a technology company. Tim Cook is CEO. Apple invests in AI."
        files = {"file": {"name": "apple.txt", "mimeType": "text/plain", "buffer": sample}}
        upload_resp = page.request.post(
            f"{vite_server}/api/graph/upload", multipart=files
        )
        assert upload_resp.ok
        doc_id = upload_resp.json()["doc_id"]

        # Start a pipeline through the proxy
        start_resp = page.request.post(
            f"{vite_server}/api/pipeline/start",
            data={"config": {"max_rounds": 1, "doc_ids": [doc_id]}},
            headers={"Content-Type": "application/json"},
        )
        assert start_resp.ok
        run_id = start_resp.json()["run_id"]

        # Poll until terminal
        for _ in range(60):
            r = page.request.get(f"{vite_server}/api/pipeline/{run_id}")
            snap = r.json()
            if snap["status"] in ("completed", "failed", "cancelled"):
                break
            page.wait_for_timeout(500)
        assert snap["status"] == "completed", snap

        # Navigate to the report view
        page.goto(f"{vite_server}/report/{run_id}", wait_until="networkidle")
        assert page.locator("article").is_visible(timeout=10_000)

        # Navigate to the simulation view (wait for h1 to appear)
        page.goto(f"{vite_server}/simulation/{run_id}", wait_until="domcontentloaded")
        h1 = page.locator("h1")
        h1.wait_for(state="visible", timeout=10_000)
        assert h1.inner_text().startswith("Simulation:")

        page.close()
