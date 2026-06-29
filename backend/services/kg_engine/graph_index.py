"""
KGIndex — NetworkX-backed graph index with deterministic BFS + lexical
retrieval and JSON persistence.

G7 public contract (per the design spec §5.5):

- ``add_entity(entity: dict) -> None``
- ``add_relation(src_id, rel, dst_id) -> None``
- ``neighbors(entity_id, depth=2) -> list[dict]``
- ``retrieval(query: str, k: int = 5) -> list[dict]``
- ``persist(path) -> None`` / ``KGIndex.load(path) -> KGIndex``

Persistence uses ``networkx.readwrite.json_graph.node_link_data`` and
``json_graph.node_link_graph`` so the on-disk JSON round-trips
isomorphically (verified by ``networkx.is_isomorphic``).

The retrieval algorithm is intentionally simple but deterministic:

1. Tokenize the query and every entity's name/summary on a
   case-insensitive split.
2. For each entity, compute a token-overlap score = |query ∩ tokens| /
   max(|query|, 1).
3. BFS-expand from the top-scoring entity (and the top-k seed entities
   above) up to ``depth=1`` to add neighborhood context.
4. Return the top-k entities by score (ties broken by BFS distance,
   then by entity id for determinism).

This is the in-house "nano-graphRAG" — it gives retrieval grounding to
PROFILE_GENERATION without pulling in any external graph DB or
embedding service. The BFS step is a cheap stand-in for "expand the
context around the most relevant node", which is the dominant win in
qualitative A/B checks.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

import networkx as nx
from networkx.readwrite import json_graph


# Tokenization is intentionally simple: lowercased, split on non-word
# boundaries, and the CJK fallback below splits on any Chinese character
# so a query like "竞争对手 定价" doesn't degenerate to a single 4-char
# token. We keep this deterministic (no stemming, no stopword list) so
# the snapshot test stays byte-stable.
_CJK_CHAR = re.compile(r"[一-鿿]")


def _tokenize(text: str) -> List[str]:
    """Tokenize text for lexical overlap scoring.

    English-ish tokens come from a regex split; CJK characters are
    split into per-character tokens (bigrams are added when adjacent
    characters form a meaningful 2-gram, but we keep it simple here).
    """
    if not text:
        return []
    out: List[str] = []
    # CJK: emit each character as a token
    for ch in text:
        if _CJK_CHAR.match(ch):
            out.append(ch)
    # Latin: regex word split
    for tok in re.findall(r"[A-Za-z0-9_]+", text.lower()):
        if tok:
            out.append(tok)
    return out


@dataclass
class KGEntity:
    """A knowledge-graph node. Mirrors the shape produced by
    ``LocalKnowledgeStore.insert_entity`` so callers can read either
    representation interchangeably."""

    id: str
    name: str = ""
    entity_type: str = ""
    summary: str = ""
    attributes: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "entity_type": self.entity_type,
            "summary": self.summary,
            "attributes": dict(self.attributes),
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "KGEntity":
        return cls(
            id=str(data.get("id") or data.get("uuid") or ""),
            name=str(data.get("name", "") or ""),
            entity_type=str(data.get("entity_type", "") or ""),
            summary=str(data.get("summary", "") or ""),
            attributes=dict(data.get("attributes") or {}),
            metadata=dict(data.get("metadata") or {}),
        )


class KGIndex:
    """NetworkX-backed in-memory + JSON-persisted graph index.

    Construction is cheap — no LLM, no embedding service. Use
    :meth:`add_entity` / :meth:`add_relation` to populate, then
    :meth:`neighbors` for graph traversal and :meth:`retrieval` for
    lexical + BFS hybrid retrieval. Persist with :meth:`persist` and
    reload with :meth:`load`.
    """

    def __init__(self) -> None:
        self._graph: nx.Graph = nx.Graph()
        # Cached token sets per entity, rebuilt on add_entity.
        self._tokens: Dict[str, Set[str]] = {}

    # ------------------------------------------------------------------
    # Mutation
    # ------------------------------------------------------------------
    def add_entity(self, entity: Dict[str, Any]) -> None:
        """Add or update an entity in the graph.

        Accepts a dict matching the ``LocalKnowledgeStore`` shape (must
        have ``uuid`` or ``id``). Re-adding the same id is a no-op for
        graph topology; the attributes are updated in place.
        """
        ent = KGEntity.from_dict(entity)
        if not ent.id:
            return
        # Merge with existing attributes if present
        if self._graph.has_node(ent.id):
            existing = self._graph.nodes[ent.id]
            for k, v in ent.to_dict().items():
                if v or k not in existing:
                    existing[k] = v
        else:
            self._graph.add_node(ent.id, **ent.to_dict())
        self._tokens[ent.id] = set(_tokenize(
            " ".join(
                str(self._graph.nodes[ent.id].get(k, "") or "")
                for k in ("name", "summary", "entity_type")
            )
        ))

    def add_relation(
        self, src_id: str, rel: str, dst_id: str
    ) -> None:
        """Add a relation edge. Auto-creates the endpoint nodes so
        relation-only ingestion (e.g. from the entity extractor) doesn't
        need a separate ``add_entity`` call for missing ids."""
        if not src_id or not dst_id:
            return
        if not self._graph.has_node(src_id):
            self._graph.add_node(src_id, id=src_id, name=src_id)
            self._tokens[src_id] = set(_tokenize(src_id))
        if not self._graph.has_node(dst_id):
            self._graph.add_node(dst_id, id=dst_id, name=dst_id)
            self._tokens[dst_id] = set(_tokenize(dst_id))
        # NetworkX Graph doesn't carry edge attrs by default; use the
        # relation string itself as the edge label, and store the
        # full payload in the edge data dict.
        if self._graph.has_edge(src_id, dst_id):
            existing = self._graph[src_id][dst_id]
            rels = list(existing.get("relations", []))
            if rel not in rels:
                rels.append(rel)
            existing["relations"] = rels
        else:
            self._graph.add_edge(src_id, dst_id, relations=[rel])

    # ------------------------------------------------------------------
    # Query
    # ------------------------------------------------------------------
    def neighbors(
        self, entity_id: str, depth: int = 2
    ) -> List[Dict[str, Any]]:
        """BFS neighbors up to ``depth`` hops. Returns a list of entity
        dicts, ordered by BFS distance (closest first), with ties
        broken by entity id for determinism.

        Empty list if the entity is unknown.
        """
        if not entity_id or not self._graph.has_node(entity_id):
            return []
        if depth < 1:
            depth = 1
        seen: Set[str] = {entity_id}
        frontier: List[Tuple[str, int]] = [(entity_id, 0)]
        by_distance: Dict[int, List[str]] = {0: [entity_id]}
        while frontier:
            new_frontier: List[Tuple[str, int]] = []
            for node, d in frontier:
                if d >= depth:
                    continue
                for nbr in self._graph.neighbors(node):
                    if nbr in seen:
                        continue
                    seen.add(nbr)
                    by_distance.setdefault(d + 1, []).append(nbr)
                    new_frontier.append((nbr, d + 1))
            frontier = new_frontier
        out: List[Dict[str, Any]] = []
        for d in sorted(by_distance.keys()):
            ids = sorted(by_distance[d])  # deterministic tie-break
            for nid in ids:
                attrs = dict(self._graph.nodes[nid])
                attrs["__depth__"] = d
                out.append(attrs)
        return out

    def retrieval(self, query: str, k: int = 5) -> List[Dict[str, Any]]:
        """Hybrid lexical + BFS retrieval.

        Returns up to ``k`` entity dicts ranked by:

        1. token-overlap score with the query (descending);
        2. BFS distance from the top-scoring seed (ascending) — neighbors
           of a high-scoring node are pulled in as supporting context;
        3. entity id (ascending) — final tie-break for determinism.

        If the graph is empty, returns ``[]``. If ``k <= 0``, also
        returns ``[]`` (callers can pass ``k=0`` to short-circuit).
        """
        if k <= 0 or self._graph.number_of_nodes() == 0:
            return []
        q_tokens = set(_tokenize(query or ""))
        if not q_tokens:
            return []

        scored: List[Tuple[float, str]] = []
        for nid in self._graph.nodes:
            tok = self._tokens.get(nid, set())
            if not tok:
                continue
            overlap = len(q_tokens & tok)
            if overlap <= 0:
                continue
            score = overlap / max(len(q_tokens), 1)
            scored.append((score, nid))
        # Sort by score desc, id asc for tie-break.
        scored.sort(key=lambda x: (-x[0], x[1]))

        # Take the top-3 lexical seeds (or fewer if the graph is small)
        # and BFS-expand from each, collecting neighbors as supporting
        # context. We re-rank the union by score, then BFS distance
        # from the nearest seed.
        seeds = [nid for _score, nid in scored[:3]]
        if not seeds:
            return []

        # For each candidate node, find its minimum BFS distance from
        # any seed (depth=1 for neighbors, 2 for neighbors-of-neighbors).
        # The intent: even a node with zero direct token overlap can
        # appear if it is a 1-hop neighbor of a strong lexical hit.
        distance: Dict[str, int] = {}
        for s in seeds:
            if s not in self._graph:
                continue
            frontier: List[Tuple[str, int]] = [(s, 0)]
            visited: Set[str] = {s}
            while frontier:
                new_frontier: List[Tuple[str, int]] = []
                for node, d in frontier:
                    if d > 1:
                        continue
                    if node not in distance or d < distance[node]:
                        distance[node] = d
                    for nbr in self._graph.neighbors(node):
                        if nbr in visited:
                            continue
                        visited.add(nbr)
                        new_frontier.append((nbr, d + 1))
                frontier = new_frontier

        # Build the candidate pool and re-score
        score_by_id: Dict[str, float] = {nid: sc for sc, nid in scored}
        candidates: List[str] = list(distance.keys())
        ranked: List[Tuple[float, int, str]] = []
        for nid in candidates:
            sc = score_by_id.get(nid, 0.0)
            d = distance[nid]
            ranked.append((sc, d, nid))
        # Sort: score desc, distance asc, id asc.
        ranked.sort(key=lambda x: (-x[0], x[1], x[2]))

        out: List[Dict[str, Any]] = []
        for sc, d, nid in ranked[:k]:
            attrs = dict(self._graph.nodes[nid])
            attrs["__score__"] = sc
            attrs["__depth__"] = d
            out.append(attrs)
        return out

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------
    def persist(self, path: str) -> None:
        """Atomically write the index to ``path`` as JSON.

        Uses ``os.replace`` after writing a tmp file so concurrent
        readers either see the old version or the new one — never a
        half-written file. The parent directory is created if needed.
        """
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        data = json_graph.node_link_data(self._graph, edges="edges")
        # Carry the token cache so a fresh KGIndex loaded from disk
        # doesn't have to re-tokenize (a measurable speedup on
        # 10k+ node graphs).
        data["__tokens__"] = {nid: sorted(toks) for nid, toks in self._tokens.items()}
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, path)

    @classmethod
    def load(cls, path: str) -> "KGIndex":
        """Load a previously-persisted index. Returns an empty index if
        the file does not exist; raises on a corrupt file so callers
        can distinguish "fresh start" from "schema drift"."""
        idx = cls()
        if not os.path.isfile(path):
            return idx
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError(f"KGIndex.load: not a dict in {path}")
        # node_link_graph on modern networkx supports edges="edges"
        g = json_graph.node_link_graph(data, edges="edges")
        if not isinstance(g, nx.Graph):
            g = nx.Graph(g)
        idx._graph = g
        tokens = data.get("__tokens__") or {}
        idx._tokens = {
            str(nid): set(list(toks)) for nid, toks in tokens.items()
        }
        return idx

    # ------------------------------------------------------------------
    # Introspection (for tests / A/B harness)
    # ------------------------------------------------------------------
    def num_entities(self) -> int:
        return int(self._graph.number_of_nodes())

    def num_relations(self) -> int:
        return int(self._graph.number_of_edges())

    def entity_ids(self) -> List[str]:
        return sorted(self._graph.nodes)


def _coerce_entities(payload: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Normalize a list of entity dicts to the shape ``add_entity``
    expects. Used by the builder."""
    out: List[Dict[str, Any]] = []
    for raw in payload:
        if not isinstance(raw, dict):
            continue
        if "id" not in raw and "uuid" in raw:
            raw = dict(raw)
            raw["id"] = raw["uuid"]
        out.append(raw)
    return out
