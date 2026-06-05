"""
Graph API - Build and query knowledge graphs

Refactored to use IKnowledgeStore/ISchemaStore interfaces.
Implements: US-029 (uses US-021 LocalKnowledgeStore)
"""

from flask import Blueprint, request, jsonify, send_from_directory
import os
import uuid

from ..config import config
from backend.services.graph_builder_service import GraphBuilderService
from backend.services.entity_extractor import EntityExtractor
from backend.services.semantic_chunker import SemanticChunker
from backend.services.document_intelligence import DocumentIntelligence
from backend.services.knowledge_enricher import KnowledgeEnricher
from backend.services.local_knowledge_store import LocalKnowledgeStore
from backend.services.local_graph_store import LocalGraphStore
from backend.adapters.bailian_adapter import BailianAdapter
from backend.models.seed_document import SeedDocument, DocumentType

graph_bp = Blueprint('graph', __name__, url_prefix='/api/graph')


@graph_bp.route('/upload', methods=['POST'])
def upload_document():
    """Upload a seed document"""
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400
    
    file = request.files['file']
    if not file.filename:
        return jsonify({"error": "Empty filename"}), 400
    
    # Save file
    doc_id = str(uuid.uuid4())
    filename = f"{doc_id}_{file.filename}"
    filepath = os.path.join(config.UPLOAD_FOLDER, filename)
    os.makedirs(config.UPLOAD_FOLDER, exist_ok=True)
    file.save(filepath)
    
    return jsonify({
        "doc_id": doc_id,
        "filename": file.filename,
        "size": os.path.getsize(filepath),
    })


@graph_bp.route('/build_graph', methods=['POST'])
def build_graph():
    """
    Build knowledge graph from documents.
    
    Full pipeline:
        1. Parse document → SeedDocument
        2. DocumentIntelligence → structured extraction
        3. SemanticChunker → semantic chunks
        4. KnowledgeEnricher → background context
        5. GraphBuilderService → build graph
    """
    data = request.get_json() or {}
    doc_ids = data.get("doc_ids", [])
    
    if not doc_ids:
        return jsonify({"error": "No doc_ids provided"}), 400
    
    try:
        # Initialize services (in production, use DI)
        graph_store = LocalGraphStore()
        llm = BailianAdapter(api_key=config.LLM_API_KEY)
        knowledge_store = LocalKnowledgeStore(
            graph_store=graph_store,
            llm_provider=llm,
        )
        
        entity_extractor = EntityExtractor(llm)
        builder = GraphBuilderService(
            entity_extractor=entity_extractor,
            knowledge_store=knowledge_store,
        )
        
        # Load documents (simplified)
        seed_documents = []
        for doc_id in doc_ids:
            # Find file
            for filename in os.listdir(config.UPLOAD_FOLDER):
                if filename.startswith(doc_id):
                    filepath = os.path.join(config.UPLOAD_FOLDER, filename)
                    with open(filepath, "r", encoding="utf-8") as f:
                        content = f.read()
                    seed_doc = SeedDocument(
                        doc_id=doc_id,
                        title=filename,
                        content=content,
                        doc_type=DocumentType.UNKNOWN,
                    )
                    seed_documents.append(seed_doc)
                    break
        
        # Build graph
        # Note: This is async, but for simplicity we run synchronously
        import asyncio
        result = asyncio.run(builder.build(seed_documents))
        
        return jsonify({
            "status": "success",
            "documents_processed": result["documents_processed"],
            "entities_created": result["entities_created"],
            "relations_created": result["relations_created"],
        })
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@graph_bp.route('/search', methods=['POST'])
def search_graph():
    """Search the knowledge graph"""
    data = request.get_json() or {}
    query = data.get("query", "")
    top_k = data.get("top_k", 10)
    
    if not query:
        return jsonify({"error": "No query provided"}), 400
    
    # Simplified - would use knowledge_store in production
    return jsonify({
        "query": query,
        "results": [],
    })


@graph_bp.route('/uploaded_files', methods=['GET'])
def list_uploaded_files():
    """List all uploaded files"""
    files = []
    if os.path.exists(config.UPLOAD_FOLDER):
        for filename in os.listdir(config.UPLOAD_FOLDER):
            files.append({
                "filename": filename,
                "size": os.path.getsize(os.path.join(config.UPLOAD_FOLDER, filename)),
            })
    return jsonify({"files": files})


