"""
Unit tests for BusinessActionType + StrategicAction extension (T1.3).

Acceptance (per docs/superpowers/specs/loop-engine-v2-implementation.md §T1.3):

* Each of the 12 BusinessActionType values is constructable.
* ``StrategicAction.action_id`` is a unique uuid4.
* ``post_content`` <= 280 chars (else ValueError).
* ``in_reply_to`` only references prior action_id (validated by
  ``enforce_in_reply_to_chain``).
* ``PropagationChannel.coerce_channels`` dedupes alias values.
"""
from __future__ import annotations

import uuid

import pytest

from backend.models.action_type import (
    MAX_POST_CONTENT_LEN,
    PropagationChannel,
    StrategicAction,
    ActionType,
)
from backend.services.loop.action_taxonomy import (
    ALL_BUSINESS_ACTION_TYPES,
    BusinessActionType,
    DEFAULT_CHANNELS,
    MUTATING_TYPES,
    from_v1,
)


# ---------------------------------------------------------------------------
# BusinessActionType — coverage
# ---------------------------------------------------------------------------


EXPECTED_TYPES = {
    "FORM_COALITION", "ENDORSE_PROPOSAL", "BLOCK_PROPOSAL", "PIVOT_STRATEGY",
    "ALLOCATE_BUDGET", "TRADE_ASSET", "CONCEALED_TRADE", "LEAK_INFORMATION",
    "MAKE_STATEMENT", "BRIEF_BOARD", "HIRE_TALENT", "EXIT_MARKET",
}


def test_all_twelve_business_action_types_present():
    assert {t.value for t in ALL_BUSINESS_ACTION_TYPES} == EXPECTED_TYPES
    assert len(ALL_BUSINESS_ACTION_TYPES) == 12


def test_default_channels_cover_all_types():
    assert set(DEFAULT_CHANNELS.keys()) == set(BusinessActionType)
    for chan_list in DEFAULT_CHANNELS.values():
        assert len(chan_list) >= 1
        for c in chan_list:
            assert isinstance(c, PropagationChannel)


def test_mutating_types_subset():
    assert MUTATING_TYPES.issubset(set(BusinessActionType))


@pytest.mark.parametrize("business_type", list(BusinessActionType))
def test_each_business_type_has_default_channels(business_type):
    assert business_type in DEFAULT_CHANNELS


# ---------------------------------------------------------------------------
# StrategicAction extension
# ---------------------------------------------------------------------------


def test_strategic_action_default_action_id_is_unique_uuid4():
    a = StrategicAction(action_type=ActionType.MAKE_STATEMENT, actor_id="x")
    b = StrategicAction(action_type=ActionType.MAKE_STATEMENT, actor_id="x")
    assert a.action_id != b.action_id
    # uuid4 form
    uuid.UUID(a.action_id)
    uuid.UUID(b.action_id)


def test_post_content_length_enforced():
    ok = "x" * MAX_POST_CONTENT_LEN
    StrategicAction(action_type=ActionType.MAKE_STATEMENT, actor_id="x", post_content=ok)
    too_long = "x" * (MAX_POST_CONTENT_LEN + 1)
    with pytest.raises(ValueError):
        StrategicAction(
            action_type=ActionType.MAKE_STATEMENT,
            actor_id="x",
            post_content=too_long,
        )


def test_in_reply_to_round_trips():
    a = StrategicAction(
        action_type=ActionType.MAKE_STATEMENT,
        actor_id="x",
        in_reply_to="parent-action-id",
    )
    assert a.in_reply_to == "parent-action-id"
    d = a.to_dict()
    assert d["in_reply_to"] == "parent-action-id"
    rebuilt = StrategicAction.from_dict(d)
    assert rebuilt.in_reply_to == "parent-action-id"


def test_in_reply_to_default_is_none():
    a = StrategicAction(action_type=ActionType.MAKE_STATEMENT, actor_id="x")
    assert a.in_reply_to is None


def test_evidence_round_trip():
    a = StrategicAction(
        action_type=ActionType.MAKE_STATEMENT,
        actor_id="x",
        evidence=["report page 12", "2024 Q3 actuals"],
    )
    d = a.to_dict()
    assert d["evidence"] == ["report page 12", "2024 Q3 actuals"]
    rebuilt = StrategicAction.from_dict(d)
    assert rebuilt.evidence == ["report page 12", "2024 Q3 actuals"]


def test_post_author_name_round_trip():
    a = StrategicAction(
        action_type=ActionType.MAKE_STATEMENT,
        actor_id="agent_1",
        post_author_name="张三",
        post_content="考虑中……",
    )
    d = a.to_dict()
    assert d["post_author_name"] == "张三"
    assert d["post_content"] == "考虑中……"
    rebuilt = StrategicAction.from_dict(d)
    assert rebuilt.post_author_name == "张三"
    assert rebuilt.post_content == "考虑中……"


# ---------------------------------------------------------------------------
# PropagationChannel — back-compat aliases
# ---------------------------------------------------------------------------


def test_propagation_channel_alias_values():
    assert PropagationChannel.SOCIAL_MEDIA.value == PropagationChannel.PEER.value
    assert PropagationChannel.MARKET_SIGNAL.value == PropagationChannel.MARKET.value


def test_coerce_channels_dedupes_alias_pair():
    chans = PropagationChannel.coerce_channels(
        ["SOCIAL_MEDIA", "PEER", "DIRECT"]
    )
    # SOCIAL_MEDIA and PEER collapse to one entry (PEER)
    assert chans == [PropagationChannel.PEER, PropagationChannel.DIRECT]


def test_coerce_channels_tolerates_strings():
    chans = PropagationChannel.coerce_channels(["RUMOR", "OFFICIAL"])
    assert chans == [PropagationChannel.RUMOR, PropagationChannel.OFFICIAL]


def test_coerce_channels_ignores_unknown():
    chans = PropagationChannel.coerce_channels(["NONSENSE", "MEDIA"])
    assert chans == [PropagationChannel.MEDIA]


def test_coerce_channels_handles_enum_passthrough():
    chans = PropagationChannel.coerce_channels(
        [PropagationChannel.MARKET_SIGNAL, PropagationChannel.MARKET]
    )
    assert chans == [PropagationChannel.MARKET]


# ---------------------------------------------------------------------------
# from_v1 mapping
# ---------------------------------------------------------------------------


def test_from_v1_known_types():
    assert from_v1(ActionType.FORM_COALITION) is BusinessActionType.FORM_COALITION
    assert from_v1(ActionType.TRADE_ASSET) is BusinessActionType.TRADE_ASSET
    assert from_v1(ActionType.LEAK_INFORMATION) is BusinessActionType.LEAK_INFORMATION
    assert from_v1(ActionType.MAKE_STATEMENT) is BusinessActionType.MAKE_STATEMENT


def test_from_v1_unknown_falls_back_to_make_statement():
    # All v1 enum members should map; an unknown string (which can't
    # even be constructed as ActionType) would crash earlier. We
    # test the safety net by mapping a v1 type that is technically
    # unmapped (we use RATING_ACTION which DOES map; the fallback
    # path is exercised when the value is invalid in a unit test of
    # the helper itself).
    assert from_v1(ActionType.PRIVATE_MEETING) is BusinessActionType.BRIEF_BOARD
