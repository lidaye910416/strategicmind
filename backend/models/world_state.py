"""
WorldState — the missing state model for the v2 loop engine.

This dataclass captures the six structural slices that the v1 simulation
left implicit (and which the audit identified as the #1 cause of
"mediocre emergence" — see docs/superpowers/specs/loop-engine-v2-implementation.md §1.1).

The six slices:

* ``coalitions``     — agent ↔ agent groupings (FORM_COALITION, broadcasts trust)
* ``budget_ledger``  — department × project funding (PIVOT_STRATEGY, ALLOCATE_BUDGET)
* ``asset_registry`` — owned, transferable assets (TRADE_ASSET, CONCEALED_TRADE)
* ``proposals``      — proposals with PENDING / ENDORSED / BLOCKED status
* ``beliefs``        — per-agent BeliefVector (positions + confidence)
* ``events``         — append-only log of state-affecting events

The class is deliberately a plain dataclass (no DB, no async) so that:

1. ``diff(prev)`` can be unit-tested in isolation.
2. ``to_dict`` / ``from_dict`` round-trip is lossless (acceptance criterion).
3. Phase 1 can build :class:`ActionResolver` and :class:`MemoryWriteback`
   against this single source of truth.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set


# ---------------------------------------------------------------------------
# Type aliases — string IDs are intentional. The simulation already uses
# str agent_id / proposal_id everywhere; we follow that convention so the
# resolver can be wired up without an extra ID layer.
# ---------------------------------------------------------------------------
CoalitionId = str
ProjectId = str
AssetId = str
ProposalId = str
AgentId = str
TopicId = str


class ProposalStatus(str, Enum):
    """Lifecycle of a proposal in the world state."""

    PENDING = "PENDING"
    ENDORSED = "ENDORSED"
    BLOCKED = "BLOCKED"

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.value


@dataclass
class AssetEntry:
    """A single asset in the world (IP, equity, contract, ...)."""

    owner: AgentId
    value: float
    transferable: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AssetEntry":
        return cls(
            owner=data.get("owner", ""),
            value=float(data.get("value", 0.0)),
            transferable=bool(data.get("transferable", True)),
        )


@dataclass
class ProposalEntry:
    """A proposal that can be ENDORSED / BLOCKED / remain PENDING."""

    status: ProposalStatus = ProposalStatus.PENDING
    proposed_by: AgentId = ""
    target: str = ""
    amount: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status.value,
            "proposed_by": self.proposed_by,
            "target": self.target,
            "amount": self.amount,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ProposalEntry":
        status_raw = data.get("status", ProposalStatus.PENDING.value)
        if isinstance(status_raw, ProposalStatus):
            status = status_raw
        else:
            try:
                status = ProposalStatus(str(status_raw))
            except ValueError:
                status = ProposalStatus.PENDING
        return cls(
            status=status,
            proposed_by=data.get("proposed_by", ""),
            target=data.get("target", ""),
            amount=float(data.get("amount", 0.0)),
        )


@dataclass
class BeliefVector:
    """Compact per-agent belief snapshot.

    Position + confidence per topic. Stored as a flat dict for cheap
    diffing — the full :class:`BeliefState` lives on
    :class:`StrategicAgent` and is what the agent loop mutates.
    """

    positions: Dict[TopicId, float] = field(default_factory=dict)
    confidence: Dict[TopicId, float] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {"positions": dict(self.positions), "confidence": dict(self.confidence)}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "BeliefVector":
        return cls(
            positions=dict(data.get("positions", {})),
            confidence=dict(data.get("confidence", {})),
        )


@dataclass
class ChangeRecord:
    """One entry in a ``WorldState.diff(prev)`` result.

    ``slice`` names the world-state slice that changed; ``op`` describes
    the kind of change. ``path`` is a dotted path inside the slice so the
    caller can route the diff to the right resolver (e.g. ``"coalitions.c1"``).
    """

    slice: str
    op: str
    path: str
    before: Any = None
    after: Any = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "slice": self.slice,
            "op": self.op,
            "path": self.path,
            "before": self.before,
            "after": self.after,
        }


# ---------------------------------------------------------------------------
# WorldState
# ---------------------------------------------------------------------------


@dataclass
class WorldState:
    """Aggregate simulation state — the v2 source of truth.

    The constructor initialises every slice to its empty value so the
    dataclass can be built with no arguments (``WorldState()``) and the
    round-loop can mutate it freely. Slices are public so that tests
    can read them directly.
    """

    coalitions: Dict[CoalitionId, Set[AgentId]] = field(default_factory=dict)
    budget_ledger: Dict[ProjectId, float] = field(default_factory=dict)
    asset_registry: Dict[AssetId, AssetEntry] = field(default_factory=dict)
    proposals: Dict[ProposalId, ProposalEntry] = field(default_factory=dict)
    beliefs: Dict[AgentId, BeliefVector] = field(default_factory=dict)
    events: List[Dict[str, Any]] = field(default_factory=list)

    # ------------------------------------------------------------------
    # Serialisation
    # ------------------------------------------------------------------
    def to_dict(self) -> Dict[str, Any]:
        """Lossless dict form. ``events`` is preserved verbatim."""
        return {
            "coalitions": {cid: sorted(members) for cid, members in self.coalitions.items()},
            "budget_ledger": dict(self.budget_ledger),
            "asset_registry": {
                aid: entry.to_dict() for aid, entry in self.asset_registry.items()
            },
            "proposals": {pid: entry.to_dict() for pid, entry in self.proposals.items()},
            "beliefs": {aid: vec.to_dict() for aid, vec in self.beliefs.items()},
            "events": [copy.deepcopy(e) for e in self.events],
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WorldState":
        """Inverse of :meth:`to_dict`. Tolerates missing keys."""
        coalitions_raw = data.get("coalitions", {}) or {}
        coalitions: Dict[CoalitionId, Set[AgentId]] = {
            cid: set(members) for cid, members in coalitions_raw.items()
        }
        budget_ledger = dict(data.get("budget_ledger", {}) or {})
        asset_registry = {
            aid: AssetEntry.from_dict(entry)
            for aid, entry in (data.get("asset_registry", {}) or {}).items()
        }
        proposals = {
            pid: ProposalEntry.from_dict(entry)
            for pid, entry in (data.get("proposals", {}) or {}).items()
        }
        beliefs = {
            aid: BeliefVector.from_dict(vec)
            for aid, vec in (data.get("beliefs", {}) or {}).items()
        }
        events = [dict(e) for e in (data.get("events", []) or [])]
        return cls(
            coalitions=coalitions,
            budget_ledger=budget_ledger,
            asset_registry=asset_registry,
            proposals=proposals,
            beliefs=beliefs,
            events=events,
        )

    # ------------------------------------------------------------------
    # Diff — the load-bearing operation for the audit
    # ------------------------------------------------------------------
    @staticmethod
    def _diff_slice(
        slice_name: str,
        prev_dict: Dict[Any, Any],
        cur_dict: Dict[Any, Any],
        value_to_dict: Optional[Callable[[Any], Any]] = None,
    ) -> List[ChangeRecord]:
        """Compute one :class:`ChangeRecord` per key whose value changed.

        For each key in the sorted union of ``prev_dict`` and ``cur_dict``:

        * missing in ``prev_dict`` → ``op="added"`` (after only)
        * missing in ``cur_dict`` → ``op="removed"`` (before only)
        * present in both, value unchanged → no record
        * present in both, value changed → ``op="mutated"`` (before + after)

        ``value_to_dict`` optionally normalises values before comparison
        (e.g. ``AssetEntry.to_dict`` or ``sorted(set)`` for coalitions).
        """
        records: List[ChangeRecord] = []

        def _norm(value: Any) -> Any:
            if value is None:
                return None
            if value_to_dict is not None:
                return value_to_dict(value)
            return value

        all_keys = sorted(set(prev_dict) | set(cur_dict))
        for key in all_keys:
            in_prev = key in prev_dict
            in_cur = key in cur_dict

            if in_prev and in_cur:
                before = _norm(prev_dict[key])
                after = _norm(cur_dict[key])
                if before == after:
                    continue
                records.append(
                    ChangeRecord(
                        slice=slice_name,
                        op="mutated",
                        path=str(key),
                        before=before,
                        after=after,
                    )
                )
            elif in_cur and not in_prev:
                records.append(
                    ChangeRecord(
                        slice=slice_name,
                        op="added",
                        path=str(key),
                        before=None,
                        after=_norm(cur_dict[key]),
                    )
                )
            elif in_prev and not in_cur:
                records.append(
                    ChangeRecord(
                        slice=slice_name,
                        op="removed",
                        path=str(key),
                        before=_norm(prev_dict[key]),
                        after=None,
                    )
                )

        return records

    def diff(self, prev: "WorldState") -> List[ChangeRecord]:
        """Return one :class:`ChangeRecord` per slice that changed.

        * New events are emitted as one record per new event (not one
          per slice), so the report can quote them.
        * Empty / missing slices do not produce records — the resolver
          can ignore the diff when there is nothing to do.

        The function is intentionally pure: no I/O, no mutation.
        """
        records: List[ChangeRecord] = []

        # --- coalitions ------------------------------------------------
        prev_coal = prev.coalitions if prev else {}
        records.extend(
            self._diff_slice(
                "coalitions",
                prev_coal,
                self.coalitions,
                value_to_dict=lambda v: sorted(v),
            )
        )

        # --- budget_ledger --------------------------------------------
        prev_bud = prev.budget_ledger if prev else {}
        records.extend(
            self._diff_slice("budget_ledger", prev_bud, self.budget_ledger)
        )

        # --- asset_registry -------------------------------------------
        prev_assets = prev.asset_registry if prev else {}
        records.extend(
            self._diff_slice(
                "asset_registry",
                prev_assets,
                self.asset_registry,
                value_to_dict=lambda v: v.to_dict(),
            )
        )

        # --- proposals -------------------------------------------------
        prev_props = prev.proposals if prev else {}
        records.extend(
            self._diff_slice(
                "proposals",
                prev_props,
                self.proposals,
                value_to_dict=lambda v: v.to_dict(),
            )
        )

        # --- beliefs ---------------------------------------------------
        prev_beliefs = prev.beliefs if prev else {}
        records.extend(
            self._diff_slice(
                "beliefs",
                prev_beliefs,
                self.beliefs,
                value_to_dict=lambda v: v.to_dict(),
            )
        )

        # --- events (append-only log) ---------------------------------
        prev_events = list(prev.events) if prev else []
        new_events = list(self.events[len(prev_events):])
        for idx, evt in enumerate(new_events, start=len(prev_events)):
            records.append(
                ChangeRecord(
                    slice="events",
                    op="appended",
                    path=str(idx),
                    before=None,
                    after=copy.deepcopy(evt),
                )
            )

        return records

    # ------------------------------------------------------------------
    # Convenience mutators — pure ergonomics for Phase 1's resolver.
    # They are NOT required for the audit; Phase 1 may add more.
    # ------------------------------------------------------------------
    def add_event(self, event: Dict[str, Any]) -> None:
        """Append an event to the log (helper for tests + resolver)."""
        self.events.append(dict(event))


__all__ = [
    "WorldState",
    "ChangeRecord",
    "AssetEntry",
    "ProposalEntry",
    "ProposalStatus",
    "BeliefVector",
    "CoalitionId",
    "ProjectId",
    "AssetId",
    "ProposalId",
    "AgentId",
    "TopicId",
]
