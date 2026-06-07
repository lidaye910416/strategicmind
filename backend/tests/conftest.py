"""Shared pytest fixtures and config for the test suite."""

# Register custom markers used in test_g5_loop.py (and any other slow tests).
# Without this, pytest emits PytestUnknownMarkWarning on every slow-marked test.
def pytest_configure(config):
    config.addinivalue_line("markers", "slow: long-running tests (multi-round simulation)")
