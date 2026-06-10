"""
Backend application package.

StrategicMind - Flask application factory.

Usage:
    from app import create_app
    app = create_app()
    app.run(host='0.0.0.0', port=8000)
"""

# Ensure the project root (parent of `backend/`) is on sys.path so that
# `from backend.services.x import ...` style imports inside our blueprints
# resolve correctly when the package is launched via `python -m app.run`
# or as `app:create_app` by Flask.
import os as _os
import sys as _sys
_THIS_DIR = _os.path.dirname(_os.path.abspath(__file__))   # .../backend/app
_BACKEND_DIR = _os.path.dirname(_THIS_DIR)                  # .../backend
# `backend` is the package name we want importable. Its parent (the
# project root) must be on sys.path.
_PROJECT_ROOT = _os.path.dirname(_BACKEND_DIR)              # .../strategicmind
if _PROJECT_ROOT not in _sys.path:
    _sys.path.insert(0, _PROJECT_ROOT)

from flask import Flask, jsonify  # noqa: E402

from .config import config  # noqa: E402
from .api.graph import graph_bp  # noqa: E402
from .api.pipeline import pipeline_bp  # noqa: E402
from .api.simulation import simulation_bp  # noqa: E402
from .api.report import report_bp  # noqa: E402
from .api.provider import provider_bp  # noqa: E402
from .api.company import company_bp  # noqa: E402  # noqa: E402
from .api.seed import seed_bp  # noqa: E402


def create_app(test_config: dict | None = None) -> Flask:
    """
    Application factory.

    Creates and configures the Flask app, registers all blueprints,
    and wires up CORS + health check endpoints.
    """
    app = Flask(__name__)

    # Apply configuration
    app.config["SECRET_KEY"] = config.SECRET_KEY
    app.config["DEBUG"] = config.DEBUG
    app.config["MAX_CONTENT_LENGTH"] = config.MAX_CONTENT_LENGTH
    app.config["UPLOAD_FOLDER"] = config.UPLOAD_FOLDER

    if test_config:
        app.config.update(test_config)

    # Ensure upload dir exists
    import os
    os.makedirs(config.UPLOAD_FOLDER, exist_ok=True)

    # Register blueprints
    app.register_blueprint(graph_bp)
    app.register_blueprint(pipeline_bp)
    app.register_blueprint(simulation_bp)
    app.register_blueprint(report_bp)
    app.register_blueprint(provider_bp)
    app.register_blueprint(company_bp)
    app.register_blueprint(seed_bp)

    # Health check
    @app.route("/api/health", methods=["GET"])
    def health():
        # Report which LLM provider is active (for ops visibility)
        try:
            from backend.services.llm_factory import describe_provider
            llm_info = describe_provider()
        except Exception as e:
            llm_info = {"provider": "unknown", "error": str(e)}
        return jsonify({
            "status": "ok",
            "service": "strategicmind",
            "version": "0.1.0",
            "llm": llm_info,
        })

    @app.route("/", methods=["GET"])
    def index():
        return jsonify({
            "service": "StrategicMind",
            "docs": "/api/health",
            "endpoints": [
                "/api/health",
                "/api/graph/upload",
                "/api/graph/build_graph",
                "/api/graph/search",
                "/api/pipeline/start",
                "/api/pipeline/<run_id>",
                "/api/simulation/start",
                "/api/simulation/<run_id>",
                "/api/company/setup",
                "/api/company/<company_id>",
                "/api/company/<company_id>/resolve",
                "/api/company/<company_id>/departments",
                "/api/company/<company_id>/advance-quarter",
                "/api/report/<report_id>",
                "/api/report/<report_id>/chat",
            ],
        })

    return app


__all__ = ["create_app", "config"]
