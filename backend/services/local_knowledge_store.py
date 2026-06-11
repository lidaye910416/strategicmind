"""
LocalKnowledgeStore - IKnowledgeStore implementation using nano-graphRAG

This service combines nano-graphRAG storage with our custom EntityExtractor
LLM-based extraction layer.

The key difference from the prior-art: Zep has built-in extraction, we must
integrate our own EntityExtractor with nano-graphRAG.

Replaces: Zep Cloud knowledge store

Concurrency notes (P2-2 / KG-OPT-P2 [P2-2-store-lock])
-------------------------------------------------------
F1 (entity_extractor dedup) fix moved per-call dedup locking down to the
extractor layer, but the store layer still has a check-then-set race on
``_entity_index`` / ``_relation_index`` — two concurrent ``insert_entity``
calls with the same normalized key could both see ``existing_id is None``
and both allocate new uuids, then both write the index (last-writer-wins,
file duplicates on disk).

To close that window this class owns an ``asyncio.Lock`` (``_index_lock``)
held across the read-side ``.get(key)`` and the write-side
``[key] = entity_id`` + ``_persist_index_atomic()``. The lock is per-store
instance and is intentionally a single lock shared by entity and relation
operations — both index files are small in-memory dicts and serialize
through the same write paths, so splitting into two locks gains nothing.

The lock is enabled by default. To compare performance or roll back in
an emergency, set ``STRATEGICMIND_STORE_LOCK_DISABLED=true`` in the
environment — the lock context manager short-circuits to a no-op
(``AsyncExitStack``-style) and the store reverts to the pre-P2-2
un-locked behaviour. The flag is read once at ``__init__`` time.
"""

import os
import json
import asyncio  # KG-OPT-P2 [P2-2-store-lock]: per-store asyncio.Lock
from typing import List, Dict, Any, Optional
from uuid import uuid4

from ..interfaces.knowledge_store import IKnowledgeStore
from ..interfaces.graph_store import IGraphStore
from ..interfaces.llm_provider import ILLMProvider
from ..models.text_normalize import (
    normalize_text as _normalize_text,
    make_entity_key as _make_entity_key,
    make_relation_key as _make_relation_key,
)
from .entity_extractor import EntityExtractor


# --- Dedup index constants ------------------------------------------------
# Phase 4d fix (see ws4gdxlm1 diagnosis): without these, every LLM extraction
# of the same name yields a new uuid → one file per call → 6910 files for 155
# unique entities (~22x duplication, Apple Inc. → 403 copies). the prior art offloads
# this to Zep's server-side name/embedding merge; we replicate it locally with
# a normalized (name, entity_type) index. Normalization helpers live in
# `backend/models/text_normalize.py` so `Entity.from_name` and this store
# always compute the same lookup key.
_INDEX_FILENAME = "_entity_index.json"
_RELATION_INDEX_FILENAME = "_relation_index.json"

# KG-OPT-P2 [P2-2-store-lock]: feature flag for emergency rollback / A-B perf
# comparison. Default (unset / "false") = lock enabled. Set to "true" /
# "1" to skip the lock and revert to the pre-P2-2 un-locked path.
_STORE_LOCK_DISABLED_ENV = "STRATEGICMIND_STORE_LOCK_DISABLED"


def _is_store_lock_disabled() -> bool:  # KG-OPT-P2 [P2-2-store-lock]
    """Read STRATEGICMIND_STORE_LOCK_DISABLED at init time.

    Truthy values: "1", "true", "yes" (case-insensitive). Anything else
    (including unset) leaves the lock enabled. We snapshot once at
    __init__ so a later env change cannot flip behaviour mid-process.
    """
    raw = os.environ.get(_STORE_LOCK_DISABLED_ENV, "")
    return raw.strip().lower() in ("1", "true", "yes")


class _NullAsyncLock:  # KG-OPT-P2 [P2-2-store-lock]
    """Async context manager that does nothing — used when the feature
    flag is on. Mirrors ``asyncio.Lock``'s ``async with`` interface so the
    call sites don't need to branch.
    """

    async def __aenter__(self) -> "_NullAsyncLock":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None


