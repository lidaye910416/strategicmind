"""
kg_engine — in-house nano-graphRAG adapter for StrategicMind.

G7 rationale: the prior KG lives in an in-memory dict built by
``GRAPH_BUILDING`` and is read by ``PROFILE_GENERATION`` via a static
prompt. Zep Cloud is the ideal target but is out of scope; we ship a
deterministic, dependency-light replacement here so the profile stage
can be retrieval-grounded behind the
``STRATEGICMIND_PROFILE_RETRIEVAL=1`` feature flag.

This package deliberately does NOT depend on the PyPI ``nano-graphrag``
package — that one pulls in openai / tiktoken / graspologic /
nano-vectordb, which we don't want. Our ``KGIndex`` is a thin
NetworkX-backed graph with deterministic BFS + lexical retrieval and
JSON persistence, satisfying the public contract
``(entity_id, neighbors(entity_id, depth=2), retrieval(query, k))``.

Public surface:

- :class:`KGIndex` — graph index with retrieval and persistence.
- :func:`build_from_dict` — adapter that the orchestrator can call
  instead of building the in-memory dict directly.
"""

from .graph_index import KGIndex, KGEntity
from .builder import (
    build_from_dict,
    attach_to_index,
    build_index_from_run,
    persist_index,
)

__all__ = [
    "KGIndex",
    "KGEntity",
    "build_from_dict",
    "attach_to_index",
    "build_index_from_run",
    "persist_index",
]
