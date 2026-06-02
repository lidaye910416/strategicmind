"""
DocumentGraph - Multi-document relationship analysis

Analyzes relationships between multiple documents to determine
processing order (DAG).

Implements: US-055
"""

from typing import Dict, List, Any, Set
from dataclasses import dataclass, field
from collections import defaultdict


@dataclass
class DocumentNode:
    """A node in the document graph"""
    doc_id: str
    title: str
    dependencies: List[str] = field(default_factory=list)
    duplicates_with: List[str] = field(default_factory=list)


@dataclass
class DocumentGraph:
    """DAG of document relationships"""
    nodes: Dict[str, DocumentNode] = field(default_factory=dict)
    edges: List[Dict[str, str]] = field(default_factory=list)
    processing_order: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "nodes": {k: {
                "doc_id": v.doc_id,
                "title": v.title,
                "dependencies": v.dependencies,
                "duplicates_with": v.duplicates_with,
            } for k, v in self.nodes.items()},
            "edges": self.edges,
            "processing_order": self.processing_order,
        }


class DocumentGraphAnalyzer:
    """
    Analyzes document relationships and builds processing DAG.
    """
    
    def __init__(self):
        pass
    
    def analyze(
        self,
        documents: List[Dict[str, Any]],
    ) -> DocumentGraph:
        """
        Build document relationship graph.
        
        Args:
            documents: List of document dicts with 'id', 'title', 'content'
            
        Returns:
            DocumentGraph with nodes, edges, and processing order
        """
        graph = DocumentGraph()
        
        # Create nodes
        for doc in documents:
            doc_id = doc.get("id", "")
            graph.nodes[doc_id] = DocumentNode(
                doc_id=doc_id,
                title=doc.get("title", ""),
            )
        
        # Find relationships (duplicates, citations)
        for i, doc_a in enumerate(documents):
            for j, doc_b in enumerate(documents):
                if i >= j:
                    continue
                
                # Check for shared entities (deduplication)
                shared = self._find_shared_entities(doc_a, doc_b)
                if len(shared) >= 3:
                    graph.nodes[doc_a["id"]].duplicates_with.append(doc_b["id"])
                    graph.nodes[doc_b["id"]].duplicates_with.append(doc_a["id"])
                
                # Check for citation/reference
                if self._is_cited(doc_a, doc_b):
                    graph.nodes[doc_b["id"]].dependencies.append(doc_a["id"])
                    graph.edges.append({
                        "source": doc_a["id"],
                        "target": doc_b["id"],
                        "type": "citation",
                    })
        
        # Compute processing order (topological sort)
        graph.processing_order = self._topological_sort(graph)
        
        return graph
    
    def _find_shared_entities(
        self,
        doc_a: Dict[str, Any],
        doc_b: Dict[str, Any],
    ) -> Set[str]:
        """Find entities shared between documents"""
        import re
        
        text_a = doc_a.get("content", "") + " " + doc_a.get("title", "")
        text_b = doc_b.get("content", "") + " " + doc_b.get("title", "")
        
        entities_a = set(re.findall(r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b', text_a))
        entities_b = set(re.findall(r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b', text_b))
        
        return entities_a & entities_b
    
    def _is_cited(self, doc_a: Dict[str, Any], doc_b: Dict[str, Any]) -> bool:
        """Check if doc_b cites doc_a"""
        title_a = doc_a.get("title", "").lower()
        content_b = doc_b.get("content", "").lower()
        
        if title_a and len(title_a) > 5:
            return title_a in content_b
        return False
    
    def _topological_sort(self, graph: DocumentGraph) -> List[str]:
        """Topological sort of documents"""
        # Simple BFS
        in_degree = defaultdict(int)
        for node in graph.nodes.values():
            in_degree[node.doc_id] = len(node.dependencies)
        
        queue = [n for n in graph.nodes if in_degree[n] == 0]
        order = []
        
        while queue:
            doc_id = queue.pop(0)
            order.append(doc_id)
            
            for node in graph.nodes.values():
                if doc_id in node.dependencies:
                    in_degree[node.doc_id] -= 1
                    if in_degree[node.doc_id] == 0:
                        queue.append(node.doc_id)
        
        return order
