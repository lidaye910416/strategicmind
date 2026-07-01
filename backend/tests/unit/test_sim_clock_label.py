"""
SimClock.simulated_label — 时间步长 → 人类可读 label.

Acceptance: 5 种 time_step 各自的 label 格式正确.
"""
from __future__ import annotations

import pytest

from backend.services.loop.clock import SimClock


@pytest.mark.parametrize("time_step,round_num,expected", [
    ("day", 1, "Day 1"),
    ("day", 30, "Day 30"),
    ("week", 1, "Week 1"),
    ("week", 12, "Week 12"),
    ("month", 1, "Month 1"),
    ("month", 12, "Month 12"),
    ("quarter", 1, "Q1 Year 1"),
    ("quarter", 4, "Q4 Year 1"),
    ("quarter", 5, "Q1 Year 2"),
    ("year", 1, "Year 1"),
    ("year", 3, "Year 3"),
])
def test_simulated_label_format(time_step, round_num, expected):
    clock = SimClock()
    assert clock.simulated_label(round_num, time_step) == expected


def test_simulated_label_unknown_time_step_falls_back():
    clock = SimClock()
    assert clock.simulated_label(3, "decade") == "Round 3"