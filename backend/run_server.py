"""
Flask dev server entry point.

Usage:
    # from project root:
    python -m backend.run_server
    # OR from backend/:
    cd backend && python -m run_server
    python run_server.py
"""
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent

# Make the project root importable for `backend.X` imports
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# Also add the backend dir so `app.X` imports work when run as a script
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Pin dirs to absolute paths so the orchestrator and the API agree
UPLOAD_DIR = BACKEND_DIR / "uploads"
REPORTS_DIR = BACKEND_DIR / "data" / "reports"
PIPELINE_CKPT_DIR = BACKEND_DIR / "data" / "pipelines"
for d in (UPLOAD_DIR, REPORTS_DIR, PIPELINE_CKPT_DIR):
    d.mkdir(parents=True, exist_ok=True)

os.environ["UPLOAD_FOLDER"] = str(UPLOAD_DIR)
os.environ["REPORTS_DIR"] = str(REPORTS_DIR)
os.environ["PIPELINE_CHECKPOINT_DIR"] = str(PIPELINE_CKPT_DIR)

# Try to load .env from project root
env_path = PROJECT_ROOT / ".env"
if env_path.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(env_path, override=False)
    except ImportError:
        pass

# Create the app (works whether run as module or script)
from app import create_app  # noqa: E402

app = create_app()


def main():
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    print(f"🚀 StrategicMind API on http://{host}:{port}")
    print(f"   UPLOAD_FOLDER       = {UPLOAD_DIR}")
    print(f"   REPORTS_DIR         = {REPORTS_DIR}")
    print(f"   PIPELINE_CKPT_DIR   = {PIPELINE_CKPT_DIR}")
    print(f"   LLM provider        = {os.environ.get('LLM_PROVIDER', '(default: ollama)')}")
    app.run(host=host, port=port, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
