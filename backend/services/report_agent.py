"""
Backwards-compatible shim for ReportAgent.

The canonical class lives in `app.agents.report_agent`. This shim re-exports
it so that service-layer code (e.g. iterative_simulation_engine) and tests
can keep `from backend.services.report_agent import ReportAgent`.

Implements: US-035
"""
from backend.app.agents.report_agent import ReportAgent

__all__ = ["ReportAgent"]
