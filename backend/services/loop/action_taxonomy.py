"""
Action taxonomy for the loop-engine v2 (T1.3).

This module defines the 12 business action types that the LLM
actually sees during simulation. The v1 ``ActionType`` enum in
:mod:`backend.models.action_type` is broader (17 values, 3 of which
are decorative aliases of one another) and its ``_update_beliefs``
function maps every action to a constant 0.5 belief delta — the
audit identified this as the #1 cause of "mediocre emergence" (see
docs/superpowers/specs/loop-engine-v2-implementation.md §1.1).

The 12 v2 types are real, distinct state mutations; see
:mod:`backend.services.loop.action_resolver` for the per-type
``ACTION_PROFILE`` implementations.
"""
from __future__ import annotations

from enum import Enum
from typing import Dict, List, Set

from ...models.action_type import ActionType, PropagationChannel


class BusinessActionType(str, Enum):
    """The 12 loop-engine v2 business action types.

    Each type maps to a specific ``ACTION_PROFILE`` in
    :mod:`backend.services.loop.action_resolver`. The mapping from
    a v1 :class:`ActionType` to a v2 :class:`BusinessActionType` is
    best-effort (one-to-one for the v2 types; the v1-only types
    fall back to ``MAKE_STATEMENT``).
    """

    FORM_COALITION = "FORM_COALITION"
    ENDORSE_PROPOSAL = "ENDORSE_PROPOSAL"
    BLOCK_PROPOSAL = "BLOCK_PROPOSAL"
    PIVOT_STRATEGY = "PIVOT_STRATEGY"
    ALLOCATE_BUDGET = "ALLOCATE_BUDGET"
    TRADE_ASSET = "TRADE_ASSET"
    CONCEALED_TRADE = "CONCEALED_TRADE"
    LEAK_INFORMATION = "LEAK_INFORMATION"
    MAKE_STATEMENT = "MAKE_STATEMENT"
    BRIEF_BOARD = "BRIEF_BOARD"
    HIRE_TALENT = "HIRE_TALENT"
    EXIT_MARKET = "EXIT_MARKET"

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.value


# Public read-only tuple — handy for tests and the LLM prompt.
ALL_BUSINESS_ACTION_TYPES: tuple = tuple(BusinessActionType)


# Default propagation channels per action type. The resolver may
# override these (e.g. CONCEALED_TRADE adds a RUMOR channel) but the
# defaults below keep the LLM prompt and the unit tests honest.
DEFAULT_CHANNELS: Dict[BusinessActionType, List[PropagationChannel]] = {
    BusinessActionType.FORM_COALITION: [PropagationChannel.DIRECT, PropagationChannel.OFFICIAL],
    BusinessActionType.ENDORSE_PROPOSAL: [PropagationChannel.OFFICIAL],
    BusinessActionType.BLOCK_PROPOSAL: [PropagationChannel.OFFICIAL],
    BusinessActionType.PIVOT_STRATEGY: [PropagationChannel.OFFICIAL, PropagationChannel.MEDIA],
    BusinessActionType.ALLOCATE_BUDGET: [PropagationChannel.OFFICIAL],
    BusinessActionType.TRADE_ASSET: [PropagationChannel.MARKET_SIGNAL, PropagationChannel.OFFICIAL],
    BusinessActionType.CONCEALED_TRADE: [PropagationChannel.MARKET_SIGNAL, PropagationChannel.RUMOR],
    BusinessActionType.LEAK_INFORMATION: [PropagationChannel.RUMOR, PropagationChannel.MEDIA],
    BusinessActionType.MAKE_STATEMENT: [PropagationChannel.MEDIA],
    BusinessActionType.BRIEF_BOARD: [PropagationChannel.OFFICIAL],
    BusinessActionType.HIRE_TALENT: [PropagationChannel.DIRECT, PropagationChannel.OFFICIAL],
    BusinessActionType.EXIT_MARKET: [PropagationChannel.OFFICIAL, PropagationChannel.MEDIA],
}


