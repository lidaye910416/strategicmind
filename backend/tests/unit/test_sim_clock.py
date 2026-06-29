"""
Unit tests for SimClock (loop-engine v2, T1.1).

These tests cover:

* The month_index regression (Cluster D / F12) — day 0, 359, 360, 720.
* The temporal invariants documented in the SimClock docstring
  (0 <= hour_of_day < 24, day_index monotonic, fiscal_year starts at 1).
* Boundary predicates used by AgentScheduler v2: is_quarter_boundary,
  is_year_boundary, is_weekday, is_business_hours.
"""
from __future__ import annotations

import pytest

from backend.services.loop.clock import (
    BUSINESS_HOUR_END,
    BUSINESS_HOUR_START,
    DAYS_PER_MONTH,
    DAYS_PER_QUARTER,
    DAYS_PER_WEEK,
    DAYS_PER_YEAR,
    HOURS_PER_DAY,
    SimClock,
)


# ---------------------------------------------------------------------------
# Construction invariants
# ---------------------------------------------------------------------------


def test_total_hours_zero_is_valid():
    """total_hours=0 is the canonical "round 0 / Monday 00:00" starting state."""
    clock = SimClock(total_hours=0)
    assert clock.day_index == 0
    assert clock.hour_of_day == 0
    assert clock.fiscal_year == 1
    assert clock.quarter == 1
    assert clock.month_index == 0  # F12 day 0 -> month 0


def test_negative_total_hours_rejected():
    """Clock never rewinds — total_hours must be >= 0."""
    with pytest.raises(ValueError):
        SimClock(total_hours=-1)


# ---------------------------------------------------------------------------
# advance() semantics
# ---------------------------------------------------------------------------


def test_advance_zero_is_noop():
    clock = SimClock(total_hours=12)
    day_bump, new_hour = clock.advance(0)
    assert day_bump == 0
    assert new_hour == 12
    assert clock.total_hours == 12


def test_advance_negative_rejected():
    clock = SimClock(total_hours=10)
    with pytest.raises(ValueError):
        clock.advance(-1)


def test_advance_crossing_day_boundary_returns_day_bump_one():
    """Advance 5h from hour 22 -> next-day hour 3, day_bump=1."""
    clock = SimClock(total_hours=22)
    day_bump, new_hour = clock.advance(5)
    assert day_bump == 1
    assert new_hour == 3
    assert clock.day_index == 1


def test_advance_within_day_returns_day_bump_zero():
    clock = SimClock(total_hours=10)
    day_bump, new_hour = clock.advance(3)
    assert day_bump == 0
    assert new_hour == 13


def test_advance_exact_day_multiplier():
    """Advance exactly 24h -> day_bump=1, hour_of_day unchanged."""
    clock = SimClock(total_hours=7)
    day_bump, new_hour = clock.advance(24)
    assert day_bump == 1
    assert new_hour == 7


# ---------------------------------------------------------------------------
# F12: month_index across year boundaries
# ---------------------------------------------------------------------------
#
# Cluster D root cause: the original month_index formula did not
# wrap modulo (QUARTERS_PER_YEAR * MONTHS_PER_QUARTER). On day 360
# (the first day of fiscal year 2) it returned 12 instead of 0,
# which then mismatched downstream consumers (ActionResolver slices
# keyed on month_index). The fixed formula is:
#
#     month_index = (day_index // DAYS_PER_MONTH) % 12
#
# This produces a clean 0..11 cycle that resets at each year boundary.


def test_month_index_day_zero_is_zero():
    """F12: day_index=0 -> month_index=0 (year 1, month 0)."""
    clock = SimClock(total_hours=0)
    assert clock.month_index == 0


def test_month_index_last_day_of_year_one_is_eleven():
    """F12: day_index=359 -> month_index=11 (year 1, month 11)."""
    # 359 days = 11 months 29 days (29th day of month 11, the last month of year 1).
    clock = SimClock(total_hours=359 * HOURS_PER_DAY)
    assert clock.day_index == 359
    assert clock.month_index == 11


def test_month_index_first_day_of_year_two_resets_to_zero():
    """F12: day_index=360 -> month_index=0 (year 2, month 0)."""
    clock = SimClock(total_hours=360 * HOURS_PER_DAY)
    assert clock.day_index == 360
    assert clock.fiscal_year == 2
    assert clock.month_index == 0