class LocalKnowledgeStore(IKnowledgeStore):
    """
    Local knowledge store implementation using nano-graphRAG.
    
    This combines:
        - nano-graphRAG for storage and retrieval
        - EntityExtractor for LLM-based entity extraction
    
    Attributes:
        graph_store: The underlying graph store (nano-graphRAG)
        entity_extractor: LLM-based entity extractor
        storage_path: Local file storage path
    """
    
    def __init__(
        self,
        graph_store: IGraphStore,
        llm_provider: ILLMProvider,
        storage_path: str = "./data/knowledge_graphs",
    ):
        """
        Initialize LocalKnowledgeStore.
        
        Args:
            graph_store: Underlying graph store for storage
            llm_provider: LLM provider for entity extraction
            storage_path: Path for local file storage
        """
        self.graph_store = graph_store
        self.entity_extractor = EntityExtractor(llm_provider)
        self.storage_path = storage_path

        # Ensure storage directory exists
        os.makedirs(storage_path, exist_ok=True)

        # --- Dedup indices (Phase 4d) -----------------------------------
        # entity index:   key = "<norm-name>|<norm-type>"   value = entity uuid
        # relation index: key = "<src>|<tgt>|<norm-type>"   value = relation uuid
        # Both files are atomic-written (.tmp + os.replace). On cold start
        # (file missing) we scan existing entity/relation files and rebuild
        # the index — first-wins by mtime — so dropping the index never
        # resurrects duplicate-on-insert.
        self._index_path = os.path.join(storage_path, _INDEX_FILENAME)
        self._relation_index_path = os.path.join(storage_path, _RELATION_INDEX_FILENAME)
        self._entity_index: Dict[str, str] = {}
        self._relation_index: Dict[str, str] = {}

        # KG-OPT-P2 [P2-2-store-lock]: per-store lock guarding the
        # check-then-set window on _entity_index / _relation_index. Same
        # lock is used for both index types — they share this class'
        # write paths and the dicts are tiny, so a single lock is the
        # simplest correct choice. Replaced with _NullAsyncLock when
        # STRATEGICMIND_STORE_LOCK_DISABLED is set (see env handling
        # below) so the call sites stay branch-free.
        if _is_store_lock_disabled():
            self._index_lock: object = _NullAsyncLock()  # type: ignore[assignment]
        else:
            self._index_lock = asyncio.Lock()

        self._load_or_rebuild_indices()

        # Wire the extractor's `knowledge_store` back-reference so that
        # `Entity.from_name(...)` calls inside `_parse_entity_response`
        # see the dedup index and reuse existing uuids on a hit. This
        # completes the model → extractor → store three-layer defense.
        self.entity_extractor.knowledge_store = self

    # --- Dedup index plumbing ------------------------------------------
    def _load_or_rebuild_indices(self) -> None:
        """Load _entity_index.json + _relation_index.json from disk; on
        missing/corrupt file, rebuild from the existing entity/relation
        files (first-wins by mtime). Idempotent — safe to call repeatedly."""
        # Entity index
        if os.path.isfile(self._index_path):
            try:
                with open(self._index_path, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                if isinstance(raw, dict):
                    self._entity_index = {str(k): str(v) for k, v in raw.items()}
                else:
                    self._rebuild_entity_index_from_files()
            except (json.JSONDecodeError, OSError):
                self._entity_index = {}
                self._rebuild_entity_index_from_files()
        else:
            self._rebuild_entity_index_from_files()

        # Relation index
        if os.path.isfile(self._relation_index_path):
            try:
                with open(self._relation_index_path, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                if isinstance(raw, dict):
                    self._relation_index = {str(k): str(v) for k, v in raw.items()}
                else:
                    self._rebuild_relation_index_from_files()
            except (json.JSONDecodeError, OSError):
                self._relation_index = {}
                self._rebuild_relation_index_from_files()
        else:
            self._rebuild_relation_index_from_files()

    def _rebuild_entity_index_from_files(self) -> None:
        """Scan {uuid}.json files in storage_path (excluding _-prefixed and
        relation_/graph_-prefixed) and rebuild the entity index. Oldest
        mtime wins on key collision — preserves the original entity uuid
        across restarts."""
        if not os.path.isdir(self.storage_path):
            return
        candidates: List[tuple] = []
        try:
            files = os.listdir(self.storage_path)
        except OSError:
            return
        for fn in files:
            if not fn.endswith(".json"):
                continue
            if fn.startswith("_") or fn.startswith("relation_") or fn.startswith("graph_"):
                continue
            p = os.path.join(self.storage_path, fn)
            try:
                mt = os.path.getmtime(p)
            except OSError:
                mt = 0.0
            candidates.append((mt, fn))
        candidates.sort()  # ascending mtime — oldest first

        rebuilt: Dict[str, str] = {}
        for _mt, fn in candidates:
            p = os.path.join(self.storage_path, fn)
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except (json.JSONDecodeError, OSError):
                continue
            name = data.get("name", "")
            etype = data.get("entity_type", "")
            if not name or not etype:
                continue
            key = _make_entity_key(name, etype)
            if key in rebuilt:
                continue  # first-wins
            rebuilt[key] = data.get("uuid") or fn[:-5]
        self._entity_index = rebuilt
        if rebuilt:
            self._persist_index_atomic()

    def _rebuild_relation_index_from_files(self) -> None:
        """Scan relation_*.json files and rebuild the relation index.
        Oldest mtime wins on key collision."""
        if not os.path.isdir(self.storage_path):
            return
        candidates: List[tuple] = []
        try:
            files = os.listdir(self.storage_path)
        except OSError:
            return
        for fn in files:
            if not (fn.startswith("relation_") and fn.endswith(".json")):
                continue
            p = os.path.join(self.storage_path, fn)
            try:
                mt = os.path.getmtime(p)
            except OSError:
                mt = 0.0
            candidates.append((mt, fn))
        candidates.sort()

        rebuilt: Dict[str, str] = {}
        for _mt, fn in candidates:
            p = os.path.join(self.storage_path, fn)
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except (json.JSONDecodeError, OSError):
                continue
            src = data.get("source_id")
            tgt = data.get("target_id")
            rtype = data.get("relation_type")
            if not src or not tgt or not rtype:
                continue
            key = _make_relation_key(src, tgt, rtype)
            if key in rebuilt:
                continue
            rebuilt[key] = data.get("uuid") or fn[len("relation_"):-5]
        self._relation_index = rebuilt
        if rebuilt:
            self._persist_relation_index_atomic()

    def _persist_index_atomic(self) -> None:
        """Atomic write of the entity index: tmp file + os.replace."""
        tmp = self._index_path + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self._entity_index, f, ensure_ascii=False)
            os.replace(tmp, self._index_path)
        except OSError:
            try:
                os.remove(tmp)
            except OSError:
                pass

    def _persist_relation_index_atomic(self) -> None:
        tmp = self._relation_index_path + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self._relation_index, f, ensure_ascii=False)
            os.replace(tmp, self._relation_index_path)
        except OSError:
            try:
                os.remove(tmp)
            except OSError:
                pass

    def rebuild_aggregate(self, graph_id: str = "default") -> Dict[str, int]:
        """Rebuild the ``graph_<graph_id>.json`` aggregate from the
        one-file-per-entity / one-file-per-relation JSONs in ``storage_path``.

        Delegates to ``self.graph_store.rebuild_aggregate`` so the aggregate
        sits next to the source files (LocalKnowledgeStore + LocalGraphStore
        share the same storage_path in practice). Step 6 of ws4gdxlm1 —
        gives consumers a single-file view of the graph without scanning
        thousands of inodes.

        Returns:
            ``{"nodes": int, "edges": int}`` written to the aggregate.
        """
        gs = getattr(self, "graph_store", None)
        if gs is None or not hasattr(gs, "rebuild_aggregate"):
            return {"nodes": 0, "edges": 0}
        return gs.rebuild_aggregate(graph_id=graph_id, source_dir=self.storage_path)
    # -------------------------------------------------------------------
    
    async def search(
        self,
        query: str,
        top_k: int = 10,
        filters: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Semantic search for entities and context.

        Returns matches from the default graph AND from any per-run
        Episode subgraph (Step 7 feedback loop B2 — the report agent's
        primary read path must see mirrored Episodes alongside Step 2
        seed entities).

        Args:
            query: Search query string
            top_k: Number of results to return
            filters: Optional metadata filters

        Returns:
            List of search results with scores and metadata
        """
        results: List[Dict[str, Any]] = []
        try:
            results.extend(await self.graph_store.search(
                graph_id="default",
                query=query,
                top_k=top_k,
                filters=filters,
            ))
        except Exception:
            pass

        # Also scan per-run subgraphs (graph_run_*.json) for Episode hits.
        # Without this, knowledge_store.search() never returns mirrored
        # Episodes and the report grounding stays fake.
        if os.path.isdir(self.storage_path):
            try:
                for fname in os.listdir(self.storage_path):
                    if not (fname.startswith("graph_run_") and fname.endswith(".json")):
                        continue
                    graph_id = fname[len("graph_"):-len(".json")]
                    try:
                        extra = await self.graph_store.search(
                            graph_id=graph_id,
                            query=query,
                            top_k=top_k,
                            filters=filters,
                        )
                        results.extend(extra)
                    except Exception:
                        continue
            except OSError:
                pass

        return results[:top_k] if top_k and len(results) > top_k else results
    
    async def get_entity(self, entity_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve a specific entity by ID.
        
        Args:
            entity_id: Unique entity identifier
            
        Returns:
            Entity data dict or None if not found
        """
        nodes = await self.graph_store.get_nodes(
            graph_id="default",
            node_ids=[entity_id],
            limit=1,
        )
        
        if nodes:
            return nodes[0]
        return None
    
    async def insert_entity(
        self,
        entity: Dict[str, Any],
        metadata: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Insert a new entity into the knowledge store.

        Phase 4d behaviour: dedup by normalized (name, entity_type). First
        insertion wins — subsequent inserts of the same key return the
        existing uuid WITHOUT overwriting the existing file (preserves
        provenance / original summary). Missing name or entity_type falls
        back to legacy uuid-keyed write so misshapen callers still work.

        Args:
            entity: Entity data with at least 'name' and 'entity_type'
            metadata: Optional metadata for the entity

        Returns:
            The ID of the inserted (or previously-stored) entity
        """
        name = entity.get("name", "")
        etype = entity.get("entity_type", "")

        # Fallback: if dedup key components are missing, behave like legacy
        # (assign uuid, write file). No dedup, but at least keeps callers
        # that pass partial dicts working.
        if not name or not etype:
            entity_id = entity.get("uuid", str(uuid4()))
            entity["uuid"] = entity_id
            if metadata:
                entity["metadata"] = metadata
            entity_file = os.path.join(self.storage_path, f"{entity_id}.json")
            with open(entity_file, "w", encoding="utf-8") as f:
                json.dump(entity, f, ensure_ascii=False)
            return entity_id

        key = _make_entity_key(name, etype)
        # KG-OPT-P2 [P2-2-store-lock]: hold the lock across the entire
        # check-then-set window (read existing_id → write file → update
        # index → persist index). Without this, two concurrent inserts
        # of the same normalized key can both see "MISS" and each
        # allocate a fresh uuid, blowing up Phase 4d's first-wins
        # dedup invariant. When the feature flag is on, _index_lock
        # is a _NullAsyncLock so this is a cheap no-op.
        async with self._index_lock:
            existing_id = self._entity_index.get(key)
            if existing_id:
                # HIT — first-wins. Do NOT rewrite the file; preserve original
                # summary/attributes/metadata. Callers that need provenance
                # merging (e.g. append run_id to _seen_in_runs) should do it
                # by reading the file, mutating, and writing back themselves.
                return existing_id

            # MISS — allocate uuid (reuse client-supplied if present), write
            # file, update index, persist index atomically.
            entity_id = entity.get("uuid", str(uuid4()))
            entity["uuid"] = entity_id
            if metadata:
                entity["metadata"] = metadata
            # Cache the normalized lookup key on the entity for downstream
            # tooling (admin dedupe-kg, aggregate rebuild, etc.).
            entity.setdefault("_norm_key", key)

            entity_file = os.path.join(self.storage_path, f"{entity_id}.json")
            with open(entity_file, "w", encoding="utf-8") as f:
                json.dump(entity, f, ensure_ascii=False)

            self._entity_index[key] = entity_id
            self._persist_index_atomic()
            return entity_id

    async def insert_relation(self, relation: Dict[str, Any]) -> str:
        """
        Insert a relation between entities.

        Phase 4d behaviour: dedup by (source_id, target_id, normalized
        relation_type). First-wins like entities — repeated inserts of the
        same edge return the existing relation uuid.

        Args:
            relation: Relation data with 'source_id', 'target_id', 'relation_type'

        Returns:
            The ID of the inserted (or previously-stored) relation
        """
        src = relation.get("source_id")
        tgt = relation.get("target_id")
        rtype = relation.get("relation_type")

        # Fallback: missing required fields → legacy write, no dedup
        if not src or not tgt or not rtype:
            relation_id = relation.get("uuid", str(uuid4()))
            relation["uuid"] = relation_id
            relation_file = os.path.join(self.storage_path, f"relation_{relation_id}.json")
            with open(relation_file, "w", encoding="utf-8") as f:
                json.dump(relation, f, ensure_ascii=False)
            return relation_id

        key = _make_relation_key(src, tgt, rtype)
        # KG-OPT-P2 [P2-2-store-lock]: same check-then-set hazard as
        # insert_entity — guard the read of _relation_index through the
        # persist of the relation-index file with the per-store lock.
        # We deliberately reuse _index_lock (shared with entities)
        # because the relation index and entity index are both tiny
        # in-memory dicts and their write paths share this class;
        # a single lock is the simplest correct serialization.
        async with self._index_lock:
            existing_id = self._relation_index.get(key)
            if existing_id:
                return existing_id

            relation_id = relation.get("uuid", str(uuid4()))
            relation["uuid"] = relation_id
            relation_file = os.path.join(self.storage_path, f"relation_{relation_id}.json")
            with open(relation_file, "w", encoding="utf-8") as f:
                json.dump(relation, f, ensure_ascii=False)

            self._relation_index[key] = relation_id
            self._persist_relation_index_atomic()
            return relation_id
    
    async def get_neighbors(
        self,
        entity_id: str,
        relation_types: Optional[List[str]] = None,
        depth: int = 1
    ) -> List[Dict[str, Any]]:
        """
        Get neighboring entities through graph traversal.
        
        Args:
            entity_id: Starting entity ID
            relation_types: Filter by specific relation types (optional)
            depth: Traversal depth (default 1 = direct neighbors)
            
        Returns:
            List of neighboring entity data
        """
        # Get edges from this entity
        edges = await self.graph_store.get_edges(
            graph_id="default",
            source_id=entity_id,
            limit=100,
        )
        
        # Filter by relation type if specified
        if relation_types:
            edges = [e for e in edges if e.get("relation_type") in relation_types]
        
        # Get target entity IDs
        target_ids = [e.get("target_id") or e.get("target") for e in edges]
        target_ids = [tid for tid in target_ids if tid]
        
        # Get neighbor entities
        neighbors = await self.graph_store.get_nodes(
            graph_id="default",
            node_ids=target_ids,
            limit=len(target_ids) if target_ids else 100,
        )
        
        return neighbors
    
    async def get_entity_context(
        self,
        entity_id: str,
        max_context: int = 5
    ) -> str:
        """
        Get full context for an entity as a text string.
        
        Args:
            entity_id: Entity identifier
            max_context: Maximum number of related entities to include
            
        Returns:
            Formatted context string with entity and neighbors
        """
        entity = await self.get_entity(entity_id)
        if not entity:
            return ""
        
        # Build context
        context = f"Entity: {entity.get('name', 'Unknown')}"
        if entity.get('entity_type'):
            context += f" ({entity.get('entity_type')})"
        if entity.get('summary'):
            context += f"\nSummary: {entity.get('summary')}"
        
        # Add neighbors
        neighbors = await self.get_neighbors(entity_id, depth=1)
        if neighbors and max_context > 0:
            context += f"\n\nRelated entities:"
            for i, neighbor in enumerate(neighbors[:max_context]):
                name = neighbor.get('name', 'Unknown')
                ntype = neighbor.get('entity_type', '')
                summary = neighbor.get('summary', '')[:100]
                context += f"\n  - {name}"
                if ntype:
                    context += f" ({ntype})"
                if summary:
                    context += f": {summary}..."
        
        return context

    # --- Step 7 feedback loop B2 — Episode mirror -----------------------
    @staticmethod
    def _run_graph_id(run_id: Optional[str]) -> Optional[str]:
        """Build the per-run subgraph id used by write_episode / search_episodes.

        Returns ``None`` if ``run_id`` is empty so callers can early-exit.
        """
        if not run_id:
            return None
        return f"run_{run_id}"

    @staticmethod
    def _node_type_to_entity_type(node_type: str) -> str:
        """Map EpisodicMemory ``node_type`` → IGraphStore ``entity_type``.
        Preserves the writer's "Episode"/"Agent"/"WorldStateNode" labels."""
        return node_type or "Unknown"

    async def write_episode(
        self,
        *,
        nodes: Optional[List[Dict[str, Any]]] = None,
        edges: Optional[List[Dict[str, Any]]] = None,
        episode: Optional[Dict[str, Any]] = None,
        run_id: Optional[str] = None,
    ) -> bool:
        """Mirror a writeback Episode (+ its touched nodes/edges) into a
        per-run subgraph identified by ``f"run_{run_id}"``.

        Idempotent on node ``id`` and edge
        ``(source_id, target_id, relation_type)`` — re-mirroring the
        same action does not multiply nodes/edges. Each node's
        ``node_type`` is preserved as ``entity_type`` so downstream
        ``get_nodes(node_type="Episode")`` filters work unchanged.

        Args:
            nodes: All nodes to mirror (episode + actor + ws_node +
                in_reply_to predecessor). Preferred.
            edges: All edges between those nodes.
            episode: Backward-compat single-node wrapper — used only
                when ``nodes`` is not supplied.
            run_id: Per-run graph isolation key. Required (no-op if
                missing — the mirror is best-effort and a None run_id
                means the caller didn't wire the writer correctly).

        Returns:
            True on success, False if run_id is missing or the
            underlying graph store rejects the write.
        """
        graph_id = self._run_graph_id(run_id)
        if not graph_id:
            return False

        gs = self.graph_store
        if gs is None:
            return False

        # Normalise the input shape — old callers may pass `episode=`
        # singular, new callers pass `nodes=` plural.
        if nodes is None:
            nodes = [episode] if episode else []
        edges_in = list(edges or [])

        # Ensure the per-run graph file exists.
        try:
            if hasattr(gs, "create_graph"):
                gs.create_graph(graph_id)
        except Exception:
            pass

        # Load → mutate → save. We bypass the IGraphStore.search/get_nodes
        # API because we need the raw aggregate structure for idempotent
        # dedup (the API doesn't expose a "does this id exist?" query).
        load = getattr(gs, "_load_graph", None)
        save = getattr(gs, "_save_graph", None)
        if load is None or save is None:
            return False
        try:
            graph = load(graph_id) or {}
        except Exception:
            graph = {}
        graph.setdefault("graph_id", graph_id)
        graph.setdefault("nodes", [])
        graph.setdefault("edges", [])

        existing_ids = {n.get("id") for n in graph["nodes"] if n.get("id")}
        existing_edge_keys = {
            (e.get("source_id"), e.get("target_id"), e.get("relation_type"))
            for e in graph["edges"]
        }

        # Append unique nodes, mapping node_type → entity_type.
        for n in nodes:
            if not isinstance(n, dict):
                continue
            nid = n.get("id")
            if not nid or nid in existing_ids:
                continue
            entity_type = self._node_type_to_entity_type(n.get("node_type", ""))
            merged = dict(n)
            merged["entity_type"] = entity_type
            graph["nodes"].append(merged)
            existing_ids.add(nid)

        # Append unique edges — three-tuple key matches Step 2's
        # _relation_index so the dedup semantics agree between paths.
        for e in edges_in:
            if not isinstance(e, dict):
                continue
            key = (e.get("source_id"), e.get("target_id"), e.get("relation_type"))
            if None in key or key in existing_edge_keys:
                continue
            graph["edges"].append(dict(e))
            existing_edge_keys.add(key)

        try:
            save(graph_id, graph)
        except Exception:
            return False
        return True

    async def search_episodes(
        self,
        query: str = "",
        top_k: int = 100,
        run_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Return Episode nodes from a per-run subgraph.

        When ``query`` is non-empty, results are filtered by case-
        insensitive substring match on text/name/summary/post_content.
        Returns at most ``top_k`` entries — order is the on-disk order
        (write order). Empty list if the run has no mirrored episodes
        yet (or run_id is missing).

        This is the symmetric read API to :meth:`write_episode` — same
        per-run graph isolation, same ``entity_type="Episode"`` filter.
        """
        graph_id = self._run_graph_id(run_id)
        if not graph_id:
            return []
        gs = self.graph_store
        if gs is None:
            return []
        load = getattr(gs, "_load_graph", None)
        if load is None:
            return []
        try:
            graph = load(graph_id) or {}
        except Exception:
            return []

        eps = [
            n for n in graph.get("nodes", [])
            if n.get("entity_type") == "Episode"
        ]
        if query:
            q = query.lower()
            eps = [
                n for n in eps
                if q in (n.get("text") or "").lower()
                or q in (n.get("name") or "").lower()
                or q in (n.get("summary") or "").lower()
                or q in (n.get("post_content") or "").lower()
            ]
        if top_k and top_k > 0:
            return eps[:top_k]
        return eps
    # -------------------------------------------------------------------

    async def insert_texts(
        self,
        texts: List[str],
        metadata: Optional[List[Dict[str, Any]]] = None,
        ontology: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Insert texts with automatic entity extraction.
        
        This is the main method for bulk text insertion with extraction.
        
        Args:
            texts: List of text strings to process
            metadata: Optional metadata for each text
            ontology: Optional ontology schema for guided extraction
            
        Returns:
            Summary of insertion results
        """
        all_entities = []
        all_relations = []
        
        # Extract entities and relations from each text
        for i, text in enumerate(texts):
            # Extract entities
            entities = await self.entity_extractor.extract_entities(text, ontology)
            
            # Extract relations
            relations = await self.entity_extractor.extract_relations(text, entities, ontology)
            
            # Insert entities
            for entity in entities:
                entity_id = await self.insert_entity(entity.to_dict())
                all_entities.append({"id": entity_id, "name": entity.name})
            
            # Insert relations
            for relation in relations:
                relation_id = await self.insert_relation({
                    "source_id": relation.source,
                    "target_id": relation.target,
                    "relation_type": relation.relation_type,
                    "attributes": relation.attributes,
                })
                all_relations.append({"id": relation_id, **relation.__dict__})
        
        return {
            "entities_count": len(all_entities),
            "relations_count": len(all_relations),
            "entities": all_entities,
            "relations": all_relations,
        }