# Set of action types that *create* a world-state node in the
# knowledge graph (per T1.5). Mutating actions get a CAUSED edge
# pointing at a first-class world_state_node.
MUTATING_TYPES: Set[BusinessActionType] = {
    BusinessActionType.FORM_COALITION,
    BusinessActionType.ENDORSE_PROPOSAL,
    BusinessActionType.BLOCK_PROPOSAL,
    BusinessActionType.PIVOT_STRATEGY,
    BusinessActionType.ALLOCATE_BUDGET,
    BusinessActionType.TRADE_ASSET,
    BusinessActionType.CONCEALED_TRADE,
    BusinessActionType.HIRE_TALENT,
    BusinessActionType.EXIT_MARKET,
}


_V1_TO_V2: Dict[ActionType, BusinessActionType] = {
    ActionType.FORM_COALITION: BusinessActionType.FORM_COALITION,
    ActionType.JOIN_COALITION: BusinessActionType.FORM_COALITION,
    ActionType.LEAVE_COALITION: BusinessActionType.BLOCK_PROPOSAL,
    ActionType.MAKE_STATEMENT: BusinessActionType.MAKE_STATEMENT,
    ActionType.PUBLISH_REPORT: BusinessActionType.MAKE_STATEMENT,
    ActionType.FILE_DOCUMENT: BusinessActionType.MAKE_STATEMENT,
    ActionType.PRIVATE_MEETING: BusinessActionType.BRIEF_BOARD,
    ActionType.LEAK_INFORMATION: BusinessActionType.LEAK_INFORMATION,
    ActionType.CONCEALED_TRADE: BusinessActionType.CONCEALED_TRADE,
    ActionType.PROPOSE_DEAL: BusinessActionType.ENDORSE_PROPOSAL,
    ActionType.COORDINATE_POSITION: BusinessActionType.ENDORSE_PROPOSAL,
    ActionType.NEGOTIATE: BusinessActionType.BRIEF_BOARD,
    ActionType.TRADE_ASSET: BusinessActionType.TRADE_ASSET,
    ActionType.ACCUMULATE_POSITION: BusinessActionType.ALLOCATE_BUDGET,
    ActionType.RATING_ACTION: BusinessActionType.MAKE_STATEMENT,
    ActionType.SHARE_INTEL: BusinessActionType.LEAK_INFORMATION,
    ActionType.SPREAD_NARRATIVE: BusinessActionType.MAKE_STATEMENT,
    ActionType.GATHER_INTEL: BusinessActionType.LEAK_INFORMATION,
}

# Reverse mapping — useful for tests that want to construct a
# StrategicAction for a v2-only BusinessActionType. We piggy-back on
# the v1 enum's existing string values (some v2 types share a v1
# value, e.g. FORM_COALITION); for v2-only types (HIRE_TALENT,
# EXIT_MARKET) we use SHARE_INTEL as a benign carrier — the
# resolver consults ``metadata.business_type`` to dispatch.
_BUSINESS_TYPE_META_KEY = "business_type"


def set_business_type(action: StrategicAction, btype: BusinessActionType) -> None:
    """Tag an action with an explicit v2 BusinessActionType.

    Use this for the v2-only types (HIRE_TALENT, EXIT_MARKET,
    BRIEF_BOARD) that don't have a clean v1 alias. The resolver
    reads this key first; it falls back to ``from_v1`` if absent.
    """
    md = action.metadata or {}
    md[_BUSINESS_TYPE_META_KEY] = btype.value
    action.metadata = md


def get_business_type(action: StrategicAction) -> BusinessActionType:
    """Resolve the v2 type for ``action``, preferring the explicit meta tag."""
    md = action.metadata or {}
    explicit = md.get(_BUSINESS_TYPE_META_KEY)
    if explicit:
        try:
            return BusinessActionType(str(explicit))
        except ValueError:
            pass
    return from_v1(action.action_type)


def from_v1(action_type: ActionType) -> BusinessActionType:
    """Map a v1 ``ActionType`` to a v2 ``BusinessActionType``.

    Unknown / un-mappable types fall back to ``MAKE_STATEMENT`` (the
    safest default for a public communication).
    """
    return _V1_TO_V2.get(action_type, BusinessActionType.MAKE_STATEMENT)


__all__ = [
    "BusinessActionType",
    "ALL_BUSINESS_ACTION_TYPES",
    "DEFAULT_CHANNELS",
    "MUTATING_TYPES",
    "from_v1",
]
