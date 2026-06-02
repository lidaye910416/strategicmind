"""
Flask development server entry point.

Usage:
    cd backend
    python -m app.run
    # or
    python -m flask --app app:create_app run --port 8000
"""
import os
import sys
from pathlib import Path

# Make `backend` importable so `from app.x import ...` works
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from app import create_app  # noqa: E402

app = create_app()

if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    print(f"🚀 StrategicMind API running on http://{host}:{port}")
    print(f"   Health: http://{host}:{port}/api/health")
    app.run(host=host, port=port, debug=app.config.get("DEBUG", False))
