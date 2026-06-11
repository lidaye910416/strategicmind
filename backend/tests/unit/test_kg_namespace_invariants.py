"""
KG-OPT-P2 [P2-6-namespace-invariants]: 命名空间不变量单测

覆盖以下五条不变量:

  1) test_softdemoted_name_has_prefix
     GraphBuilderService.build 在 LLM 返回非白名单 type 时,
     软降级后 entity.name 必须以 "[fallback] " 开头,
     attributes["__is_fallback"] == True,
     attributes["original_entity_type"] == 原 type。

  2) test_softdemoted_entity_key_does_not_collide_with_real_concept
     真实 Concept ("Market") 与软降级后的 Concept ("[fallback] Market",
     __is_fallback=True) 在 LocalKnowledgeStore._entity_index 中
     占用完全不同的 key,确保下游客流能 namespace-隔离。

  3) test_extractor_and_graphbuilder_produce_same_dedup_key
     同一文本经 entity_extractor (ad-hoc) 与 graph_builder_service.build
     (pipeline) 两条路径处理,软降级后的同名实体在两边产生相同的
     dedup key (P2-1 单一源生效)。

  4) test_kg_prompts_whitelist_env_override
     monkeypatch STRATEGICMIND_KG_TYPE_TAXONOMY="Foo,Bar",
     kg_prompts.get_whitelist() 返回 frozenset({"Foo","Bar"});
     unset 后回退到默认 8 元组。

  5) test_kg_prompts_fallback_env_override
     monkeypatch STRATEGICMIND_KG_FALLBACK_TYPE="Misc",
     kg_prompts.get_fallback_type() 返回 "Misc"。

设计要点:
  - 使用 pytest + monkeypatch fixture。
  - mock LLM 直接 return dict, 不真实调用。
  - 每个测试独立, 不依赖前序状态 (用 tmp_path 隔离 store storage)。
  - 显式 unset monkeypatch.delenv 以保证 test 间互不污染。
"""

from __future__ import annotations

import os
import json
import asyncio
from typing import Any, Dict, List, Optional

import pytest

from backend.models.entity import Entity
from backend.models.seed_document import SeedDocument, DocumentType
from backend.models.text_normalize import make_entity_key
from backend.services.entity_extractor import EntityExtractor
from backend.services.graph_builder_service import GraphBuilderService
from backend.services.kg_prompts import (
    DEFAULT_ENTITY_TYPE_WHITELIST,
    ENV_TAXONOMY,
    ENV_FALLBACK_TYPE,
    get_whitelist,
    get_fallback_type,
)
from backend.tests.mocks.mock_llm_provider import MockLLMProvider
from backend.tests.mocks.mock_graph_store import MockGraphStore


# ---------------------------------------------------------------------------
# 公共 fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_llm_with_unknown_type() -> MockLLMProvider:
    """构造一个 LLM mock, entity 抽取返回非白名单 type ("Unknown")。

    同时为 relation 抽取返回空列表, 因为本次测试只关心 entity
    软降级桶行为, 不关心 relation。
    """
    entity_response = json.dumps([
        {
            "name": "Apple Inc.",
            "entity_type": "Unknown",  # 非白名单 → 触发软降级
            "summary": "Tech company",
            "signal_density": 0.7,
        },
    ])
    relation_response = json.dumps([])  # 无 relation
    mock = MockLLMProvider()
    mock.set_responses([entity_response, relation_response])
    return mock


