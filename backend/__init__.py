# Backend package marker.
# Adding this file makes `backend` a proper package, which is required for pytest
# to honor the `from .service_factory import ServiceFactory` relative import in
# backend/services/__init__.py. Without it, pytest collection treats
# `backend/services/` as a top-level dir and the relative import fails.
# Runtime is unchanged: `python3 -m backend.run_server` already worked because
# Python 3.3+ supports namespace packages; this makes the test environment match.
