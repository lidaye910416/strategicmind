"""
Graph API - Build and query knowledge graphs

Refactored to use IKnowledgeStore/ISchemaStore interfaces.
Implements: US-029 (uses US-021 LocalKnowledgeStore)
"""

from flask import Blueprint, request, jsonify, send_from_directory
import os
import uuid

from .config import config
from ..services.graph_builder_service import GraphBuilderService
from ..services.entity_extractor import EntityExtractor
from ..services.semantic_chunker import SemanticChunker
from ..services.document_intelligence import DocumentIntelligence
from ..services.knowledge_enricher import KnowledgeEnricher
from ..services.local_knowledge_store import LocalKnowledgeStore
from ..services.local_graph_store import LocalGraphStore
from ..adapters.bailian_adapter import BailianAdapter

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
                    from ..models.seed_document import SeedDocument, DocumentType
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
