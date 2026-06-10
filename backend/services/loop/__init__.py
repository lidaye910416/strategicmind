"""Loop-Engine v2 (Phase 1 of the StrategicMind loop-engine-v2 plan).

Modules in this package together implement the multi-round simulation
engine that the plan designates as the *centerpiece* of the pipeline:

* :mod:`clock`             — SimClock v2 (T1.1)
* :mod:`action_taxonomy`   — 12 BusinessActionType enums + StrategicAction
                            extension (T1.3)
* :mod:`action_resolver`   — 12 ACTION_PROFILES that mutate a WorldState
                            slice (T1.4)
* :mod:`memory_writeback`  — Episode-as-graph writeback (T1.5)
* :mod:`shock_library`     — Hand-authored typed shocks (T1.6)
* :mod:`event_injector`    — Deterministic EventInjector (T1.6)
* :mod:`scheduler`         — Time-gated agent scheduler (T1.7)
* :mod:`engine`            — LoopEngine (T1.8)

The pieces are wired into :class:`PipelineOrchestrator` by T1.9, behind
the ``STRATEGICMIND_LOOP_ENGINE_V2`` feature flag.
"""
from .clock import SimClock  # noqa: F401

__all__ = ["SimClock"]
