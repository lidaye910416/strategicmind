"""
LocalGraphStore - IGraphStore implementation using local storage

This is a simple local implementation of IGraphStore that stores
graph data in local files. For production, consider nano-graphRAG.
"""

import os
import json
from typing import List, Dict, Any, Optional
from uuid import uuid4

from ..interfaces.graph_store import IGraphStore


class LocalGraphStore(IGraphStore):
    """
    Local graph store implementation.
    
    This implementation stores graph data in local JSON files.
    For production use with better search capabilities, integrate
    nano-graphRAG or similar graph database.
    
    Attributes:
        storage_path: Path for storing graph data
    """
    
    def __init__(self, storage_path: str = "./data/knowledge_graphs"):
        """
        Initialize local graph store.
        
        Args:
            storage_path: Directory for storing graph data
        """
        self.storage_path = storage_path
        os.makedirs(storage_path, exist_ok=True)
    
    def _get_graph_path(self, graph_id: str) -> str:
        """Get file path for a graph.

        Uses the ``graph_<id>.json`` prefix so the aggregate sits next
        to per-entity files (``{uuid}.json``) and per-relation files
        (``relation_<uuid>.json``) without being misclassified by
        directory scans (e.g. ``_read_graph_from_knowledge_store`` in
        pipeline.py skips ``graph_*.json``). Without the prefix, a
        per-run aggregate like ``run_xxx.json`` looks just like an
        entity file with a UUID id and pollutes graph snapshots.
        """
        return os.path.join(self.storage_path, f"graph_{graph_id}.json")
    
    def _load_graph(self, graph_id: str) -> Dict[str, Any]:
        """Load graph data from file"""
        path = self._get_graph_path(graph_id)
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        return {"graph_id": graph_id, "nodes": [], "edges": []}
    
    def _save_graph(self, graph_id: str, data: Dict[str, Any]) -> None:
        """Save graph data to file"""
        path = self._get_graph_path(graph_id)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    
    def create_graph(self, graph_id: str, config: Optional[Dict[str, Any]] = None) -> bool:
        """Create a new graph"""
        if not os.path.exists(self._get_graph_path(graph_id)):
            data = {
                "graph_id": graph_id,
                "config": config or {},
                "nodes": [],
                "edges": [],
            }
            self._save_graph(graph_id, data)
        return True
    
    async def insert_texts(
        self,
        graph_id: str,
        texts: List[str],
        metadata: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """Insert texts (stub - extracts entities separately)"""
        data = self._load_graph(graph_id)
        
        node_count = len(texts)
        
        return {
            "inserted_count": len(texts),
            "node_count": node_count,
            "edge_count": 0,
        }
    
    async def search(
        self,
        graph_id: str,
        query: str,
        top_k: int = 10,
        filters: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """Simple text search in nodes.

        Searches across ``name``, ``summary``, ``text`` and
        ``post_content`` — the last two cover Step 7 Episode mirror
        nodes whose payload sits in ``text`` rather than ``summary``.
        Without this, knowledge_store.search() returns 0 Episode hits
        even when the mirror is wired correctly.
        """
        data = self._load_graph(graph_id)

        results = []
        query_lower = query.lower()

        for node in data.get("nodes", []):
            # Concatenate every text-bearing field so a query matches
            # whichever field the node happens to use.
            text = " ".join(str(node.get(k, "") or "") for k in (
                "name", "summary", "text", "post_content"
            )).lower()
            if query_lower in text:
                results.append({
                    "id": node.get("id", str(uuid4())),
                    "text": node.get("text") or node.get("summary") or node.get("name", ""),
                    "score": 0.5,
                    "metadata": node,
                })

            if len(results) >= top_k:
                break

        return results
    
    async def get_nodes(
        self,
        graph_id: str,
        node_ids: Optional[List[str]] = None,
        node_type: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get nodes from graph"""
        data = self._load_graph(graph_id)
        nodes = data.get("nodes", [])
        
        if node_ids:
            nodes = [n for n in nodes if n.get("id") in node_ids]
        
        if node_type:
            nodes = [n for n in nodes if n.get("entity_type") == node_type]
        
        return nodes[:limit]
    
    async def get_edges(
        self,
        graph_id: str,
        edge_ids: Optional[List[str]] = None,
        source_id: Optional[str] = None,
        target_id: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get edges from graph"""
        data = self._load_graph(graph_id)
        edges = data.get("edges", [])
        
        if edge_ids:
            edges = [e for e in edges if e.get("id") in edge_ids]
        
        if source_id:
            edges = [e for e in edges if e.get("source_id") == source_id]
        
        if target_id:
            edges = [e for e in edges if e.get("target_id") == target_id]
        
        return edges[:limit]
    
    async def delete_graph(self, graph_id: str) -> bool:
        """Delete a graph"""
        path = self._get_graph_path(graph_id)
        if os.path.exists(path):
            os.remove(path)
            return True
        return False

    def rebuild_aggregate(
        self,
        graph_id: str = "default",
        source_dir: Optional[str] = None,
    ) -> Dict[str, int]:
        """Scan one-file-per-entity / one-file-per-relation JSONs under
        ``source_dir`` (defaults to ``self.storage_path``) and rebuild a
        single aggregate ``graph_<graph_id>.json`` next to them.

        This is the prior-art's "local aggregate equivalent" — Zep exposes a
        single graph_id, here we keep the per-entity files (for cheap
        random access) AND write a periodically-refreshed aggregate so
        consumers can load the whole graph in one read instead of
        scanning 6910 inodes. See ws4gdxlm1 Step 6.

        Returns:
            ``{"nodes": int, "edges": int}`` written to the aggregate.
        """
        src = source_dir or self.storage_path
        if not os.path.isdir(src):
            return {"nodes": 0, "edges": 0}

        nodes: List[Dict[str, Any]] = []
        edges: List[Dict[str, Any]] = []
        try:
            files = sorted(os.listdir(src))
        except OSError:
            return {"nodes": 0, "edges": 0}

        for fname in files:
            if not fname.endswith(".json"):
                continue
            # Skip persistence artefacts (dedup indices + this aggregate file).
            if fname.startswith("_") or fname.startswith("graph_"):
                continue
            fpath = os.path.join(src, fname)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    payload = json.load(f)
            except (json.JSONDecodeError, OSError):
                continue
            if fname.startswith("relation_"):
                edges.append(payload)
            else:
                nodes.append(payload)

        aggregate = {
            "graph_id": graph_id,
            "nodes": nodes,
            "edges": edges,
        }
        # Atomic write so a partial failure doesn't leave a half-written
        # aggregate that crashes consumers on next read.
        path = self._get_graph_path(graph_id)
        tmp = path + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(aggregate, f, ensure_ascii=False)
            os.replace(tmp, path)
        except OSError:
            try:
                os.remove(tmp)
            except OSError:
                pass
            return {"nodes": 0, "edges": 0}

        return {"nodes": len(nodes), "edges": len(edges)}
