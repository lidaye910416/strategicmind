"""Shared pytest fixtures and config for the test suite.

This file also primes the ``backend`` package at module-import time so
that pytest's collection scan does not register ``backend`` as a
namespace package. With pytest's rootdir set to ``backend/`` (via
``backend/pytest.ini``), pytest discovers the ``backend/`` directory
during its early collection and registers a namespace-package stub
in ``sys.modules['backend']``. Subsequent ``from .api.graph import ...``
relative imports then fail with the misleading message
'``backend.app`` is not a package'. The fix is to eagerly import
``backend`` here so ``sys.modules['backend']`` is bound to the real
``backend/__init__.py`` BEFORE pytest scans any test file.

The eager import also caches ``backend.services``, ``backend.app``,
``backend.interfaces`` and ``backend.models`` as real packages, which
later ``pytest_collection_modifyitems`` and ``import backend.app``
calls in test modules will hit instead of trying to re-resolve.

We deliberately do NOT purge ``sys.modules``: pytest itself keeps an
internal module cache keyed by file path; aggressive purge breaks
``KeyError: 'backend.tests.conftest'`` lookups.
"""

import os
import sys


_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PROJECT_PARENT = os.path.dirname(_PROJECT_ROOT)  # /Users/jasonlee/strategicmind

if _PROJECT_PARENT not in sys.path:
    sys.path.insert(0, _PROJECT_PARENT)

# Eagerly bind ``backend`` as a real package by importing its __init__.
# This must happen BEFORE pytest collects any test file.
import backend  # noqa: E402,F401  -- side-effect: registers backend in sys.modules
import backend.app  # noqa: E402,F401  -- registers backend.app + transitively backend.services
import backend.services  # noqa: E402,F401  -- registers backend.services as a package


# Register custom markers used in test_g5_loop.py (and any other slow tests).
# Without this, pytest emits PytestUnknownMarkWarning on every slow-marked test.
def pytest_configure(config):
    config.addinivalue_line("markers", "slow: long-running tests (multi-round simulation)")
