"""
Entity dataclass - Generic entity representation

This model provides a generic entity representation that is not tied to
any specific storage backend (Zep, nano-GraphRAG, etc.).

Replaces: zep_entity_reader.EntityNode usage in ProfileGenerator
"""

from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional
from uuid import uuid4

from .text_normalize import make_entity_key


@dataclass
class Entity:
    """
    Generic entity representation for knowledge graph.

    This is the core entity model used throughout the system,
    independent of any specific knowledge store implementation.

    Attributes:
        uuid: Unique identifier for the entity
        name: Entity name (required)
        entity_type: Type classification (e.g., "Person", "Organization", "Location")
        summary: Brief description or summary of the entity
        attributes: Additional attributes as key-value pairs
        metadata: Optional metadata (source, timestamps, etc.)
        _norm_key: Stable normalized (name, entity_type) lookup key. Computed
            in __post_init__ so persistence layers can dedup without
            re-deriving the key. Mirrors the prior-art's reliance on Zep's
            server-side name merging — see ws4gdxlm1.
    """

    uuid: str = field(default_factory=lambda: str(uuid4()))
    name: str = ""
    entity_type: str = ""
    summary: str = ""
    attributes: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)
    _norm_key: str = ""

    def __post_init__(self):
        """Validate required fields + compute normalized lookup key."""
        if not self.name:
            raise ValueError("Entity name is required")
        if not self.entity_type:
            raise ValueError("Entity type is required")
        # Recompute _norm_key so it always matches current name/entity_type.
        # Callers should never set this manually — it's derived state.
        self._norm_key = make_entity_key(self.name, self.entity_type)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary representation"""
        return {
            "uuid": self.uuid,
            "name": self.name,
            "entity_type": self.entity_type,
            "summary": self.summary,
            "attributes": self.attributes,
            "metadata": self.metadata,
            "_norm_key": self._norm_key,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Entity':
        """Create Entity from dictionary"""
        return cls(
            uuid=data.get("uuid", str(uuid4())),
            name=data.get("name", ""),
            entity_type=data.get("entity_type", ""),
            summary=data.get("summary", ""),
            attributes=data.get("attributes", {}),
            metadata=data.get("metadata", {}),
        )

    @classmethod
    def from_name(
        cls,
        name: str,
        entity_type: str,
        *,
        summary: str = "",
        attributes: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        knowledge_store: Any = None,
    ) -> 'Entity':
        """Create an Entity with the canonical lookup key computed up-front.

        If a ``knowledge_store`` is supplied AND it exposes an ``_entity_index``
        mapping (LocalKnowledgeStore), the returned Entity reuses the existing
        uuid when a record for the normalized (name, entity_type) already
        exists. This lets the model layer participate in dedup without
        depending on the service layer (knowledge_store is a duck-typed
        ``Any`` so passing ``None`` keeps unit tests trivial).

        Args:
            name: Entity name (required, non-empty)
            entity_type: Type classification (required, non-empty)
            summary: Optional brief description
            attributes: Optional attributes dict
            metadata: Optional metadata dict
            knowledge_store: Optional store with ``_entity_index: Dict[str, str]``
                whose keys are ``make_entity_key(name, type)``

        Returns:
            Entity instance with `_norm_key` set and (if a store hit occurred)
            `uuid` matching the existing entity.

        Note (KG-OPT-C1): 该 classmethod 保持同步签名以兼容现有调用方
        （``EntityExtractor._parse_entity_response`` 在同步路径中构造
        Entity）。读侧的 ``dict.get`` 是原子的，HIT 路径无 race；MISS 路径
        分配的 uuid 在后续 ``store.insert_entity`` 锁内被覆盖（first-wins
        语义由 ``insert_entity`` 的 ``async with self._index_lock`` 守护）。
        锁内分配 API 见 :py:meth:`LocalKnowledgeStore.locked_lookup_or_reserve_uuid`，
        已可在 async 调用方处直接 ``await`` 使用 —— 模型层保留同步路径
        是为了不破坏现有 48 个测试。
        """
        key = make_entity_key(name, entity_type)
        existing_uuid: Optional[str] = None
        if knowledge_store is not None:
            index = getattr(knowledge_store, "_entity_index", None)
            if isinstance(index, dict):
                hit = index.get(key)
                if isinstance(hit, str) and hit:
                    existing_uuid = hit

        return cls(
            uuid=existing_uuid or str(uuid4()),
            name=name,
            entity_type=entity_type,
            summary=summary,
            attributes=attributes or {},
            metadata=metadata or {},
        )

    def add_attribute(self, key: str, value: Any) -> None:
        """Add or update an attribute"""
        self.attributes[key] = value

    def get_attribute(self, key: str, default: Any = None) -> Any:
        """Get an attribute value"""
        return self.attributes.get(key, default)
