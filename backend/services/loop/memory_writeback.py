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

import hashlib
import json
import logging
import os
import time
import warnings
from dataclasses import dataclass, field
import dataclasses
from typing import Any, Dict, List, Optional, Set, Tuple

# KG-OPT-P1 [eg-008-metrics]: named logger so counters emit visible lines
# (root logger must be set to INFO via backend.app.__init__ basicConfig).
_logger = logging.getLogger("strategicmind.metrics")

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

# KG-OPT-P0 [eg-006/eg-007/eg-008]: Natural-key dedup for Episodes
# (actor+btype+md5(text) 1h 窗口), world_state_node 改用
# (actor, round, slice) 三维自然键, IN_REPLY_TO 找不到引用时静默
# 跳过。默认关闭以保持 T1.5 acceptance 字节级兼容;通过环境变量
# STRATEGICMIND_USE_NATURAL_KEY=1 打开。
USE_NATURAL_KEY = _os.environ.get(
    "STRATEGICMIND_USE_NATURAL_KEY", "0"
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
    # KG-OPT-P0 [eg-008]: 1h 滚动窗口的文本指纹去重桶,
    # key=(actor_id, btype, md5(text)[:12]),
    # value={"episode_id": ..., "ts": float, "occurrence_count": int}。
    # 仅在 STRATEGICMIND_USE_NATURAL_KEY=1 时被读写 (off-flag
    # 路径既不读也不写以保持 T1.5 字节级兼容, 见 P0-FIX 注释);
    # 但 dataclass field 本身始终初始化, 以便 P1 文档化
    # single-thread 约束时不需要重新配 schema。
    # KG-OPT-P1 [eg-008-thread]: 该 dict 单线程访问, 见 __post_init__
    # 中的一次性 warning。
    _recent_text_buckets: Dict[Tuple[str, str, str], Dict[str, Any]] = field(
        default_factory=dict
    )
    # KG-OPT-P1 [eg-008-metrics]: dedup hit counters for benchmark
    # validation when STRATEGICMIND_USE_NATURAL_KEY=1. Off by default
    # (initialised empty) so the off-flag path keeps T1.5 byte-level
    # compatibility and the dict is never read or mutated.
    _dedup_metrics: Dict[str, int] = field(
        default_factory=lambda: {
            "episode_dedup_hits": 0,
            "ws_dedup_hits": 0,
            "in_reply_to_skipped": 0,
            # Bug #2 (post_content 兜底) + N3 健康度指标
            "template_episode_skipped": 0,
            "episode_writes_per_round": 0,
        }
    )

    def __post_init__(self) -> None:
        # KG-OPT-P1 [eg-008-thread]: _recent_text_buckets is a plain
        # dict and the write_action lookup/set is not protected by an
        # asyncio.Lock. The current call-graph (LoopEngine writes
        # actions serially in its main loop) is safe, but if a future
        # caller shares one MemoryWriteback across concurrent asyncio
        # tasks it must serialise the writer itself. Emitted as a
        # one-shot warning so a benchmark sweep that constructs many
        # MemoryWriteback instances only sees the message once per
        # process.
        if not getattr(MemoryWriteback, "_recent_buckets_warned", False):
            warnings.warn(
                "_recent_text_buckets is single-threaded only; if "
                "MemoryWriteback is shared across asyncio tasks, callers "
                "must serialize",
                RuntimeWarning,
                stacklevel=2,
            )
            MemoryWriteback._recent_buckets_warned = True

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    # Bug #2: minimum length below which post_content is treated as
    # template pollution (avoid feeding empty / stub text back to LLM).
    MIN_POST_CONTENT_LEN = 40

    def write_action(
        self,
        action: StrategicAction,
        state_after: Optional[WorldState] = None,
    ) -> Dict[str, Any]:
        """Persist one action and return a summary ``{episode_id, edges}``.

        Bug #2 root cause 2.6 (post_content 兜底) + 2.7 (template pollution):
        v1 路径 12 轮几乎所有 ``post_content`` 都为空, ``Episode.text``
        退化为 ``"[btype] actor round N"`` 模板, 喂回 LLM 的
        ``recent_episodes`` 都是垃圾. 修复: 严格 < 40 字符的
        ``post_content`` / ``public_description`` 视为模板, 跳过 + 计数,
        避免污染 KG.
        """
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
        # === Bug #2 修复点: post_content 严格长度 + 模板跳过 ===
        post_content = (getattr(action, "post_content", "") or "").strip()
        if not post_content:
            post_content = (action.public_description or "").strip()

        if not post_content or len(post_content) < self.MIN_POST_CONTENT_LEN:
            # 关键: 跳过写, 计数 +1, 防止模板 episode 污染
            # recent_episodes 召回.
            self._dedup_metrics["template_episode_skipped"] += 1
            self._dedup_metrics["episode_writes_per_round"] += 1
            _logger.info(
                "memory_writeback template_episode_skipped=%d actor=%s round=%d",
                self._dedup_metrics["template_episode_skipped"],
                actor_id, action.round_num,
            )
            return {
                "episode_id": None,
                "edges": [],
                "business_type": btype.value,
                "skipped": "template_pollution",
            }

        text = post_content  # 已经是 stripped + >= MIN_POST_CONTENT_LEN chars

        # KG-OPT-P0 [eg-008]: Natural-key 1h 滚动窗口去重。
        # 同 actor + btype + md5(text) 在 1h 内的重复内容复用
        # episode_id 并累加 occurrence_count, 不重建节点。
        # flag=false 时保持原行为 (T1.5 字节级兼容) — 见 M11 修复。
        # KG-OPT-P0-FIX [M11]: 将 _recent_text_buckets 的初始化与维护
        # 完全包裹在 USE_NATURAL_KEY=on 分支内, off 分支既不读取
        # 也不写入该 dict, 避免冗余内存与死代码路径。
        if USE_NATURAL_KEY and text:
            digest = hashlib.md5(text.encode("utf-8")).hexdigest()[:12]
            fp_key: Tuple[str, str, str] = (actor_id, btype.value, digest)
            now_ts = time.time()
            bucket = self._recent_text_buckets.get(fp_key)
            if bucket is not None and (now_ts - bucket["ts"]) <= 3600.0:
                # 命中 1h 窗口, 复用前序 episode_id
                episode_id = str(bucket["episode_id"])
                node = self.memory.nodes.get(episode_id, {})
                node["occurrence_count"] = int(node.get("occurrence_count", 1)) + 1
                node["last_seen_at"] = now_ts
                self.memory.nodes[episode_id] = node
                # KG-OPT-P1 [eg-008-metrics]: record episode-dedup hit
                # for benchmark validation of the 1h rolling window.
                self._dedup_metrics["episode_dedup_hits"] += 1
                # Episode + 边已经在原写时落盘, 此处直接返回,
                # 避免重复节点与重复边。deduped=True 让调用方知情。
                return {
                    "episode_id": episode_id,
                    "edges": [],
                    "business_type": btype.value,
                    "deduped": True,
                }
            # 过期或首次出现, 先写入 Episode 节点, 再回填去重桶。
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
            # 写完后回填去重桶, occurrence_count 默认 1
            self._recent_text_buckets[fp_key] = {
                "episode_id": episode_id,
                "ts": now_ts,
                "occurrence_count": 1,
            }
        else:
            # 1) Episode node (off-flag: 原 T1.5 行为, 不接触
            # _recent_text_buckets)
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

        # Bug #2 N3: count successful writes (post-template-check pass-through)
        # so callers can verify per-round writeback actually happened.
        self._dedup_metrics["episode_writes_per_round"] += 1

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
            # KG-OPT-P0 [eg-006/eg-007]: 找不到引用节点时,
            # flag=true 静默 skip (悬挂边在 reload 时会被丢弃, 写出来
            # 反而污染 EpisodicMemory 文件); flag=false 保留旧行为
            # 写入占位 predecessor 节点以保持图可遍历。
            if in_reply_to in self.memory.nodes:
                edges.append(
                    self.memory.add_edge(
                        episode_id, in_reply_to, EDGE_IN_REPLY_TO,
                    )
                )
            elif not USE_NATURAL_KEY:
                # Legacy: fabricate a placeholder predecessor so the
                # graph is still traversable for the report agent.
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
            else:
                # KG-OPT-P1 [eg-008-metrics]: flag=on silent skip.
                # Count it so a benchmark can verify the dedup vs
                # legacy placeholder path is being taken.
                self._dedup_metrics["in_reply_to_skipped"] += 1
            # else: silent skip — a dangling IN_REPLY_TO into a node
            # that doesn't exist in *this* run is exactly the
            # orphan-merge root cause. The edge would be dropped on
            # reload anyway, so emitting it just pollutes the file.

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

        KG-OPT-P0 [eg-006/eg-007]: flag=true 时, 节点 id 由
        (actor, round, slice) 三维自然键决定 —— 同 actor + 同
        round + 同 slice 的多次写入会折叠到同一节点, 仅
        ``occurrence_count`` 自增; flag=false 时保留旧
        (action_id, slice) 二维键, 字节级兼容。
        """
        if USE_NATURAL_KEY:
            actor_key = (action.actor_id or "anon")[:12]
            round_key = int(action.round_num)
            slice_key = (slice_name or "state")[:24]
            ws_id = f"ws_{actor_key}_r{round_key}_{slice_key}"
        else:
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
        fields: Dict[str, Any] = dict(
            name=f"WorldState-{slice_name or 'state'}-R{action.round_num}",
            slice=slice_name or "unknown",
            business_type=get_business_type(action).value,
            actor_id=action.actor_id,
            snapshot=snapshot,
            created_at=time.time(),
        )
        if USE_NATURAL_KEY:
            # 自然键模式下同 key 累加 occurrence_count, 保留
            # first_seen_at 用于审计。
            existing = self.memory.nodes.get(ws_id, {})
            fields["occurrence_count"] = int(existing.get("occurrence_count", 1)) + 1
            fields["first_seen_at"] = existing.get("first_seen_at", fields["created_at"])
            # KG-OPT-P1 [eg-008-metrics]: track (actor, round, slice)
            # re-hits. ``existing`` non-empty means a prior write
            # already created this node; occurrence_count just got
            # bumped from >=1 to >=2.
            if existing:
                self._dedup_metrics["ws_dedup_hits"] += 1
        self.memory.upsert_node(ws_id, WORLD_STATE_NODE_TYPE, **fields)
        return ws_id

    def get_dedup_metrics(self) -> Dict[str, int]:
        """Return a copy of the dedup hit counters.

        KG-OPT-P1 [eg-008-metrics]: exposed for benchmark validation
        under STRATEGICMIND_USE_NATURAL_KEY=1. Returns a shallow copy
        so callers can mutate the dict without affecting the writer's
        internal state. Off-flag callers will always see all zeros
        because the flag=on branches are the only ones that bump the
        counters.
        """
        return dict(self._dedup_metrics)


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
    "USE_NATURAL_KEY",
]
