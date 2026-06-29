"""
Unit tests for SimConfig / StrategicAgent extension (T1.2).

Acceptance (per docs/superpowers/specs/loop-engine-v2-implementation.md §T1.2):

* ``_generate_with_user_params`` populates budget_per_dept summing to <= total_cap.
* At least 3 distinct active_hours lists are produced across agents
  when the user supplies 3+ departments.
* ``StrategicAgent`` carries the new ``activity_level``,
  ``active_hours``, ``timezone_offset`` fields; ``to_dict``/``from_dict``
  round-trips them.
"""
from __future__ import annotations

import pytest

from backend.models.seed_document import SeedDocument
from backend.models.strategic_agent import AgentType, StrategicAgent
from backend.services.strategic_config_generator import StrategicConfigGenerator


# ---------------------------------------------------------------------------
# StrategicAgent field defaults + round-trip
# ---------------------------------------------------------------------------


def test_strategic_agent_has_temporal_fields_with_defaults():
    agent = StrategicAgent(name="TestAgent", agent_type=AgentType.ANALYST)
    assert hasattr(agent, "activity_level")
    assert hasattr(agent, "active_hours")
    assert hasattr(agent, "timezone_offset")
    assert agent.activity_level == 0.5
    assert agent.active_hours == list(range(9, 18))
    assert agent.timezone_offset == 0
    assert agent.department == ""
    assert agent.role == ""


def test_strategic_agent_to_from_dict_round_trip_temporal_fields():
    a = StrategicAgent(
        name="CFO-1",
        agent_type=AgentType.ANALYST,
        activity_level=0.7,
        active_hours=[9, 10, 11, 14, 15, 16],
        timezone_offset=-5,
        department="财务",
        role="CFO",
    )
    d = a.to_dict()
    assert d["activity_level"] == 0.7
    assert d["active_hours"] == [9, 10, 11, 14, 15, 16]
    assert d["timezone_offset"] == -5
    assert d["department"] == "财务"
    assert d["role"] == "CFO"

    rebuilt = StrategicAgent.from_dict(d)
    assert rebuilt.activity_level == 0.7
    assert rebuilt.active_hours == [9, 10, 11, 14, 15, 16]
    assert rebuilt.timezone_offset == -5
    assert rebuilt.department == "财务"
    assert rebuilt.role == "CFO"


# ---------------------------------------------------------------------------
# StrategicConfigGenerator — company block + active_hours diversity
# ---------------------------------------------------------------------------


def _seed_doc() -> SeedDocument:
    return SeedDocument(
        doc_id="d1",
        title="Test",
        content="Some content",
        claims=[],
    )


def test_generate_with_user_params_populates_company_block():
    """T1.2 acceptance: budget sums to <= total_cap, company block is present."""
    gen = StrategicConfigGenerator()
    cfg = gen.generate(
        seed_doc=_seed_doc(),
        requirement="decide go-to-market",
        user_params={
            "years": 1,
            "time_step": "month",
            "departments": ["财务", "销售", "技术", "Board"],
            "external_factors": [],
            "n_stakeholders": 12,
            "company": {
                "total_cap": 100.0,
                "assets": [
                    {"id": "ip_1", "name": "Patent X", "value": 50_000.0,
                     "owner_agent_id": "agent_a", "transferable": True},
                ],
                "coalition_seeds": [["agent_a", "agent_b"]],
            },
        },
    )
    # company block is populated
    assert cfg.company, "company block missing from SimulationConfig"
    assert cfg.company["total_cap"] == 100.0
    assert set(cfg.company["budget_per_dept"].keys()) == {"财务", "销售", "技术", "Board"}
    assert sum(cfg.company["budget_per_dept"].values()) <= 100.0 + 1e-6
    assert cfg.company["assets"] and cfg.company["assets"][0]["id"] == "ip_1"
    assert cfg.company["coalition_seeds"] == [["agent_a", "agent_b"]]


def test_generate_with_user_params_produces_at_least_three_distinct_active_hours():
    """T1.2 acceptance: at least 3 distinct active_hours lists across agents."""
    gen = StrategicConfigGenerator()
    cfg = gen.generate(
        seed_doc=_seed_doc(),
        requirement="",
        user_params={
            "years": 1,
            "time_step": "quarter",
            "departments": ["财务", "销售", "技术", "Board", "HR"],
            "external_factors": [],
            "n_stakeholders": 15,
        },
    )
    lists = []
    for a in cfg.agents:
        if isinstance(a, dict) and a.get("active_hours"):
            lists.append(tuple(a["active_hours"]))
    distinct = set(lists)
    assert len(distinct) >= 3, f"expected >=3 distinct active_hours, got {len(distinct)}: {distinct}"


def test_generate_user_params_even_split_when_no_company_block():
    """When user_params omits `company`, budget is split evenly across depts."""
    gen = StrategicConfigGenerator()
    cfg = gen.generate(
        seed_doc=_seed_doc(),
        requirement="",
        user_params={
            "years": 1,
            "time_step": "month",
            "departments": ["A", "B", "C", "D"],
            "external_factors": [],
            "n_stakeholders": 12,
        },
    )
    bpd = cfg.company["budget_per_dept"]
    assert set(bpd.keys()) == {"A", "B", "C", "D"}
    # Each dept gets 1/4 of total_cap (default 100.0)
    for v in bpd.values():
        assert abs(v - 25.0) < 0.01
    assert sum(bpd.values()) <= 100.0 + 1e-6


def test_generate_user_params_clips_over_cap_budget():
    """User-supplied budget > total_cap is scaled down, never exceeds cap."""
    gen = StrategicConfigGenerator()
    cfg = gen.generate(
        seed_doc=_seed_doc(),
        requirement="",
        user_params={
            "years": 1,
            "time_step": "month",
            "departments": ["X"],
            "external_factors": [],
            "n_stakeholders": 6,
            "company": {
                "total_cap": 50.0,
                "budget_per_dept": {"X": 999.0, "Y": 999.0},
            },
        },
    )
    bpd = cfg.company["budget_per_dept"]
    # X is in selected departments so it survives; Y is not — but the
    # user did supply a value for X. After clipping, sum <= 50.
    assert sum(bpd.values()) <= 50.0 + 1e-6


def test_generate_user_params_no_departments_empty_budget():
    gen = StrategicConfigGenerator()
    cfg = gen.generate(
        seed_doc=_seed_doc(),
        requirement="",
        user_params={
            "years": 1,
            "time_step": "year",
            "departments": [],
            "external_factors": [],
            "n_stakeholders": 4,
        },
    )
    assert cfg.company["budget_per_dept"] == {}
    assert cfg.company["assets"] == []
    assert cfg.company["coalition_seeds"] == []
