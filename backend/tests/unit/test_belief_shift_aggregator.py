"""
Tests for belief_shift aggregation + throttled emit logic in pipeline_orchestrator.

覆盖:
  (1) _classify_belief_shift 处理多种字段名 (position_delta / delta / shift / old+new)
  (2) _classify_belief_shift 字段缺失时返回 0 (不抛错)
  (3) _aggregate_belief_shift_count 阈值过滤 (|delta| > 0.10)
  (4) _aggregate_belief_shift_count 空输入返回 0
  (5) _aggregate_belief_shift_count 5 轮 mock 期望
  (6) _emit_belief_shifts 节流: 同一 (round, agent) 在 0.5s 内最多 1 条
  (7) _emit_belief_shifts 返回实际 emit 数
  (8) _emit_belief_shifts 字段缺失/异常 update 不抛错
"""
import time
import pytest

from backend.services.pipeline_orchestrator import (
    _classify_belief_shift,
    _aggregate_belief_shift_count,
    _emit_belief_shifts,
    reset_belief_shift_throttle,
    BELIEF_SHIFT_THRESHOLD,
)


@pytest.fixture(autouse=True)
def _clear_throttle():
    """每个测试前清空节流字典."""
    reset_belief_shift_throttle()
    yield
    reset_belief_shift_throttle()


class _FakeBus:
    def __init__(self):
        self.events = []

    def emit(self, run_id, event_type, data, stage=None):
        self.events.append((run_id, event_type, data, stage))


# ---------------------------------------------------------------------------
# _classify_belief_shift
# ---------------------------------------------------------------------------


def test_classify_prefers_position_delta_key():
    assert _classify_belief_shift({"position_delta": 0.5}) == 0.5


def test_classify_falls_back_to_delta_then_shift():
    assert _classify_belief_shift({"delta": 0.3}) == 0.3
    assert _classify_belief_shift({"shift": -0.2}) == 0.2  # abs()


def test_classify_computes_from_old_new_positions():
    assert _classify_belief_shift({"old_position": 0.1, "new_position": 0.5}) == pytest.approx(0.4)


def test_classify_returns_zero_for_missing_fields():
    assert _classify_belief_shift({}) == 0.0
    assert _classify_belief_shift({"agent_id": "a1"}) == 0.0  # 无 position 信息


def test_classify_does_not_throw_on_garbage():
    assert _classify_belief_shift({"old_position": None, "new_position": "x"}) == 0.0
    assert _classify_belief_shift({"delta": object()}) == 0.0


# ---------------------------------------------------------------------------
# _aggregate_belief_shift_count
# ---------------------------------------------------------------------------


def test_aggregate_empty_returns_zero():
    assert _aggregate_belief_shift_count([]) == 0
    assert _aggregate_belief_shift_count(None) == 0  # type: ignore[arg-type]


def test_aggregate_filters_by_threshold():
    updates = [
        {"agent_id": "a1", "delta": 0.50},  # shift (> 0.10)
        {"agent_id": "a2", "delta": 0.05},  # tiny
        {"agent_id": "a3", "delta": 0.20},  # shift
        {"agent_id": "a4", "delta": -0.30},  # shift
        {"agent_id": "a5", "old_position": 0.0, "new_position": 0.15},  # shift (0.15 > 0.10)
        {"agent_id": "a6", "old_position": 0.5, "new_position": 0.55},  # tiny (0.05)
    ]
    assert _aggregate_belief_shift_count(updates) == 4  # a1, a3, a4, a5


def test_aggregate_handles_non_dict_items():
    """Dict 列表中混有 None / 字符串 / dict, 不抛错."""
    updates = [
        {"delta": 0.3},
        None,
        "not a dict",
        42,
        {"delta": 0.5},
    ]
    assert _aggregate_belief_shift_count(updates) == 2


def test_aggregate_five_rounds_mock():
    """Mock 5 轮 belief_updates, 每轮 random-ish shift count, 累计应符合预期."""
    rounds = [
        [{"delta": 0.20}, {"delta": 0.05}],                  # R1: 1 shift
        [{"delta": 0.30}],                                  # R2: 1 shift
        [{"delta": 0.02}, {"delta": 0.02}],                 # R3: 0
        [{"delta": 0.50}, {"delta": -0.20}, {"delta": 0.0}],  # R4: 2 shift (50%, 20%)
        [{"old_position": 0.0, "new_position": 0.25}],      # R5: 1 shift
    ]
    expected_per_round = [1, 1, 0, 2, 1]
    actual = [len(u) and _aggregate_belief_shift_count(u) for u in rounds]
    assert actual == expected_per_round
    # 累计
    total = sum(_aggregate_belief_shift_count(u) for u in rounds)
    assert total == 5


# ---------------------------------------------------------------------------
# _emit_belief_shifts
# ---------------------------------------------------------------------------


def test_emit_returns_zero_for_empty():
    bus = _FakeBus()
    assert _emit_belief_shifts(bus, "r1", 1, []) == 0
    assert bus.events == []


def test_emit_skips_updates_below_threshold():
    bus = _FakeBus()
    updates = [
        {"agent_id": "a1", "delta": 0.05},  # tiny
        {"agent_id": "a2", "delta": 0.10},  # exactly threshold, not strictly >
    ]
    n = _emit_belief_shifts(bus, "r1", 1, updates)
    assert n == 0
    assert bus.events == []


def test_emit_sends_one_event_per_shift():
    bus = _FakeBus()
    updates = [
        {"agent_id": "a1", "delta": 0.30, "old_position": 0.1, "new_position": 0.4},
        {"agent_id": "a2", "delta": 0.20},
    ]
    n = _emit_belief_shifts(bus, "r1", 1, updates)
    assert n == 2
    assert len(bus.events) == 2
    for run_id, evt_type, data, stage in bus.events:
        assert run_id == "r1"
        assert evt_type == "belief_shift"
        assert stage == "SIMULATION_RUNNING"
        assert "agent_id" in data
        assert "delta" in data
        assert data["delta"] > BELIEF_SHIFT_THRESHOLD
        assert "ts" in data


def test_emit_throttles_same_round_agent_pair():
    bus = _FakeBus()
    base = time.time()
    updates = [{"agent_id": "a1", "delta": 0.30}]
    # 第 1 次 emit
    n1 = _emit_belief_shifts(bus, "r1", 1, updates, now=base)
    # 同一 (round, agent) 0.2s 后再 emit → 节流跳过
    n2 = _emit_belief_shifts(bus, "r1", 1, updates, now=base + 0.2)
    # 1.0s 后 (> 0.5s 窗口) → 允许 emit
    n3 = _emit_belief_shifts(bus, "r1", 1, updates, now=base + 1.0)
    assert n1 == 1
    assert n2 == 0
    assert n3 == 1
    assert len(bus.events) == 2


def test_emit_skips_garbage_updates():
    bus = _FakeBus()
    updates = [
        {"delta": 0.30},  # 缺 agent_id — 应跳过
        None,
        "x",
        {"agent_id": "a1", "delta": 0.40},  # valid
    ]
    n = _emit_belief_shifts(bus, "r1", 1, updates)
    assert n == 1
    assert len(bus.events) == 1
    _, _, data, _ = bus.events[0]
    assert data["agent_id"] == "a1"


def test_emit_does_not_throw_on_garbage_now():
    bus = _FakeBus()
    updates = [{"agent_id": "a1", "delta": 0.40}]
    # now=None → time.time() fallback
    n = _emit_belief_shifts(bus, "r1", 1, updates, now=None)
    assert n == 1