class _StubKnowledgeStore:
    """最小可用的 IKnowledgeStore stub。

    GraphBuilderService.build 只用到 insert_entity / insert_relation,
    我们只实现这两个。返回一个 fake uuid 即可。
    """

    def __init__(self) -> None:
        self._entity_index: Dict[str, str] = {}
        self._relation_index: Dict[str, str] = {}
        self.inserted_entities: List[Dict[str, Any]] = []
        self.inserted_relations: List[Dict[str, Any]] = []

    async def insert_entity(
        self,
        entity: Dict[str, Any],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        name = entity.get("name", "")
        etype = entity.get("entity_type", "")
        eid = entity.get("uuid") or f"uuid-{len(self.inserted_entities)+1}"
        self.inserted_entities.append(entity)
        if name and etype:
            self._entity_index[make_entity_key(name, etype)] = eid
        return eid

    async def insert_relation(self, relation: Dict[str, Any]) -> str:
        rid = f"rel-{len(self.inserted_relations)+1}"
        self.inserted_relations.append(relation)
        return rid

    async def search(self, query: str, top_k: int = 10) -> List[Dict[str, Any]]:  # pragma: no cover
        return []

    async def get_entity(self, entity_id: str) -> Optional[Dict[str, Any]]:  # pragma: no cover
        return None

    async def get_neighbors(self, entity_id: str, **kwargs: Any) -> List[Dict[str, Any]]:  # pragma: no cover
        return []

    async def get_entity_context(self, entity_id: str, **kwargs: Any) -> str:  # pragma: no cover
        return ""


# ---------------------------------------------------------------------------
# 1) test_softdemoted_name_has_prefix
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_softdemoted_name_has_prefix(mock_llm_with_unknown_type: MockLLMProvider) -> None:
    """GraphBuilderService.build (LLM 返回非白名单 type) 走完后,
    最终落入 knowledge_store 的 entity 必须满足:
      - entity.name 以 "[fallback] " 开头
      - attributes["__is_fallback"] == True
      - attributes["original_entity_type"] == 原 type

    注意: 软降级可能在 extractor 端 (F3) 或 build 端 (F2) 触发,
    但只要最终插入的实体满足上述不变量即视为通过 — 这就是
    P2-1 单一源 + P1-FIX F3 设计的本意 (两处谁先做都行, 都产
    出一致的 fallback 桶形态)。
    """
    extractor = EntityExtractor(mock_llm_with_unknown_type)
    store = _StubKnowledgeStore()
    builder = GraphBuilderService(entity_extractor=extractor, knowledge_store=store)

    doc = SeedDocument(
        doc_id="doc-1",
        title="t",
        content="Apple Inc. is a tech company.",
        doc_type=DocumentType.NEWS,
    )
    stats = await builder.build([doc])

    # 至少一次软降级发生 (extractor F3 或 builder F2 之一)
    total_soft_demote = (
        builder.get_softdemote_count() + extractor._softdemote_count
    )
    assert total_soft_demote >= 1, (
        f"应至少发生一次软降级事件, "
        f"builder={builder.get_softdemote_count()}, "
        f"extractor={extractor._softdemote_count}"
    )
    assert stats["entities_created"] == 1

    # 通过 store 实际插入的实体检查
    assert len(store.inserted_entities) == 1
    inserted = store.inserted_entities[0]
    name = inserted["name"]
    attrs = inserted.get("attributes") or {}

    # 1) name 必须以 "[fallback] " 开头
    assert isinstance(name, str), f"name 应为 str, 实际 {type(name)}"
    assert name.startswith("[fallback] "), f"name 应以 '[fallback] ' 开头, 实际 {name!r}"

    # 2) attributes["__is_fallback"] == True
    assert attrs.get("__is_fallback") is True, (
        f"attributes['__is_fallback'] 应为 True, 实际 {attrs.get('__is_fallback')!r}"
    )

    # 3) attributes["original_entity_type"] == 原 type
    assert attrs.get("original_entity_type") == "Unknown", (
        f"attributes['original_entity_type'] 应为 'Unknown', "
        f"实际 {attrs.get('original_entity_type')!r}"
    )

    # 4) entity_type 已被降级为 fallback (默认 "Concept")
    assert inserted["entity_type"] == get_fallback_type(), (
        f"entity_type 应被降级为 fallback ({get_fallback_type()}), "
        f"实际 {inserted['entity_type']!r}"
    )


# ---------------------------------------------------------------------------
# 2) test_softdemoted_entity_key_does_not_collide_with_real_concept
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_softdemoted_entity_key_does_not_collide_with_real_concept() -> None:
    """真实 Concept ("Market") 与软降级后的 Concept ("[fallback] Market",
    __is_fallback=True) 在 LocalKnowledgeStore._entity_index 中必须占用
    完全不同的 key,确保 namespace 隔离。
    """
    # 真实 Concept (白名单内, 不触发软降级)
    real_entity = Entity.from_name(
        name="Market",
        entity_type="Concept",
        summary="real concept",
        attributes={"__is_fallback": False},
    )
    # 软降级后的 Concept (白名单内, 但标记为 fallback; 模拟 F2 桶)
    soft_entity = Entity.from_name(
        name="[fallback] Market",
        entity_type="Concept",
        summary="soft demoted",
        attributes={"__is_fallback": True, "original_entity_type": "Unknown"},
    )

    # 1) _norm_key 必然不同
    real_key = make_entity_key(real_entity.name, real_entity.entity_type)
    soft_key = make_entity_key(soft_entity.name, soft_entity.entity_type)
    assert real_key != soft_key, (
        f"_norm_key 碰撞: real={real_key!r} == soft={soft_key!r}, namespace 隔离失败"
    )
    # 确认形态: soft 的 norm 含 "[fallback]" 标签
    assert "[fallback]" not in real_key
    assert "[fallback]" in soft_key or "fallback" in soft_key, (
        f"soft key 应保留 'fallback' 标签, 实际 {soft_key!r}"
    )

    # 2) _entity_index 互不覆盖
    index: Dict[str, str] = {}
    index[real_key] = real_entity.uuid
    index[soft_key] = soft_entity.uuid
    assert len(index) == 2, f"_entity_index 应有 2 个不同 key, 实际 {len(index)}"
    assert index[real_key] == real_entity.uuid
    assert index[soft_key] == soft_entity.uuid

    # 3) 反向: 即便外部代码不知道 fallback 标记,
    #    用 (name, type) 查询时, 真实 Market 不会拿到 soft 那个 uuid
    lookup_real = index.get(make_entity_key("Market", "Concept"))
    lookup_soft = index.get(make_entity_key("[fallback] Market", "Concept"))
    assert lookup_real == real_entity.uuid
    assert lookup_soft == soft_entity.uuid
    assert lookup_real != lookup_soft


# ---------------------------------------------------------------------------
# 3) test_extractor_and_graphbuilder_produce_same_dedup_key
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_extractor_and_graphbuilder_produce_same_dedup_key() -> None:
    """同一文本经 entity_extractor (ad-hoc) 与 graph_builder_service.build
    (pipeline) 两条路径处理, 软降级后必须产生相同的 dedup key (P2-1 单一源)。
    """
    text = "Apple Inc. is a technology company."

    # 路径 A: entity_extractor 直接调用 (ad-hoc)
    mock_a = MockLLMProvider()
    mock_a.set_responses([
        json.dumps([
            {
                "name": "Apple Inc.",
                "entity_type": "Unknown",  # 非白名单
                "summary": "Tech company",
                "signal_density": 0.7,
            },
        ]),
        json.dumps([]),
    ])
    extractor_a = EntityExtractor(mock_a)
    entities_a = await extractor_a.extract_entities(text)
    assert len(entities_a) == 1
    soft_a = entities_a[0]
    # extractor 端 F3 已实施软降级, 验证之
    assert soft_a.name.startswith("[fallback] "), (
        f"extractor 路径应已软降级, name={soft_a.name!r}"
    )
    assert soft_a.entity_type == get_fallback_type()

    # 路径 B: graph_builder_service.build (pipeline)
    mock_b = MockLLMProvider()
    mock_b.set_responses([
        json.dumps([
            {
                "name": "Apple Inc.",
                "entity_type": "Unknown",  # 非白名单
                "summary": "Tech company",
                "signal_density": 0.7,
            },
        ]),
        json.dumps([]),
    ])
    extractor_b = EntityExtractor(mock_b)
    store_b = _StubKnowledgeStore()
    builder_b = GraphBuilderService(entity_extractor=extractor_b, knowledge_store=store_b)

    doc = SeedDocument(
        doc_id="doc-2",
        title="t",
        content=text,
        doc_type=DocumentType.NEWS,
    )
    await builder_b.build([doc])
    assert len(store_b.inserted_entities) == 1
    soft_b = store_b.inserted_entities[0]

    # 核心断言: 两条路径产生的 dedup key 完全相同 (P2-1 单一源)
    key_a = make_entity_key(soft_a.name, soft_a.entity_type)
    key_b = make_entity_key(soft_b["name"], soft_b["entity_type"])
    assert key_a == key_b, (
        f"dedup key 不一致: extractor={key_a!r} vs graph_builder={key_b!r}; "
        f"extractor 软降级桶未与 graph_builder 同步"
    )

    # 进一步: 软降级属性桶也一致
    attrs_a = soft_a.attributes or {}
    attrs_b = soft_b.get("attributes") or {}
    assert attrs_a.get("__is_fallback") is True
    assert attrs_b.get("__is_fallback") is True
    assert attrs_a.get("original_entity_type") == attrs_b.get("original_entity_type")
    assert attrs_a.get("original_entity_type") == "Unknown"


# ---------------------------------------------------------------------------
# 4) test_kg_prompts_whitelist_env_override
# ---------------------------------------------------------------------------

def test_kg_prompts_whitelist_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    """monkeypatch STRATEGICMIND_KG_TYPE_TAXONOMY='Foo,Bar',
    get_whitelist() 返回 frozenset({'Foo','Bar'}); unset 后回退到默认 8 元组。
    """
    # 设置前: 默认 8 元组
    monkeypatch.delenv(ENV_TAXONOMY, raising=False)
    assert get_whitelist() == DEFAULT_ENTITY_TYPE_WHITELIST, (
        f"默认白名单应等于 DEFAULT_ENTITY_TYPE_WHITELIST, "
        f"实际 {sorted(get_whitelist())}"
    )
    assert len(get_whitelist()) == 8, (
        f"默认白名单长度应为 8, 实际 {len(get_whitelist())}"
    )

    # 设置后: 覆盖到 {Foo, Bar}
    monkeypatch.setenv(ENV_TAXONOMY, "Foo,Bar")
    result = get_whitelist()
    assert result == frozenset({"Foo", "Bar"}), (
        f"override 白名单应等于 frozenset({{'Foo','Bar'}}), 实际 {sorted(result)}"
    )

    # unset 后回退到默认
    monkeypatch.delenv(ENV_TAXONOMY, raising=False)
    assert get_whitelist() == DEFAULT_ENTITY_TYPE_WHITELIST


# ---------------------------------------------------------------------------
# 5) test_kg_prompts_fallback_env_override
# ---------------------------------------------------------------------------

def test_kg_prompts_fallback_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    """monkeypatch STRATEGICMIND_KG_FALLBACK_TYPE='Misc',
    get_fallback_type() 返回 'Misc'; unset 后回退到默认 'Concept'。
    """
    # 设置前: 默认 'Concept' (from kg_prompts.DEFAULT_ENTITY_TYPE_FALLBACK)
    monkeypatch.delenv(ENV_FALLBACK_TYPE, raising=False)
    from backend.services.kg_prompts import DEFAULT_ENTITY_TYPE_FALLBACK
    assert get_fallback_type() == DEFAULT_ENTITY_TYPE_FALLBACK
    assert get_fallback_type() == "Concept"

    # 设置后: 覆盖到 "Misc"
    monkeypatch.setenv(ENV_FALLBACK_TYPE, "Misc")
    assert get_fallback_type() == "Misc", (
        f"override fallback 应为 'Misc', 实际 {get_fallback_type()!r}"
    )

    # unset 后回退
    monkeypatch.delenv(ENV_FALLBACK_TYPE, raising=False)
    assert get_fallback_type() == "Concept"