def test_month_index_first_day_of_year_three_resets_to_zero():
    """F12: day_index=720 -> month_index=0 (year 3, month 0)."""
    clock = SimClock(total_hours=720 * HOURS_PER_DAY)
    assert clock.day_index == 720
    assert clock.fiscal_year == 3
    assert clock.month_index == 0


@pytest.mark.parametrize(
    "day_index, expected_month",
    [
        (0, 0),
        (29, 0),          # last day of month 0
        (30, 1),          # first day of month 1
        (90, 3),          # first day of month 3 (quarter 2 start)
        (180, 6),         # first day of month 6 (quarter 3 start)
        (270, 9),         # first day of month 9 (quarter 4 start)
        (359, 11),        # last day of year 1
        (360, 0),         # F12 boundary: year 2 month 0
        (361, 0),         # day 2 of year 2 / month 0
        (719, 11),        # last day of year 2
        (720, 0),         # F12 boundary: year 3 month 0
        (1080, 0),        # year 4 month 0
    ],
)
def test_month_index_table(day_index, expected_month):
    """F12: full month_index table across 4 fiscal years."""
    clock = SimClock(total_hours=day_index * HOURS_PER_DAY)
    assert clock.month_index == expected_month, (
        f"day_index={day_index}: expected month_index={expected_month}, "
        f"got {clock.month_index}"
    )


# ---------------------------------------------------------------------------
# day_of_month, day_of_week
# ---------------------------------------------------------------------------


def test_day_of_month_one_based():
    clock = SimClock(total_hours=0)
    assert clock.day_of_month == 1  # first day of month 1, day 0 -> 1


def test_day_of_month_last_day_of_month():
    clock = SimClock(total_hours=29 * HOURS_PER_DAY)  # day 29 -> day_of_month=30
    assert clock.day_of_month == DAYS_PER_MONTH


def test_day_of_week_monday_is_zero():
    clock = SimClock(total_hours=0)
    assert clock.day_of_week == 0  # Monday


def test_day_of_week_sunday_is_six():
    # day_index=6 -> 6 % 7 = 6 (Sunday)
    clock = SimClock(total_hours=6 * HOURS_PER_DAY)
    assert clock.day_of_week == DAYS_PER_WEEK - 1


# ---------------------------------------------------------------------------
# quarter / fiscal_year / day_of_quarter
# ---------------------------------------------------------------------------


def test_fiscal_year_one_at_start():
    clock = SimClock(total_hours=0)
    assert clock.fiscal_year == 1


def test_fiscal_year_two_on_first_day_of_year_two():
    clock = SimClock(total_hours=360 * HOURS_PER_DAY)
    assert clock.fiscal_year == 2


def test_quarter_one_at_start_of_year():
    clock = SimClock(total_hours=0)
    assert clock.quarter == 1


def test_quarter_two_on_day_90():
    """Day 90 is the first day of quarter 2."""
    clock = SimClock(total_hours=90 * HOURS_PER_DAY)
    assert clock.quarter == 2


def test_quarter_four_on_day_270():
    clock = SimClock(total_hours=270 * HOURS_PER_DAY)
    assert clock.quarter == 4


def test_day_of_quarter_zero_based():
    clock = SimClock(total_hours=0)
    assert clock.day_of_quarter == 0


def test_days_into_quarter_one_based():
    clock = SimClock(total_hours=0)
    assert clock.days_into_quarter == 1


def test_days_into_quarter_ninety_at_end():
    """Day 89 (0-based) -> days_into_quarter=90 (last day of quarter)."""
    clock = SimClock(total_hours=89 * HOURS_PER_DAY)
    assert clock.days_into_quarter == DAYS_PER_QUARTER


# ---------------------------------------------------------------------------
# Predicates: business hours / weekday / quarter boundary / year boundary
# ---------------------------------------------------------------------------


def test_is_business_hours_true_at_10am_utc():
    clock = SimClock(total_hours=10)
    assert clock.is_business_hours() is True


def test_is_business_hours_false_at_midnight():
    clock = SimClock(total_hours=0)
    assert clock.is_business_hours() is False


def test_is_business_hours_excludes_5pm():
    """17:00 is NOT business hours — exclusive of BUSINESS_HOUR_END."""
    clock = SimClock(total_hours=BUSINESS_HOUR_END)
    assert clock.is_business_hours() is False


def test_is_business_hours_includes_9am():
    clock = SimClock(total_hours=BUSINESS_HOUR_START)
    assert clock.is_business_hours() is True


