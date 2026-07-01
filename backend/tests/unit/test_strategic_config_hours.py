"""
StrategicConfigGenerator — derive hours_per_round from time_step.

Fix CLAUDE.md pitfall #5 — derived params now flow through.

Before: sim_config.time_step = 'month' but hours_per_round hardcoded 24 (or
defaults to ``simulated_hours=72`` regardless). Clock would only advance 1 day
per round even when time_step='month', so Round 3 read as "Month 3" but actual
elapsed time was 3 days.

After: _TIME_STEP_HOURS = {day:24, week:168, month:720, quarter:2160,
year:8760}. hours_per_round is derived from time_step so Round 3 = Month 3 /
Day 90 / Q3 Year 1 etc. (round * hours_per_round) is the real elapsed time.
Unknown time_step falls back to month (720) + warning log.
"""
from __future__ import annotations

import pytest

from backend.models.seed_document import SeedDocument
from backend.services.strategic_config_generator import (
    StrategicConfigGenerator,
    _TIME_STEP_HOURS,
)


# ---------------------------------------------------------------------------
# Mapping table
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "time_step,expected_hours",
    [
        ("day", 24),
        ("week", 168),
        ("month", 720),
        ("quarter", 2160),
        ("year", 8760),
    ],
)
def test_time_step_hours_mapping_exists(time_step, expected_hours):
    """_TIME_STEP_HOURS 映射存在且值正确"""
    assert _TIME_STEP_HOURS[time_step] == expected_hours


def test_time_step_hours_has_all_five_keys():
    """_TIME_STEP_HOURS 恰好包含 5 个键 (day/week/month/quarter/year)"""
    assert set(_TIME_STEP_HOURS.keys()) == {"day", "week", "month", "quarter", "year"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _seed_doc() -> SeedDocument:
    return SeedDocument(
        doc_id="d1",
        title="Test",
        content="Some content",
        claims=[],
    )


# ---------------------------------------------------------------------------
# Default path (no user_params → fallback)
# ---------------------------------------------------------------------------


def test_default_fallback_uses_month_hours():
    """Fallback path (no user_params) → hours_per_round=720 (month)"""
    gen = StrategicConfigGenerator()
    cfg = gen.generate(seed_doc=_seed_doc(), requirement="dummy")
    assert hasattr(cfg, "hours_per_round"), "hours_per_round field missing"
    assert cfg.hours_per_round == 720


# ---------------------------------------------------------------------------
# user_params path — derived values
# ---------------------------------------------------------------------------


def test_default_user_params_uses_quarter_hours():
    """user_params 不传 time_step → quarter (2160) per _DEFAULT_TIME_STEP"""
    gen = StrategicConfigGenerator()
    cfg = gen.generate(
        seed_doc=_seed_doc(),
        requirement="dummy",
        user_params={"years": 1},
    )
    assert cfg.time_step == "quarter"
    assert cfg.hours_per_round == 2160


def test_time_step_year_derives_hours_8760():
    """time_step=year, years=3 → max_rounds=3, hours_per_round=8760"""
    gen = StrategicConfigGenerator()
    cfg = gen.generate(
        seed_doc=_seed_doc(),
        requirement="dummy",
        user_params={"time_step": "year", "years": 3},
    )
    assert cfg.max_rounds == 3
    assert cfg.hours_per_round == 8760


def test_time_step_month_year_2_derives_24_rounds():
    """time_step=month, years=2 → max_rounds=24, hours_per_round=720"""
    gen = StrategicConfigGenerator()
    cfg = gen.generate(
        seed_doc=_seed_doc(),
        requirement="dummy",
        user_params={"time_step": "month", "years": 2},
    )
    assert cfg.max_rounds == 24
    assert cfg.hours_per_round == 720


def test_time_step_quarter_derives_hours_2160():
    """time_step=quarter, years=1 → max_rounds=4, hours_per_round=2160"""
    gen = StrategicConfigGenerator()
    cfg = gen.generate(
        seed_doc=_seed_doc(),
        requirement="dummy",
        user_params={"time_step": "quarter", "years": 1},
    )
    assert cfg.max_rounds == 4
    assert cfg.hours_per_round == 2160


def test_time_step_week_derives_hours_168():
    """time_step=week → hours_per_round=168. NOTE: 'week' not in
    _TIME_STEP_PER_YEAR mapping; per_year defaults to 4 (so max_rounds=4).
    This test focuses on hours_per_round derivation."""
    gen = StrategicConfigGenerator()
    cfg = gen.generate(
        seed_doc=_seed_doc(),
        requirement="dummy",
        user_params={"time_step": "week", "years": 1},
    )
    assert cfg.hours_per_round == 168


# ---------------------------------------------------------------------------
# Unknown time_step fallback
# ---------------------------------------------------------------------------


def test_unknown_time_step_falls_back_to_month(caplog):
    """time_step='decade' (非法) → 兜底 month, hours_per_round=720, 警告 log"""
    gen = StrategicConfigGenerator()
    with caplog.at_level("WARNING"):
        cfg = gen.generate(
            seed_doc=_seed_doc(),
            requirement="dummy",
            user_params={"time_step": "decade"},
        )
    assert cfg.hours_per_round == 720
    # Verify warning was logged about unknown time_step
    assert any(
        "decade" in record.message for record in caplog.records
    ), f"Expected WARNING mentioning 'decade', got: {[r.message for r in caplog.records]}"