@graph_bp.route('/nodes', methods=['GET'])
def list_graph_nodes():
    """列出图谱中的所有节点（用于前端可视化）"""
    try:
        graph_store = LocalGraphStore()
        all_nodes = graph_store.list_nodes() if hasattr(graph_store, 'list_nodes') else []
        all_edges = graph_store.list_edges() if hasattr(graph_store, 'list_edges') else []
        
        # 转换为前端友好的格式
        nodes = []
        for n in all_nodes[:200]:
            node_data = n.to_dict() if hasattr(n, 'to_dict') else dict(n)
            nodes.append({
                "id": str(node_data.get("id") or node_data.get("uuid") or node_data.get("name", "")),
                "label": node_data.get("name") or node_data.get("label", "Unknown"),
                "type": node_data.get("entity_type") or node_data.get("type", "ENTITY"),
                "summary": (node_data.get("summary") or "")[:200],
            })
        
        edges = []
        for e in all_edges[:300]:
            edge_data = e.to_dict() if hasattr(e, 'to_dict') else dict(e)
            edges.append({
                "source": str(edge_data.get("source") or edge_data.get("source_id", "")),
                "target": str(edge_data.get("target") or edge_data.get("target_id", "")),
                "type": edge_data.get("relation_type") or edge_data.get("type", "RELATED_TO"),
            })
        
        return jsonify({
            "nodes": nodes,
            "edges": edges,
            "node_count": len(nodes),
            "edge_count": len(edges),
        })
    except Exception as e:
        return jsonify({
            "nodes": [],
            "edges": [],
            "node_count": 0,
            "edge_count": 0,
            "error": str(e),
        })


@graph_bp.route('/demo-graph', methods=['GET'])
def demo_graph():
    """演示用图谱数据（用于前端可视化展示）"""
    nodes = [
        {"id": "n1", "label": "湖北数产集团", "type": "COMPANY", "summary": "湖北省数字产业发展集团，国资委直管"},
        {"id": "n2", "label": "数字政府业务", "type": "BUSINESS", "summary": "面向政府的数字化转型业务"},
        {"id": "n3", "label": "AI 中台", "type": "PRODUCT", "summary": "公司核心产品：AI 中台基础设施"},
        {"id": "n4", "label": "政务云", "type": "PRODUCT", "summary": "政务云平台产品"},
        {"id": "n5", "label": "张明", "type": "PERSON", "summary": "产品部负责人"},
        {"id": "n6", "label": "李强", "type": "PERSON", "summary": "销售部负责人"},
        {"id": "n7", "label": "王芳", "type": "PERSON", "summary": "技术部负责人"},
        {"id": "n8", "label": "陈静", "type": "PERSON", "summary": "财务部负责人"},
        {"id": "n9", "label": "周伟", "type": "PERSON", "summary": "战略发展部负责人"},
        {"id": "n10", "label": "国家发改委", "type": "GOVERNMENT", "summary": "国家发展和改革委员会"},
        {"id": "n11", "label": "湖北省国资委", "type": "GOVERNMENT", "summary": "湖北省人民政府国有资产监督管理委员会"},
        {"id": "n12", "label": "数据安全法", "type": "REGULATION", "summary": "中华人民共和国数据安全法"},
    ]
    edges = [
        {"source": "n1", "target": "n2", "type": "OWNS"},
        {"source": "n1", "target": "n3", "type": "OWNS"},
        {"source": "n1", "target": "n4", "type": "OWNS"},
        {"source": "n5", "target": "n1", "type": "WORKS_AT"},
        {"source": "n6", "target": "n1", "type": "WORKS_AT"},
        {"source": "n7", "target": "n1", "type": "WORKS_AT"},
        {"source": "n8", "target": "n1", "type": "WORKS_AT"},
        {"source": "n9", "target": "n1", "type": "WORKS_AT"},
        {"source": "n5", "target": "n3", "type": "MANAGES"},
        {"source": "n7", "target": "n3", "type": "MANAGES"},
        {"source": "n7", "target": "n4", "type": "MANAGES"},
        {"source": "n6", "target": "n2", "type": "SELLS"},
        {"source": "n1", "target": "n11", "type": "REGULATED_BY"},
        {"source": "n10", "target": "n2", "type": "INFLUENCES"},
        {"source": "n12", "target": "n3", "type": "CONSTRAINS"},
        {"source": "n3", "target": "n4", "type": "DEPENDS_ON"},
    ]
    return jsonify({
        "nodes": nodes,
        "edges": edges,
        "node_count": len(nodes),
        "edge_count": len(edges),
    })