def test_is_business_hours_timezone_offset_shifts_window():
    """A NY-based CFO with offset=-5 sees business hours 9..13 UTC.

    At 11 UTC + (-5) = 6 local -> NOT business hours.
    At 14 UTC + (-5) = 9 local -> business hours.
    """
    # 11 UTC: NY (offset=-5) sees 6am -> out of business hours.
    clock = SimClock(total_hours=11)
    assert clock.is_business_hours(timezone_offset=-5) is False
    assert clock.is_business_hours(timezone_offset=0) is True  # 11 UTC in 9..17

    # 14 UTC: NY sees 9am -> in business hours.
    clock = SimClock(total_hours=14)
    assert clock.is_business_hours(timezone_offset=-5) is True
    # Same instant in UTC (offset=0) also business hours.
    assert clock.is_business_hours(timezone_offset=0) is True


def test_is_weekday_true_for_monday_through_friday():
    for d in range(5):
        clock = SimClock(total_hours=d * HOURS_PER_DAY)
        assert clock.is_weekday() is True, f"day {d} should be weekday"


def test_is_weekday_false_on_saturday_and_sunday():
    for d in (5, 6):
        clock = SimClock(total_hours=d * HOURS_PER_DAY)
        assert clock.is_weekday() is False, f"day {d} should be weekend"


def test_is_quarter_boundary_true_on_first_and_last_day():
    """days_into_quarter=1 OR days_into_quarter=DAYS_PER_QUARTER -> True."""
    # First day of quarter 1.
    clock = SimClock(total_hours=0)
    assert clock.is_quarter_boundary() is True
    # Last day of quarter 1 (day 89).
    clock = SimClock(total_hours=89 * HOURS_PER_DAY)
    assert clock.is_quarter_boundary() is True


def test_is_quarter_boundary_false_on_mid_quarter():
    clock = SimClock(total_hours=10 * HOURS_PER_DAY)  # mid-quarter
    assert clock.is_quarter_boundary() is False


def test_is_year_boundary_true_on_last_day_of_year_one():
    """day_index=359 -> last day of year 1."""
    clock = SimClock(total_hours=359 * HOURS_PER_DAY)
    assert clock.is_year_boundary() is True


def test_is_year_boundary_false_on_day_zero():
    """day_index=0 is NOT a year boundary — there is no prior day."""
    clock = SimClock(total_hours=0)
    assert clock.is_year_boundary() is False


def test_is_year_boundary_true_on_last_day_of_year_two():
    """day_index=719 -> last day of year 2."""
    clock = SimClock(total_hours=719 * HOURS_PER_DAY)
    assert clock.is_year_boundary() is True


def test_is_business_day_requires_weekday_and_hours():
    """Combined predicate: weekday AND business hours."""
    # Monday 10am -> True.
    clock = SimClock(total_hours=10)
    assert clock.is_business_day() is True
    # Saturday 10am -> False (weekday=False).
    clock = SimClock(total_hours=(5 * HOURS_PER_DAY) + 10)
    assert clock.is_business_day() is False
    # Monday 3am -> False (business hours=False).
    clock = SimClock(total_hours=3)
    assert clock.is_business_day() is False


# ---------------------------------------------------------------------------
# describe() snapshot
# ---------------------------------------------------------------------------


def test_describe_returns_full_snapshot():
    clock = SimClock(total_hours=10 * HOURS_PER_DAY)  # day 10, 00:00
    snap = clock.describe()
    assert snap["day_index"] == 10
    assert snap["hour_of_day"] == 0
    assert snap["total_hours"] == 10 * HOURS_PER_DAY
    assert snap["fiscal_year"] == 1
    assert snap["quarter"] == 1
    # describe() doesn't currently include month_index — but month_index is
    # still queryable via the property. Verify via property to keep this
    # test useful as a clock invariant.
    assert clock.month_index == 0
    assert snap["day_of_month"] == 11


# ---------------------------------------------------------------------------
# Constants sanity
# ---------------------------------------------------------------------------


def test_calendar_constants_self_consistent():
    """Calendar constants are inter-locked — guard against accidental edits."""
    assert DAYS_PER_QUARTER == DAYS_PER_MONTH * 3
    assert DAYS_PER_YEAR == DAYS_PER_QUARTER * 4
    assert BUSINESS_HOUR_START < BUSINESS_HOUR_END
    assert BUSINESS_HOUR_END <= HOURS_PER_DAY