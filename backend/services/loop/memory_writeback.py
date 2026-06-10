"""
MemoryWriteback — loop-engine v2 (T1.5).

Every :class:`StrategicAction` taken during a round must be persisted
into the *same* knowledge graph that the report agent later queries,
not a parallel transcript. The audit's #2 root cause of "mediocre
emergence" (see docs/superpowers/specs/loop-engine-v2-implementation.md
§1.2) was that the simulation's events never reached the knowledge
store, so the report's verbatim-quote requirement degenerated into
hallucination.

This module writes for every action:

* 1 ``Episode`` node carrying the verbatim post_content (or a
  synthesised one from public_description when the post is empty).
* 1 ``PERFORMED`` edge from the actor to the Episode.
* 1 ``IN_REPLY_TO`` edge from the Episode to its predecessor (when
  ``in_reply_to`` is set).
* 1 ``CAUSED`` edge from the Episode to a first-class
  ``world_state_node`` whenever the action's resolver touched a
  structural slice (coalitions, budget_ledger, asset_registry,
  proposals). The world_state_node is created on-demand; it carries
  the post-action slice snapshot for that one slice.

Design notes
------------

* The writer is *agnostic* about the underlying graph store. The
  :class:`EpisodicMemory` helper below is the default in-process
  implementation, good enough for tests and the integration test in
  T1.5. A production wiring (T1.9) can swap in a Zep or neo4j
  implementation by passing a different ``graph_store`` object.
* ``Episode`` is a logical node type — we do not assume a class
  hierarchy. Each persisted node carries a ``node_type`` field so
  consumers (the report agent, the Workbench UI) can distinguish
  ``Episode`` / ``Agent`` / ``world_state_node`` by type.
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
import dataclasses
from typing import Any, Dict, List, Optional, Set

from ...models.action_type import (
    ActionType,
    PropagationChannel,
    StrategicAction,
)
from ...models.world_state import WorldState
from .action_resolver import ActionResolver
from .action_taxonomy import BusinessActionType, MUTATING_TYPES, get_business_type


EPISODE_NODE_TYPE = "Episode"
AGENT_NODE_TYPE = "Agent"
WORLD_STATE_NODE_TYPE = "WorldStateNode"

EDGE_PERFORMED = "PERFORMED"
EDGE_IN_REPLY_TO = "IN_REPLY_TO"
EDGE_CAUSED = "CAUSED"

# Set to ``False`` to disable the Step 6 feedback loop B2 mirror path
# (writes Episodes into LocalKnowledgeStore alongside the legacy
# EpisodicMemory file). Off by default so existing tests / pipelines
# that don't wire a knowledge store keep their current behaviour.
# Enable explicitly by setting env var STRATEGICMIND_EPISODE_MIRROR=1
# and passing ``knowledge_store=`` to :class:`MemoryWriteback`.
import os as _os
EPISODE_MIRROR_DEFAULT = _os.environ.get(
    "STRATEGICMIND_EPISODE_MIRROR", "0"
).lower() in ("1", "true", "yes", "on")

# Structural slices that get a world_state_node. The v2 resolver
# stamps "touched_slice" on action.metadata; the writer looks at
# that to decide whether to add a CAUSED edge.
_STRUCTURAL_SLICES: Set[str] = {
    "coalitions", "budget_ledger", "asset_registry", "proposals",
}


# ---------------------------------------------------------------------------
# In-process EpisodicMemory — default graph for tests + T1.5 acceptance.
# ---------------------------------------------------------------------------


@dataclass
class EpisodicMemory:
    """In-process graph store for Episodes + world_state_nodes.

    A real deployment would delegate to the
    :class:`LocalKnowledgeStore` (which in turn delegates to
    :class:`LocalGraphStore`); for the Phase 1 acceptance test we
    need a *deterministic* graph that we can query from a unit test,
    so this class writes a single JSON file under
    ``storage_path/<run_id>.episodic.json`` with the canonical
    ``{nodes, edges}`` shape (matching ``LocalGraphStore``).
    """

    storage_path: str = "./data/episodic_memory"
    nodes: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    edges: List[Dict[str, Any]] = field(default_factory=list)
    _file: Optional[str] = None

    def __post_init__(self) -> None:
        os.makedirs(self.storage_path, exist_ok=True)

    @classmethod
    def for_run(cls, run_id: str, storage_path: str = "./data/episodic_memory") -> "EpisodicMemory":
        """Create (or load) an episodic memory for ``run_id``."""
        m = cls(storage_path=storage_path)
        m._file = os.path.join(storage_path, f"{run_id}.episodic.json")
        if os.path.exists(m._file):
            try:
                with open(m._file, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                m.nodes = {n["id"]: n for n in raw.get("nodes", [])}
                m.edges = list(raw.get("edges", []))
            except Exception:
                # Defensive: if the file is corrupt, start fresh.
                m.nodes = {}
                m.edges = []
        return m

    # ----- node helpers -----

    def upsert_node(self, node_id: str, node_type: str, **fields: Any) -> Dict[str, Any]:
        existing = self.nodes.get(node_id, {"id": node_id, "node_type": node_type})
        existing["node_type"] = node_type
        for k, v in fields.items():
            existing[k] = v
        self.nodes[node_id] = existing
        return existing

    def add_edge(
        self,
        source_id: str,
        target_id: str,
        relation_type: str,
        **fields: Any,
    ) -> Dict[str, Any]:
        edge = {
            "source_id": source_id,
            "target_id": target_id,
            "relation_type": relation_type,
        }
        edge.update(fields)
        self.edges.append(edge)
        return edge

    # ----- graph queries (used by the acceptance test) -----

    def neighbors(self, node_id: str, relation_type: Optional[str] = None) -> List[Dict[str, Any]]:
        out = []
        for e in self.edges:
            if e["source_id"] == node_id:
                if relation_type is None or e["relation_type"] == relation_type:
                    target = self.nodes.get(e["target_id"])
                    if target is not None:
                        out.append(target)
        return out

    def has_edge(
        self, source_id: str, target_id: str, relation_type: str
    ) -> bool:
        for e in self.edges:
            if (
                e["source_id"] == source_id
                and e["target_id"] == target_id
                and e["relation_type"] == relation_type
            ):
                return True
        return False

    def shortest_hops(self, source_id: str, target_id: str) -> Optional[int]:
        """BFS hop count between two nodes; ``None`` when unreachable."""
        if source_id == target_id:
            return 0
        seen = {source_id}
        frontier = [source_id]
        depth = 0
        while frontier:
            depth += 1
            next_frontier: List[str] = []
            for nid in frontier:
                for e in self.edges:
                    if e["source_id"] != nid:
                        continue
                    if e["target_id"] in seen:
                        continue
                    if e["target_id"] == target_id:
                        return depth
                    seen.add(e["target_id"])
                    next_frontier.append(e["target_id"])
            frontier = next_frontier
        return None

    def count_episodes(self) -> int:
        return sum(1 for n in self.nodes.values() if n.get("node_type") == EPISODE_NODE_TYPE)

    # ----- recent-episode recall (Step 6 feedback loop B1) -----

    def recent_episodes(
        self,
        limit: int = 5,
        agent_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Return the most recent Episode nodes, newest first.

        Parameters
        ----------
        limit
            Maximum number of episodes to return.
        agent_id
            If provided, restrict to episodes whose ``actor_id`` matches
            (string equality on the actor node's id). When ``None`` all
            episodes in the run are considered.

        Returns
        -------
        list of dict
            Episode node dicts (each is the canonical ``{id, node_type,
            ...}`` shape stored in :attr:`nodes`) ordered by
            ``created_at`` descending — the Episode written *last* in
            the run is at index 0. Episodes with no ``created_at``
            field (e.g. synthesised predecessors inserted during a
            ``IN_REPLY_TO`` edge write) sort to the end so the real,
            time-stamped episodes bubble to the top.

        Notes
        -----
        This is the **Step 6 feedback loop B1** helper that
        :meth:`~backend.services.loop.engine.LoopEngine._decide_action`
        uses to surface prior-round context to the LLM. The previous
        flow had ``MemoryWriteback`` writing episodes that no consumer
        ever queried — the LLM was structurally blind to its own
        history. This method closes that gap.
        """
        if limit is None or limit <= 0:
            return []
        episodes = [
            dict(n) for n in self.nodes.values()
            if n.get("node_type") == EPISODE_NODE_TYPE
        ]
        if agent_id is not None:
            episodes = [e for e in episodes if e.get("actor_id") == agent_id]
        # Sort by created_at desc; missing values sort last.
        episodes.sort(
            key=lambda e: (e.get("created_at") is None, -(e.get("created_at") or 0.0))
        )
        return episodes[: int(limit)]

    def save(self) -> None:
        if not self._file:
            return
        payload = {
            "nodes": [self._jsonable(n) for n in self.nodes.values()],
            "edges": [self._jsonable(e) for e in self.edges],
        }
        with open(self._file, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2, default=str)

    @staticmethod
    def _jsonable(obj):
        """Recursively coerce sets → lists, datetimes → strings, etc."""
        if isinstance(obj, dict):
            return {k: EpisodicMemory._jsonable(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [EpisodicMemory._jsonable(v) for v in obj]
        if isinstance(obj, set):
            return [EpisodicMemory._jsonable(v) for v in sorted(obj, key=str)]
        return obj


# ---------------------------------------------------------------------------
# MemoryWriteback
# ---------------------------------------------------------------------------


@dataclass
class MemoryWriteback:
    """Persist actions as Episodes + edges in an :class:`EpisodicMemory`.

    The writer is *stateless* apart from the memory it points at; it
    does not consult the LLM. It is safe to call from the simulation
    loop's hot path.

    Step 6 feedback loop B2
    -----------------------
    When ``knowledge_store`` is provided, every successful write to
    :attr:`memory` is *mirrored* into the shared knowledge store via
    :meth:`knowledge_store.write_episode`. The mirrored Episode node
    carries ``entity_type="Episode"`` so the Step 7 report agent's
    :meth:`IKnowledgeStore.search` / :meth:`get_nodes` calls — which
    already know how to handle Episode nodes — find the emergent
    content without any code change on the read path.

    The mirror is best-effort: a failure on the knowledge-store side
    must not break the simulation. The legacy :class:`EpisodicMemory`
    file is the source of truth for the loop engine's own
    ``recent_episodes`` recall; the mirror is a parallel read path for
    the report.
    """

    memory: EpisodicMemory
    knowledge_store: Optional["Any"] = None  # IKnowledgeStore, kept loose to avoid circular import
    run_id: Optional[str] = None
    mirror_enabled: bool = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def write_action(
        self,
        action: StrategicAction,
        state_after: Optional[WorldState] = None,
    ) -> Dict[str, Any]:
        """Persist one action and return a summary ``{episode_id, edges}``."""
        if action is None:
            return {"episode_id": None, "edges": []}
        # v2 attributes live on the action as ad-hoc attributes
        # (StrategicAction's core dataclass only ships the legacy
        # fields). We use ``getattr`` with defaults so the writer
        # works against both:
        #   * the loop-engine v2 production path that mutates the
        #     action in ``_decide_action`` to set action_id etc, and
        #   * older / direct callers that just pass a StrategicAction
        #     built from its dataclass fields.
        # Auto-assign a stable action_id when the caller (or the
        # engine) left it blank. Without this, two writes of
        # actions that happen to share an empty ``action_id`` would
        # collapse onto the same Episode node key and the second
        # write would silently overwrite the first.
        if not getattr(action, "action_id", ""):
            import uuid
            try:
                action.action_id = str(uuid.uuid4())
            except (AttributeError, dataclasses.FrozenInstanceError):
                # The StrategicAction class is frozen; in that case
                # the caller is on their own and we fall back to a
                # stable hash of (actor_id, round_num) so episodes
                # at least don't all collapse to "".
                action_id = f"{action.actor_id or 'anon'}_r{action.round_num}_{uuid.uuid4().hex[:8]}"
        action_id = getattr(action, "action_id", "") or f"{action.actor_id or 'anon'}_r{action.round_num}"
        actor_id = str(action.actor_id or "")
        episode_id = str(action_id)
        btype = get_business_type(action)
        post_content = getattr(action, "post_content", "") or ""
        text = (post_content or action.public_description or "").strip()
        if not text:
            text = f"[{btype.value}] {actor_id} round {action.round_num}"

        # 1) Episode node
        self.memory.upsert_node(
            episode_id,
            EPISODE_NODE_TYPE,
            name=f"Episode-{btype.value}-R{action.round_num}",
            text=text,
            business_type=btype.value,
            round_num=int(action.round_num),
            actor_id=actor_id,
            target_ids=list(action.target_ids or []),
            post_author_name=getattr(action, "post_author_name", "") or "",
            evidence=list(getattr(action, "evidence", []) or []),
            in_reply_to=getattr(action, "in_reply_to", None),
            propagation_channels=[c.value for c in action.propagation_channels],
            created_at=time.time(),
        )

        edges: List[Dict[str, Any]] = []

        # 2) PERFORMED edge: actor -> episode (also ensure actor node exists)
        if actor_id:
            self.memory.upsert_node(
                actor_id,
                AGENT_NODE_TYPE,
                name=getattr(action, "post_author_name", "") or actor_id,
            )
            edges.append(
                self.memory.add_edge(
                    actor_id, episode_id, EDGE_PERFORMED,
                    round_num=int(action.round_num),
                )
            )

        # 3) IN_REPLY_TO edge: episode -> predecessor
        in_reply_to = getattr(action, "in_reply_to", None)
        if in_reply_to and in_reply_to != episode_id:
            # Predecessor must also be a node (it will be an Episode from an earlier round).
            if in_reply_to not in self.memory.nodes:
                self.memory.upsert_node(
                    in_reply_to, EPISODE_NODE_TYPE,
                    name=f"Episode-predecessor",
                    text="(predecessor episode)",
                )
            edges.append(
                self.memory.add_edge(
                    episode_id, in_reply_to, EDGE_IN_REPLY_TO,
                )
            )

        # 4) CAUSED edge for mutating actions — add a world_state_node.
        touched = ((action.metadata or {}).get("resolver") or {}).get("touched_slice")
        if btype in MUTATING_TYPES or (touched in _STRUCTURAL_SLICES):
            ws_id = self._add_world_state_node(action, state_after, touched)
            edges.append(
                self.memory.add_edge(
                    episode_id, ws_id, EDGE_CAUSED,
                    slice=touched or "unknown",
                    business_type=btype.value,
                )
            )

        # 5) Step 6 feedback loop B2 — mirror the Episode into the
        # shared knowledge store so the Step 7 report agent's
        # ``search()`` finds it. Best-effort: a failure here must not
        # break the simulation.
        if self.mirror_enabled and self.knowledge_store is not None:
            self._mirror_to_knowledge_store(episode_id, edges)

        return {"episode_id": episode_id, "edges": edges, "business_type": btype.value}

    def _mirror_to_knowledge_store(
        self,
        episode_id: str,
        edges: List[Dict[str, Any]],
    ) -> None:
        """Best-effort: write the episode + all touched nodes/edges into
        the wired knowledge store.

        Step 6 feedback loop B2 — the EpisodicMemory file remains the
        source of truth for the loop engine's own recall; this mirror
        gives the Step 7 report agent a parallel read path via the
        standard ``knowledge_store.search()`` / ``search_episodes()`` /
        ``get_neighbors()`` API. Failures are swallowed because the
        EpisodicMemory file already has the canonical record and a
        mirror failure must not break the simulation hot path.

        Collects ALL nodes referenced by the action's edges (actor,
        predecessor Episode, world_state_node) so the mirrored subgraph
        is structurally complete — without this, agent → episode →
        ws_node BFS in the report can't traverse missing endpoints.
        """
        try:
            import asyncio
            # Collect every node touched by this action: the episode
            # itself plus every edge endpoint. Look them up in the
            # in-process EpisodicMemory so we capture the same payload
            # that the canonical file has.
            touched_ids = {episode_id}
            for e in edges:
                for k in ("source_id", "target_id"):
                    v = e.get(k)
                    if v:
                        touched_ids.add(v)
            nodes_payload: List[Dict[str, Any]] = []
            for nid in touched_ids:
                node = self.memory.nodes.get(nid)
                if node is None:
                    continue
                nodes_payload.append(dict(node))
            edge_payloads = [dict(e) for e in edges]

            mirror_coro = self.knowledge_store.write_episode(
                nodes=nodes_payload,
                edges=edge_payloads,
                run_id=self.run_id,
            )
            try:
                # If we're inside a running loop (LoopEngine.run /
                # progress_callback), schedule the mirror without
                # blocking — a fail here just means the report
                # misses one episode, which is recoverable.
                loop = asyncio.get_running_loop()
                loop.create_task(mirror_coro)
            except RuntimeError:
                # No running loop — sync caller (tests, batch
                # scripts). Run the coroutine to completion in a
                # throwaway loop. ``asyncio.run`` is the modern,
                # deprecation-free way to do this.
                asyncio.run(mirror_coro)
        except Exception:
            # Never let the mirror break the simulation. The
            # EpisodicMemory file already has the canonical record.
            pass

    def write_round(
        self,
        actions: List[StrategicAction],
        state_after: Optional[WorldState] = None,
    ) -> List[Dict[str, Any]]:
        """Write a list of actions and persist the graph at the end."""
        out = [self.write_action(a, state_after) for a in (actions or [])]
        self.memory.save()
        return out

    # ------------------------------------------------------------------
    # Internal — world_state_node for a mutating action
    # ------------------------------------------------------------------
    def _add_world_state_node(
        self,
        action: StrategicAction,
        state_after: Optional[WorldState],
        slice_name: Optional[str],
    ) -> str:
        """Create (or update) a world_state_node for this action.

        The node id is deterministic per (action_id, slice) so the
        CAUSED edge stays stable across writes.
        """
        ws_id_seed = getattr(action, "action_id", "") or f"{action.actor_id or 'anon'}_r{action.round_num}"
        ws_id = f"ws_{ws_id_seed[:12]}_{slice_name or 'state'}"
        # Capture the relevant slice snapshot.
        snapshot: Dict[str, Any] = {}
        if state_after is not None and slice_name and hasattr(state_after, slice_name):
            try:
                raw = getattr(state_after, slice_name)
                # Serialise in a way that survives JSON round-trip.
                if isinstance(raw, dict):
                    snapshot = {k: _safe(v) for k, v in raw.items()}
                else:
                    snapshot = {"value": _safe(raw)}
            except Exception:
                snapshot = {}
        self.memory.upsert_node(
            ws_id,
            WORLD_STATE_NODE_TYPE,
            name=f"WorldState-{slice_name or 'state'}-R{action.round_num}",
            slice=slice_name or "unknown",
            business_type=get_business_type(action).value,
            actor_id=action.actor_id,
            snapshot=snapshot,
            created_at=time.time(),
        )
        return ws_id


def _safe(v: Any) -> Any:
    """Coerce a slice value to something JSON-safe."""
    try:
        json.dumps(v, default=str)
        return v
    except Exception:
        return str(v)


__all__ = [
    "MemoryWriteback",
    "EpisodicMemory",
    "EPISODE_NODE_TYPE",
    "AGENT_NODE_TYPE",
    "WORLD_STATE_NODE_TYPE",
    "EDGE_PERFORMED",
    "EDGE_IN_REPLY_TO",
    "EDGE_CAUSED",
    "EPISODE_MIRROR_DEFAULT",
]
