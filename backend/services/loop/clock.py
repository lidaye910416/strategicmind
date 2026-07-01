"""
SimClock v2 — the centerpiece temporal primitive for Loop-Engine v2.

Why this exists
---------------
The v1 ``SimulationLoop`` (backend.services.simulation_loop) computed
``simulated_hour = self.hours_per_round`` for *every* round — a constant
that never advanced. None of the downstream code (agent selection,
report grounding, propagation timing) could reason about "morning" or
"quarter-end" because the clock was decorative.

This module implements the v2 clock that the loop-engine-v2 spec §T1.1
calls for:

* Single ``advance(hours)`` call returns ``(day_bump, hour_of_day)``
  using one :func:`divmod`; the caller does not have to do any
  arithmetic to figure out what day it is now.
* Derives ``day_index``, ``day_of_week``, ``quarter``, ``fiscal_year``
  on the fly from a single monotonic ``total_hours`` counter.
* Exposes the substantive temporal predicates that the
  :class:`~backend.services.loop.scheduler.AgentScheduler` (T1.7) needs:
  ``is_business_hours``, ``is_quarter_boundary``,
  ``days_into_quarter``.

Invariants
----------
* ``0 <= self.hour_of_day < 24``
* ``self.day_index >= 0``
* ``self.fiscal_year >= 1`` (the first fiscal year is year 1)
* ``1 <= self.quarter <= 4``
* ``0 <= self.day_of_week < 7`` (0 = Monday, 6 = Sunday)
* After ``advance(h)``: ``self.total_hours`` increases by exactly ``h``.

All of these are validated in ``backend/tests/unit/test_sim_clock.py``.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple

# Calendar constants. Year length 360 keeps quarter math simple
# (a quarter is exactly 90 days, 3 months of 30 days).  The spec
# accepts this simplification — see loop-engine-v2-implementation.md §T1.1.
DAYS_PER_WEEK: int = 7
DAYS_PER_MONTH: int = 30
MONTHS_PER_QUARTER: int = 3
DAYS_PER_QUARTER: int = DAYS_PER_MONTH * MONTHS_PER_QUARTER  # 90
QUARTERS_PER_YEAR: int = 4
DAYS_PER_YEAR: int = DAYS_PER_QUARTER * QUARTERS_PER_YEAR  # 360
HOURS_PER_DAY: int = 24

# A business day is 9am-5pm local. We keep the bounds inclusive of 9
# and exclusive of 17 so that the morning of day-rollover is *not*
# considered business hours (otherwise quarter-end bursts double-fire).
BUSINESS_HOUR_START: int = 9
BUSINESS_HOUR_END: int = 17

# Day-of-week labels (Monday-first; matches ``datetime.weekday()``).
DAY_OF_WEEK_NAMES: Tuple[str, ...] = (
    "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY",
    "SATURDAY", "SUNDAY",
)


@dataclass
class SimClock:
    """Calendar-aware monotonic clock for the v2 simulation loop.

    The clock has no awareness of "the real world" — it tracks
    ``total_hours`` from a configurable start hour. All derived
    attributes are computed on read so that they cannot drift from
    the underlying counter.
    """

    total_hours: int = 0
    """Monotonic counter. Always increases — clock never rewinds."""
    timezone_offset: int = 0
    """Hours added to ``hour_of_day`` for *local* business-hours checks.

    The simulation engine itself is timezone-agnostic; agents use this
    offset to convert world time to their local frame (e.g. a NY-based
    CFO with ``timezone_offset = -5`` sees the start of a 9-5 window
    5 hours later than the clock's UTC-style ``hour_of_day``).
    """

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------
    def __post_init__(self) -> None:
        if self.total_hours < 0:
            raise ValueError(
                f"total_hours must be >= 0, got {self.total_hours}"
            )
        # ``timezone_offset`` is intentionally permissive — it is
        # expected to be in [-23, 23].  We do not enforce it because
        # tests may want to exercise the boundary.

    # ------------------------------------------------------------------
    # Advance — the load-bearing method
    # ------------------------------------------------------------------
    def advance(self, hours: int) -> Tuple[int, int]:
        """Advance the clock by ``hours`` and return ``(day_bump, new_hour_of_day)``.

        The implementation is a single :func:`divmod` so the math is
        impossible to get wrong. ``day_bump`` is the number of *new*
        day-boundaries the clock crossed during the advance (>=0); it
        is useful for the scheduler to know "we rolled into Monday
        at 09:00" without having to compare before/after day_index
        values.
        """
        if hours < 0:
            raise ValueError(f"advance() requires non-negative hours, got {hours}")
        if hours == 0:
            return 0, self.hour_of_day

        previous_day = self.day_index
        self.total_hours += hours
        new_day = self.day_index
        return (new_day - previous_day), self.hour_of_day

    # ------------------------------------------------------------------
    # Derived temporal properties — read-only
    # ------------------------------------------------------------------
    @property
    def hour_of_day(self) -> int:
        """UTC-style hour within the current day, ``0..23``."""
        return self.total_hours % HOURS_PER_DAY

    @property
    def day_index(self) -> int:
        """Day number since clock start, 0-based."""
        return self.total_hours // HOURS_PER_DAY

    @property
    def day_of_week(self) -> int:
        """0=Monday, 6=Sunday."""
        return self.day_index % DAYS_PER_WEEK

    @property
    def day_of_month(self) -> int:
        """1-based day of the 30-day month, ``1..30``."""
        return (self.day_index % DAYS_PER_MONTH) + 1

    @property
    def month_index(self) -> int:
        """0-based month within the current fiscal year, ``0..11``.

        Cycles 0..11 across years — e.g. day 0 -> 0, day 359 -> 11,
        day 360 -> 0 (year 2), day 720 -> 0 (year 3).
        """
        return (self.day_index // DAYS_PER_MONTH) % (QUARTERS_PER_YEAR * MONTHS_PER_QUARTER)

    @property
    def quarter(self) -> int:
        """1-based fiscal quarter, ``1..4``."""
        return ((self.day_index // DAYS_PER_QUARTER) % QUARTERS_PER_YEAR) + 1

    @property
    def fiscal_year(self) -> int:
        """1-based fiscal year. The first year of the simulation is year 1."""
        return (self.day_index // DAYS_PER_YEAR) + 1

    @property
    def day_of_quarter(self) -> int:
        """0-based day of the 90-day quarter, ``0..89``."""
        return self.day_index % DAYS_PER_QUARTER

    @property
    def days_into_quarter(self) -> int:
        """1-based day of the quarter, ``1..90``."""
        return self.day_of_quarter + 1

    # ------------------------------------------------------------------
    # Substantive temporal predicates (used by AgentScheduler v2)
    # ------------------------------------------------------------------
    def is_business_hours(self, timezone_offset: int = 0) -> bool:
        """True iff the *local* hour is within the 9-17 business window.

        ``timezone_offset`` defaults to 0; pass the agent's
        ``timezone_offset`` field to get the agent's local business
        hours. The clock itself is timezone-agnostic — this is just
        modular arithmetic.
        """
        local_hour = (self.hour_of_day + timezone_offset) % HOURS_PER_DAY
        return BUSINESS_HOUR_START <= local_hour < BUSINESS_HOUR_END

    def is_weekday(self) -> bool:
        """True iff the current day is Mon-Fri."""
        return self.day_of_week < 5

    def is_quarter_boundary(self) -> bool:
        """True iff today is the first or last day of a fiscal quarter.

        The boundary is inclusive of both endpoints (day 1 of a
        quarter AND day 90) so the board can act either at kickoff or
        wrap-up.
        """
        return self.days_into_quarter in (1, DAYS_PER_QUARTER)

    def is_year_boundary(self) -> bool:
        """True iff today is the last day of a fiscal year."""
        return self.day_index > 0 and (self.day_index + 1) % DAYS_PER_YEAR == 0

    def is_business_day(self, timezone_offset: int = 0) -> bool:
        """True iff it is a weekday AND business hours in the local frame."""
        return self.is_weekday() and self.is_business_hours(timezone_offset)

    # ------------------------------------------------------------------
    # Display
    # ------------------------------------------------------------------
    def simulated_label(self, round_num: int, time_step: str) -> str:
        """把 round_num + time_step 转成人类可读 label (Month 3 / Q2 Year 1 / Day 90 等)."""
        if time_step == "day":
            return f"Day {round_num}"
        if time_step == "week":
            return f"Week {round_num}"
        if time_step == "month":
            return f"Month {round_num}"
        if time_step == "quarter":
            year_offset, q = divmod(round_num - 1, 4)
            return f"Q{q + 1} Year {year_offset + 1}"
        if time_step == "year":
            return f"Year {round_num}"
        return f"Round {round_num}"

    def describe(self) -> dict:
        """Snapshot of the clock — used by SSE payloads and tests."""
        return {
            "total_hours": self.total_hours,
            "hour_of_day": self.hour_of_day,
            "day_index": self.day_index,
            "day_of_week": self.day_of_week,
            "day_of_week_name": DAY_OF_WEEK_NAMES[self.day_of_week],
            "day_of_month": self.day_of_month,
            "quarter": self.quarter,
            "fiscal_year": self.fiscal_year,
            "day_of_quarter": self.day_of_quarter,
            "days_into_quarter": self.days_into_quarter,
            "is_business_hours": self.is_business_hours(),
            "is_quarter_boundary": self.is_quarter_boundary(),
            "is_year_boundary": self.is_year_boundary(),
        }

    def __repr__(self) -> str:  # pragma: no cover - cosmetic
        return (
            f"SimClock(total_hours={self.total_hours}, "
            f"hour={self.hour_of_day:02d}, "
            f"day={self.day_index}, "
            f"Q{self.quarter}-Y{self.fiscal_year})"
        )


__all__ = [
    "SimClock",
    "DAYS_PER_WEEK",
    "DAYS_PER_MONTH",
    "DAYS_PER_QUARTER",
    "DAYS_PER_YEAR",
    "HOURS_PER_DAY",
    "BUSINESS_HOUR_START",
    "BUSINESS_HOUR_END",
    "DAY_OF_WEEK_NAMES",
]
