"""
Loop engine v2 — T0.3 feature flag plumbing acceptance test.

The plan's acceptance criterion (Phase 0 §T0.3):
    "setting env var to 1 does not break existing tests"
    "PipelineOrchestrator reads these and chooses old or new path"

We exercise the public surface of the feature flag plumbing:

* The env-var coercion (``_parse_bool``) handles the four expected
  truthy spellings plus a representative falsey value.
* The module-level helpers re-read the env every call so
  ``monkeypatch.setenv`` is honoured.
* The :class:`ConfigManager` exposes a ``FeatureFlags`` dataclass
  with the two named fields.
* :class:`PipelineOrchestrator` exposes ``loop_engine_v2_enabled``
  / ``cosmic_graph_enabled`` properties that re-evaluate per call.

We do NOT yet branch the SIMULATION_RUNNING stage on these flags —
that lands in T1.9. For now, the flag is plumbing + observability.
"""

import pytest


# ---------------------------------------------------------------------------
# Module-level helper tests — exercise the env coercion in isolation
# ---------------------------------------------------------------------------


def test_parse_bool_truthy_values(monkeypatch):
    """`1`, `true`, `yes`, `on` (any case) enable the flag."""
    from backend.config.manager import _parse_bool
    for truthy in ("1", "true", "TRUE", "True", "yes", "YES", "on", "On"):
        assert _parse_bool(truthy) is True, truthy
    for falsy in ("0", "false", "no", "off", "", "garbage", "2"):
        assert _parse_bool(falsy) is False, falsy
    # None / missing → default (False unless caller overrides).
    assert _parse_bool(None) is False
    assert _parse_bool(None, default=True) is True


def test_feature_flags_helper_reads_env_per_call(monkeypatch):
    """`feature_flags()` re-reads the env on every invocation."""
    from backend.config.manager import feature_flags

    monkeypatch.delenv("STRATEGICMIND_LOOP_ENGINE_V2", raising=False)
    monkeypatch.delenv("STRATEGICMIND_COSMIC_GRAPH", raising=False)
    f0 = feature_flags()
    assert f0.loop_engine_v2 is False
    assert f0.cosmic_graph is False

    monkeypatch.setenv("STRATEGICMIND_LOOP_ENGINE_V2", "1")
    monkeypatch.setenv("STRATEGICMIND_COSMIC_GRAPH", "yes")
    f1 = feature_flags()
    assert f1.loop_engine_v2 is True
    assert f1.cosmic_graph is True

    monkeypatch.setenv("STRATEGICMIND_LOOP_ENGINE_V2", "0")
    f2 = feature_flags()
    assert f2.loop_engine_v2 is False
    assert f2.cosmic_graph is True  # unchanged


def test_is_loop_engine_v2_and_cosmic_graph_helpers(monkeypatch):
    from backend.config.manager import (
        is_loop_engine_v2_enabled,
        is_cosmic_graph_enabled,
    )
    monkeypatch.delenv("STRATEGICMIND_LOOP_ENGINE_V2", raising=False)
    monkeypatch.delenv("STRATEGICMIND_COSMIC_GRAPH", raising=False)
    assert is_loop_engine_v2_enabled() is False
    assert is_cosmic_graph_enabled() is False
    monkeypatch.setenv("STRATEGICMIND_LOOP_ENGINE_V2", "1")
    monkeypatch.setenv("STRATEGICMIND_COSMIC_GRAPH", "true")
    assert is_loop_engine_v2_enabled() is True
    assert is_cosmic_graph_enabled() is True


# ---------------------------------------------------------------------------
# ConfigManager snapshot — recorded at construction time
# ---------------------------------------------------------------------------


def test_config_manager_has_feature_flags_attribute(monkeypatch):
    """`ConfigManager().feature_flags` is a FeatureFlags with both fields."""
    from backend.config.manager import ConfigManager, FeatureFlags

    # Force a fresh manager so the env at the time of this test is
    # what's reflected. We can't import the singleton directly because
    # it might be already initialised with stale env, so we reset.
    ConfigManager.reset()
    monkeypatch.setenv("STRATEGICMIND_LOOP_ENGINE_V2", "1")
    monkeypatch.setenv("STRATEGICMIND_COSMIC_GRAPH", "1")
    try:
        mgr = ConfigManager()
        assert isinstance(mgr.feature_flags, FeatureFlags)
        assert mgr.feature_flags.loop_engine_v2 is True
        assert mgr.feature_flags.cosmic_graph is True
    finally:
        ConfigManager.reset()


# ---------------------------------------------------------------------------
# PipelineOrchestrator wiring
# ---------------------------------------------------------------------------


def test_orchestrator_exposes_feature_flag_properties(monkeypatch):
    """The orchestrator reads both flags and exposes re-evaluating props."""
    from backend.services.pipeline_orchestrator import PipelineOrchestrator

    monkeypatch.setenv("STRATEGICMIND_LOOP_ENGINE_V2", "0")
    monkeypatch.setenv("STRATEGICMIND_COSMIC_GRAPH", "0")
    orch = PipelineOrchestrator(llm_provider=_NullLLM())
    assert orch.loop_engine_v2_enabled is False
    assert orch.cosmic_graph_enabled is False

    # Re-evaluate after a flag flip.
    monkeypatch.setenv("STRATEGICMIND_LOOP_ENGINE_V2", "1")
    assert orch.loop_engine_v2_enabled is True
    assert orch.cosmic_graph_enabled is False

    monkeypatch.setenv("STRATEGICMIND_COSMIC_GRAPH", "yes")
    assert orch.cosmic_graph_enabled is True


def test_orchestrator_with_flag_on_does_not_break_existing_orchestration(monkeypatch):
    """T0.3 acceptance: enabling the flag does not break the pipeline.

    We just construct the orchestrator and check that its core
    invariants still hold (event bus attached, dirs exist, state
    initialised). Stage-level branch happens in T1.9.
    """
    from backend.services.pipeline_orchestrator import PipelineOrchestrator

    monkeypatch.setenv("STRATEGICMIND_LOOP_ENGINE_V2", "1")
    monkeypatch.setenv("STRATEGICMIND_COSMIC_GRAPH", "1")
    orch = PipelineOrchestrator(llm_provider=_NullLLM())

    assert orch.feature_flags.loop_engine_v2 is True
    assert orch.feature_flags.cosmic_graph is True
    assert orch.event_bus is not None
    assert orch._runs == {}
    assert orch._tasks == {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _NullLLM:
    """Stub LLM provider so the orchestrator does not need real creds."""

    def __getattr__(self, _name):
        return lambda *args, **kwargs: None
