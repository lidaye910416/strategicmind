"""
builder.py — thin adapter wrapping ``KGIndex`` with the public shape of
``LocalKnowledgeStore`` so GRAPH_BUILDING can swap the in-memory dict
for the in-house ``kg_engine`` without changing call sites.

G7 acceptance: "``GraphBuilderService`` no longer holds the in-memory
dict it built directly; the dict is now an attachment to ``KGIndex``."

The adapter exposes a small surface that the orchestrator / graph
builder needs:

- :func:`build_from_dict` — given a dict of ``{entity_id: entity_payload}``,
  returns a populated :class:`KGIndex`. This is the "swap" — the caller
  used to keep the dict; now it calls this once and gets back a
  ``KGIndex`` it can both read and persist.
- :func:`attach_to_index` — given a ``KGIndex`` and a list of relations
  (``[(src_id, rel, dst_id), ...]``), append the relations in-place.
- :func:`build_index_from_run` — high-level: load (or build + persist)
  the index for a given ``run_id`` from the on-disk JSON snapshot.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .graph_index import KGIndex


# Default storage path mirrors what LocalKnowledgeStore used historically
# (per-run JSON under ``backend/data/knowledge_graphs``). We keep the
# same path so an existing run's snapshot can be loaded by the new code
# without a migration.
DEFAULT_STORAGE_DIR = "data/knowledge_graphs"


def build_from_dict(
    entities: Dict[str, Dict[str, Any]],
    relations: Optional[Iterable[Tuple[str, str, str]]] = None,
) -> KGIndex:
    """Build a :class:`KGIndex` from a ``{entity_id: entity_payload}`` dict.

    The relation argument is a sequence of ``(src_id, rel, dst_id)``
    tuples — same shape the orchestrator used to feed the in-memory
    dict. Returns a fully populated ``KGIndex``.
    """
    idx = KGIndex()
    for eid, payload in entities.items():
        if not isinstance(payload, dict):
            payload = {"id": eid, "name": str(eid)}
        else:
            payload = dict(payload)
            payload.setdefault("id", eid)
            payload.setdefault("uuid", eid)
        idx.add_entity(payload)
    for rel_tuple in relations or []:
        try:
            src, rel, dst = rel_tuple
        except (ValueError, TypeError):
            continue
        idx.add_relation(str(src), str(rel), str(dst))
    return idx


def attach_to_index(
    index: KGIndex,
    relations: Iterable[Tuple[str, str, str]],
) -> KGIndex:
    """Append relations to an existing ``KGIndex`` in-place. Returns
    the same index for chaining."""
    for rel_tuple in relations or []:
        try:
            src, rel, dst = rel_tuple
        except (ValueError, TypeError):
            continue
        index.add_relation(str(src), str(rel), str(dst))
    return index


def build_index_from_run(
    run_id: str,
    storage_dir: str = DEFAULT_STORAGE_DIR,
) -> KGIndex:
    """Load the per-run JSON snapshot, or return an empty index if no
    snapshot exists yet (the GRAPH_BUILDING stage will populate it).

    The snapshot path is ``<storage_dir>/<run_id>.json``.
    """
    path = os.path.join(storage_dir, f"{run_id}.json")
    return KGIndex.load(path)


def persist_index(
    index: KGIndex,
    run_id: str,
    storage_dir: str = DEFAULT_STORAGE_DIR,
) -> str:
    """Persist the index to ``<storage_dir>/<run_id>.json``. Returns
    the absolute path on disk."""
    path = os.path.abspath(os.path.join(storage_dir, f"{run_id}.json"))
    index.persist(path)
    return path
