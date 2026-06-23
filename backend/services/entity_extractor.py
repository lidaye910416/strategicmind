"""
EntityExtractor - LLM-based entity and relation extraction

This service extracts entities and relationships from text using LLM,
replacing Zep's auto-extraction capability.

The key difference from the prior-art (Zep): Zep has built-in LLM extraction,
nano-graphRAG does not. This service provides that capability.

Replaces: Zep's automatic entity extraction
"""

import asyncio
import os
from typing import List, Dict, Any, Optional, Callable
from dataclasses import dataclass

from ..interfaces.llm_provider import ILLMProvider
from ..models.entity import Entity

# KG-OPT-P2 [P2-1-prompt-template]: 从单一真相源 kg_prompts 导入常量与
# 提示词构建函数,避免 entity_extractor ↔ graph_builder_service 双源漂移。
# 这里 re-export 一组 module-level 同名别名,既保持旧调用方代码不变,
# 又让所有常量来自 kg_prompts(可被环境变量 STRATEGICMIND_KG_TYPE_TAXONOMY
# / STRATEGICMIND_KG_FALLBACK_TYPE 覆盖)。
from .kg_prompts import (  # KG-OPT-P2 [P2-1-prompt-template]: single source
    build_entity_extraction_prompt as _kg_build_entity_extraction_prompt,
    build_relation_extraction_prompt as _kg_build_relation_extraction_prompt,
    build_legacy_entity_extraction_prompt as _kg_build_legacy_entity_extraction_prompt,
    build_legacy_relation_extraction_prompt as _kg_build_legacy_relation_extraction_prompt,
    get_whitelist as _kg_get_whitelist,
    get_fallback_type as _kg_get_fallback_type,
    MAX_ENTITIES_HINT,
    MAX_RELATIONS_HINT,
    SKIP_ROLE_PATTERNS_CN,
    SKIP_ROLE_PATTERNS_EN,
    SKIP_ROLE_PATTERNS,
    DEFAULT_BOTTOM_TYPES,
)


# KG-OPT-P0 [entity-cap-hardening]: 模块级常量与 feature flag 解析
# 这些常量集中管理 hard-cap 行为，配合 STRATEGICMIND_USE_HARD_CAP 实现
# 旧 prompt → 新 prompt 的可降级切换。
# KG-OPT-P2 [P2-1-prompt-template]: MAX_ENTITIES / MAX_RELATIONS /
# SKIP_ROLE_PATTERNS_* / DEFAULT_BOTTOM_TYPES 已迁出到 kg_prompts,
# 仍以同名 module-level 别名保留(指向 kg_prompts 的同名常量),既保持
# 旧调用方不变,又让所有真实值来自单一来源。
HARD_CAP_ENV_VAR = "STRATEGICMIND_USE_HARD_CAP"
# 向后兼容别名：旧代码 / 测试直接引用 MAX_ENTITIES / MAX_RELATIONS 不需要改。
MAX_ENTITIES = MAX_ENTITIES_HINT
MAX_RELATIONS = MAX_RELATIONS_HINT

# KG-OPT-P1-FIX F3: extractor 端的白名单。
# KG-OPT-P2 [P2-1-prompt-template]: 不再本地复制 frozenset,改为调用
# kg_prompts.get_whitelist() —— 后者会读 STRATEGICMIND_KG_TYPE_TAXONOMY
# 覆盖,且通过 frozenset 提供 O(1) 成员判断。每次调用都热解析,行为与
# 旧版（一次性绑定）兼容（默认 env 未设置时返回与旧版完全相同的 8 个类型）。
def _LOCAL_ENTITY_TYPE_WHITELIST():
    """KG-OPT-P2 [P2-1-prompt-template]: 热路径白名单(替代旧的 frozenset 常量)。
    返回 frozenset,可直接 ``in`` 判断。"""
    return _kg_get_whitelist()


# KG-OPT-P1-FIX F3: 软降级目标 entity_type,与 graph_builder_service._ENTITY_TYPE_FALLBACK
# 行为一致 —— 可被环境变量 STRATEGICMIND_KG_FALLBACK_TYPE 覆盖,默认 "Concept"。
# KG-OPT-P2 [P2-1-prompt-template]: 不再一次性绑定,而是函数式热解析,行为兼容。
def _LOCAL_ENTITY_TYPE_FALLBACK():
    """KG-OPT-P2 [P2-1-prompt-template]: 热路径 fallback type(替代旧的常量)。"""
    return _kg_get_fallback_type()


# KG-OPT-P1-FIX F3: 模块级软降级事件计数器（供调试 / benchmark 跨实例聚合）。
# 同时在 EntityExtractor 实例上有 self._softdemote_count，两者同步递增。
_extractor_softdemote_count = 0


def _resolve_use_hard_cap() -> bool:
    """解析 STRATEGICMIND_USE_HARD_CAP；默认开启（与文档一致）。

    解析语义与 ``backend.config.manager._parse_bool`` 对齐：
    truthy (1/true/yes/on) → True；falsy (0/false/no/off) → False；
    未设置或不可识别值 → ``default``。
    """
    # KG-OPT-P0-FIX [M2]: 与 graph_builder 统一走 backend.config.manager.parse_bool
    try:
        from backend.config.manager import parse_bool
    except Exception:  # KG-OPT-P0-FIX [M2]: 兜底，import 失败时使用本地 4 行实现
        _truthy = {"1", "true", "yes", "on"}

        def parse_bool(value, default: bool = True) -> bool:  # type: ignore[no-redef]
            if value is None:
                return default
            if not isinstance(value, str):
                return bool(value)
            return value.strip().lower() in _truthy
    return parse_bool(os.environ.get(HARD_CAP_ENV_VAR), default=True)


@dataclass
class Relation:
    """Represents a relationship between two entities"""
    source: str       # Source entity ID or name
    target: str       # Target entity ID or name
    relation_type: str  # Type of relationship (e.g., "WORKS_FOR", "COMPETES_WITH")
    attributes: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.attributes is None:
            self.attributes = {}


class EntityExtractor:
    """
    Extract entities and relationships from text using LLM.
    
    This is the KEY DIFFERENCE from the prior art - Zep has built-in LLM extraction,
    nano-graphRAG does not. This service provides that capability.
    
    Usage:
        extractor = EntityExtractor(llm_provider)
        
        # Single extraction
        entities = await extractor.extract_entities(text, ontology)
        relations = await extractor.extract_relations(text, entities, ontology)
        
        # Batch extraction
        async for progress in extractor.extract_batch(texts, ontology, progress_callback):
            print(f"Progress: {progress}")
    """
    
    def __init__(
        self,
        llm_provider: ILLMProvider,
        batch_size: int = 10,
        max_concurrent: int = 5,
        knowledge_store: Any = None,
    ):
        """
        Initialize EntityExtractor.

        Args:
            llm_provider: LLM provider for extraction calls
            batch_size: Number of texts per batch
            max_concurrent: Maximum concurrent LLM calls
            knowledge_store: Optional reference back to the knowledge store
                that owns this extractor. When set, parsed entities are
                created via ``Entity.from_name(..., knowledge_store=store)``
                so they reuse the existing uuid when the normalized
                (name, entity_type) already exists. Wiring this is what
                makes the three-layer dedup (model → extractor → store)
                actually defensive — see ws4gdxlm1 Step 3.
        """
        self.llm_provider = llm_provider
        self.batch_size = batch_size
        self.max_concurrent = max_concurrent
        self._semaphore = asyncio.Semaphore(max_concurrent)
        # Late-bindable: callers that don't have a store at construction
        # time (e.g. GraphBuilderService) may set ``extractor.knowledge_store``
        # after the fact.
        self.knowledge_store = knowledge_store
        # KG-OPT-P0 [entity-cap-hardening]: 一次性解析 feature flag，
        # 避免每个 prompt 构建都重新读环境变量（批量路径是热路径）。
        self._use_hard_cap = _resolve_use_hard_cap()
        # KG-OPT-P1-FIX F1: lock 下沉到 check-then-set 处，避免 LLM 并发被序列化。
        # 旧版在 ``extract_batch._extract_one`` 整次包住 ``async with self._index_lock``，
        # 会让锁覆盖整段 LLM ``await``（秒级），FIFO 公平下并发被打回 1。
        # 真正的 ``_entity_index`` 属于 ``LocalKnowledgeStore`` / ``Entity.from_name``，
        # 保护职责下放到那一层 — 此处不再持有锁。``_semaphore`` 仍负责
        # LLM 调用并发上限。
        # KG-OPT-P1 [P1-A4]: 批量失败收集；与原签名同形态（list of list），
        # 调用方可通过 ``extractor._batch_failures`` 排查异常。
        self._batch_failures: List[str] = []
        # KG-OPT-P1-FIX F3: extractor 端软降级事件计数器（实例级），
        # 与模块级 _extractor_softdemote_count 同步递增；与 graph_builder
        # F2 的 GraphBuilderService._softdemote_count 行为一致，供 benchmark
        # 跨层聚合统计使用。
        self._softdemote_count: int = 0
    
    async def extract_entities(
        self,
        text: str,
        ontology: Optional[Dict[str, Any]] = None,
    ) -> List[Entity]:
        """
        Extract entities from a single text.
        
        Args:
            text: Input text to extract from
            ontology: Optional ontology schema to guide extraction
            
        Returns:
            List of Entity objects
        """
        # KG-OPT-P0-FIX [C1]: 空/空白 text 早退，避免无意义 LLM 调用。
        if not text or not text.strip():
            return []

        prompt = self._build_entity_extraction_prompt(text, ontology)
        
        messages = [
            {"role": "system", "content": "You are an expert entity extraction system."},
            {"role": "user", "content": prompt},
        ]
        
        response = await self.llm_provider.chat(messages)
        
        return self._parse_entity_response(response)
    
    async def extract_relations(
        self,
        text: str,
        entities: List[Entity],
        ontology: Optional[Dict[str, Any]] = None,
    ) -> List[Relation]:
        """
        Extract relationships between entities from text.
        
        Args:
            text: Input text
            entities: List of entities extracted from text
            ontology: Optional ontology schema
            
        Returns:
            List of Relation objects
        """
        # KG-OPT-P0-FIX [C1]: 早退顺序 — 先 text 检查，再 entities=[] 列表检查。
        if not text or not text.strip():
            return []
        if not entities:
            return []
        
        prompt = self._build_relation_extraction_prompt(text, entities, ontology)
        
        messages = [
            {"role": "system", "content": "You are an expert relationship extraction system."},
            {"role": "user", "content": prompt},
        ]
        
        response = await self.llm_provider.chat(messages)
        
        return self._parse_relation_response(response, entities)
    
    async def extract_batch(
        self,
        texts: List[str],
        ontology: Optional[Dict[str, Any]] = None,
        progress_callback: Optional[Callable[[float], None]] = None,
    ) -> List[List[Entity]]:
        """
        Extract entities from multiple texts in batch mode.

        This is the preferred method for processing large document collections,
        using async extraction with controlled concurrency.

        Args:
            texts: List of input texts
            ontology: Optional ontology schema
            progress_callback: Optional callback for progress updates (0.0 to 1.0)

        Returns:
            List of entity lists, one per input text (preserves order).
            Failed texts become empty lists; their error messages are
            appended to ``self._batch_failures`` (capacity 100) for
            post-hoc inspection by the caller.
        """
        # KG-OPT-P1-FIX F1: lock 下沉到 check-then-set 处，避免 LLM 并发被序列化。
        # 旧版在这里用 ``async with self._index_lock`` 包住每次 ``extract_entities``，
        # 锁覆盖整段 LLM ``await``（秒级），FIFO 公平下 ``asyncio.gather`` 退化为串行，
        # 浪费 ``_semaphore(max_concurrent=5)``。现在 LLM 调用本身保持并发，
        # ``_entity_index`` 的读写保护由 store 层（``LocalKnowledgeStore`` /
        # ``Entity.from_name``）负责在 check-then-set 处加锁。
        # KG-OPT-P1 [P1-A4]: 收集失败到 ``self._batch_failures``，容量 100；
        # 比 ``return_exceptions=True`` 静默吞掉更可观测。
        import logging
        _logger = logging.getLogger(__name__)

        results: List[List[Entity]] = []
        total = len(texts)

        async def _extract_one(text: str) -> List[Entity]:
            # KG-OPT-P1-FIX F1: lock 下沉到 check-then-set 处，避免 LLM 并发被序列化。
            # 不再加 ``async with self._index_lock`` — LLM 调用本身保持并发。
            return await self.extract_entities(text, ontology)

        for i in range(0, total, self.batch_size):
            batch = texts[i:i + self.batch_size]

            # Process batch with controlled concurrency
            batch_results = await asyncio.gather(
                *[_extract_one(text) for text in batch],
                return_exceptions=True,
            )

            for idx, result in enumerate(batch_results):
                if isinstance(result, Exception):
                    _logger.warning(
                        "extract_batch item %s failed: %s", i + idx, result
                    )
                    if len(self._batch_failures) < 100:
                        self._batch_failures.append(f"{i + idx}: {result!r}")
                    results.append([])
                else:
                    results.append(result)

            # Report progress
            if progress_callback:
                progress_callback((i + len(batch)) / total)

        return results
    
    def _build_entity_extraction_prompt(
        self,
        text: str,
        ontology: Optional[Dict[str, Any]],
    ) -> str:
        """Build prompt for entity extraction.

        KG-OPT-P0 [entity-cap-hardening]:
        - 当 ``STRATEGICMIND_USE_HARD_CAP`` 开启（默认），返回带 hard-cap
          + 严格 enum + signal_density + 跳过角色类指令的新 prompt。
        - 当 flag 关闭，返回与改前字节一致的旧 prompt（便于回滚 / 缓存命中）。

        KG-OPT-P2 [P2-1-prompt-template]: 改为 thin wrapper,真实 prompt
        构造逻辑委托给 kg_prompts.build_entity_extraction_prompt。
        """
        return _kg_build_entity_extraction_prompt(
            text, ontology, use_hard_cap=self._use_hard_cap
        )

    def _legacy_entity_extraction_prompt(
        self,
        text: str,
        ontology: Optional[Dict[str, Any]],
    ) -> str:
        """旧版 entity prompt（feature flag 关闭时回退到这里的字节内容）。

        KG-OPT-P2 [P2-1-prompt-template]: thin wrapper,真实文本在 kg_prompts。
        """
        return _kg_build_legacy_entity_extraction_prompt(text, ontology)

    def _build_relation_extraction_prompt(
        self,
        text: str,
        entities: List[Entity],
        ontology: Optional[Dict[str, Any]],
    ) -> str:
        """Build prompt for relation extraction.

        KG-OPT-P0 [entity-cap-hardening]:
        - 当 ``STRATEGICMIND_USE_HARD_CAP`` 开启（默认），返回带 hard-cap
          + source/target 必须来自 entities 列表 + 仅高信噪比边的新 prompt。
        - 当 flag 关闭，返回与改前字节一致的旧 prompt。

        KG-OPT-P2 [P2-1-prompt-template]: 改为 thin wrapper,真实 prompt
        构造逻辑委托给 kg_prompts.build_relation_extraction_prompt。
        """
        return _kg_build_relation_extraction_prompt(
            text, entities, use_hard_cap=self._use_hard_cap
        )

    def _legacy_relation_extraction_prompt(
        self,
        text: str,
        entities: List[Entity],
        ontology: Optional[Dict[str, Any]],
    ) -> str:
        """旧版 relation prompt（feature flag 关闭时回退到这里的字节内容）。

        KG-OPT-P2 [P2-1-prompt-template]: thin wrapper,真实文本在 kg_prompts。
        """
        return _kg_build_legacy_relation_extraction_prompt(text, entities, ontology)
    
    def _parse_entity_response(self, response: str) -> List[Entity]:
        """Parse LLM response into Entity objects.

        Uses ``Entity.from_name`` so each entity carries a stable
        ``_norm_key`` from creation time and — when a knowledge_store is
        wired — reuses an existing uuid for the same normalized
        (name, entity_type). This is the model-layer half of the three-layer
        dedup (model → extractor → store); the store-layer guard in
        ``LocalKnowledgeStore.insert_entity`` still catches anything that
        slips through (e.g. extractor with no store wired).
        """
        import json
        import re

        # Try to extract JSON from response
        json_match = re.search(r'\[.*\]', response, re.DOTALL)
        if not json_match:
            return []

        try:
            data = json.loads(json_match.group())
            entities = []

            for item in data:
                if isinstance(item, dict) and "name" in item:
                    # KG-OPT-P0-FIX [M5]: 把 LLM 给的 signal_density 写入 attributes，
                    # 缺字段时 0.5 兜底，供后续排序使用。
                    raw_attrs = dict(item.get("attributes") or {})
                    if "signal_density" in item:
                        raw = item["signal_density"]
                    elif "signal_density" in raw_attrs:
                        raw = raw_attrs["signal_density"]
                    else:
                        raw = 0.5
                    # KG-OPT-P1 [P1-A2]: signal_density 范围 clamp 到 [0.0, 1.0]，
                    # 避免 LLM 返回越界值（1.5 / -0.3）破坏排序与下游消费者。
                    try:
                        raw_float = float(raw)
                    except (TypeError, ValueError):
                        raw_float = 0.5
                    raw_attrs["signal_density"] = max(0.0, min(1.0, raw_float))
                    # KG-OPT-P1-FIX F3: extractor 端同步实施软降级避免 store 三层漂移。
                    # 在 ``Entity.from_name`` 之前把白名单外的 entity_type 改写为
                    # _LOCAL_ENTITY_TYPE_FALLBACK（默认 "Concept"），并把原始 type 记到
                    # attributes["original_entity_type"]、设置 attributes["__is_fallback"]=True、
                    # 在 name 前加 "[fallback] " 前缀——与 graph_builder F2 软降级桶行为
                    # 字节级一致。这样 ``make_entity_key(name, entity_type)`` 计算出的
                    # _norm_key 自然带 namespace 隔离，避免 ad-hoc extraction 路径把
                    # "Unknown" / "Other" / "Technology" 等污染进 _entity_index。仅在
                    # flag=on 启用；flag=off 时保留原行为（无白名单检查）。
                    raw_name = item["name"]
                    raw_type = item.get("entity_type", "Unknown")
                    if self._use_hard_cap:
                        if not isinstance(raw_type, str) or raw_type not in _LOCAL_ENTITY_TYPE_WHITELIST():
                            _fallback = _LOCAL_ENTITY_TYPE_FALLBACK()
                            # 仅当原始 type 与 fallback 不同时记录 original，避免污染。
                            if isinstance(raw_type, str) and raw_type != _fallback:
                                raw_attrs["original_entity_type"] = raw_type
                            # 标记软降级桶，供下游 namespace 隔离用。
                            is_already_fallback = bool(raw_attrs.get("__is_fallback"))
                            raw_attrs["__is_fallback"] = True
                            # 软降级到 fallback type。
                            raw_type = _fallback
                            # name 加前缀确保 _norm_key 命名空间隔离。重复处理时
                            # （罕见）不再二次加前缀，避免 "[fallback] [fallback] X"。
                            if not is_already_fallback:
                                if not isinstance(raw_name, str):
                                    raw_name = "" if raw_name is None else str(raw_name)
                                if not raw_name.startswith("[fallback] "):
                                    raw_name = "[fallback] " + raw_name
                            # 计数 + 审计日志，便于 benchmark 与排查。
                            self._softdemote_count += 1
                            global _extractor_softdemote_count
                            _extractor_softdemote_count += 1
                            try:
                                import logging
                                _logger = logging.getLogger(__name__)
                                _logger.warning(
                                    "KG soft-demote (extractor): original_type=%r name=%r -> fallback=%r",
                                    raw_attrs.get("original_entity_type"),
                                    raw_name,
                                    _fallback,
                                )
                            except Exception:
                                # logger 配置不可用时静默 — 主流程优先。
                                pass
                    # KG-OPT-P1-FIX F1: ``_entity_index`` 的读 / 写保护由 store 层
                    # （``LocalKnowledgeStore`` / ``Entity.from_name`` 的 check-then-set
                    # 处）负责。``extract_batch`` 不再在外层加锁 — 避免把 LLM ``await``
                    # 串行化。此处只做构造。
                    try:
                        entity = Entity.from_name(
                            name=raw_name,
                            entity_type=raw_type,
                            summary=item.get("summary", ""),
                            attributes=raw_attrs,
                            knowledge_store=self.knowledge_store,
                        )
                        entities.append(entity)
                    except ValueError:
                        # name or entity_type empty after stripping —
                        # skip rather than abort the whole batch.
                        continue

            # KG-OPT-P0-FIX [M1]: flag=on 时硬截断到 MAX_ENTITIES。
            # flag=off 时保持与改前字节级一致 — 不排序、不切片。
            # KG-OPT-P1 [P1-A1]: 排序 key 改为主 = signal_density（高在前）、
            # 次 = summary 长度（长在前）做 tiebreaker。两者都已经是
            # float/int 可比较类型，clamp 后不会越界。
            # Agent 3A v2 N-fix: 软降级桶独立计数
            # 旧实现: 软降级桶 (fallback entities) 与 whitelist 实体混在同一 list
            # 参与 MAX_ENTITIES 排序, 长尾 fallback 挤掉真实高 signal primary.
            # 新实现: 分桶 -> primary 独立排序截断 -> fallback 独立排序截断 -> 拼接.
            if self._use_hard_cap and entities:
                _whitelist = _LOCAL_ENTITY_TYPE_WHITELIST()
                _fallback_type = _LOCAL_ENTITY_TYPE_FALLBACK()

                primary: list = []
                fallback: list = []
                for e in entities:
                    et = getattr(e, "entity_type", None)
                    if et in _whitelist:
                        primary.append(e)
                    else:
                        # 软降级: 标 fallback + name 前缀, 计数到 _softdemote_count
                        if et != _fallback_type:
                            try:
                                setattr(e, "entity_type", _fallback_type)
                                if hasattr(e, "attributes") and e.attributes is not None:
                                    e.attributes.setdefault("__is_fallback", True)
                                    e.attributes.setdefault("original_entity_type", et)
                                else:
                                    e.attributes = {"__is_fallback": True, "original_entity_type": et}
                                cur_name = getattr(e, "name", "") or ""
                                if not cur_name.startswith("[fallback] "):
                                    e.name = "[fallback] " + cur_name
                            except Exception:
                                pass
                            self._softdemote_count += 1
                        fallback.append(e)

                # primary 桶按 signal_density 降序, 取 MAX_ENTITIES
                primary.sort(
                    key=lambda e: (
                        -float((e.attributes or {}).get("signal_density", 0.5)),
                        -(len(e.summary or "")),
                    )
                )
                primary = primary[:MAX_ENTITIES]

                # fallback 桶独立 MAX_FALLBACK_ENTITIES (10) 截断
                from .kg_prompts import MAX_FALLBACK_ENTITIES as _MAX_FALLBACK_ENTITIES
                fallback.sort(
                    key=lambda e: (
                        -float((e.attributes or {}).get("signal_density", 0.5)),
                        -(len(e.summary or "")),
                    )
                )
                fallback = fallback[:_MAX_FALLBACK_ENTITIES]

                entities = primary + fallback

            return entities

        except json.JSONDecodeError:
            return []
    
    def _parse_relation_response(
        self,
        response: str,
        entities: List[Entity],
    ) -> List[Relation]:
        """Parse LLM response into Relation objects."""
        import json
        import re

        # KG-OPT-P0-FIX [M3]: 端点匹配与 make_entity_key / Entity._norm_key 走同一套
        # 标准化（normalize_text），而不是 .lower()。这能避免标点 / 多余空白 / 大小写
        # 混合时匹配不到，从而漏掉真实的边。
        try:
            from backend.models.text_normalize import make_entity_key
        except Exception:  # KG-OPT-P0-FIX [M3]: import 失败时本地兜底
            def _normalize_key(name: str) -> str:  # type: ignore[no-redef]
                return (name or "").strip().lower()

            def make_entity_key(name: str, entity_type: str) -> str:  # type: ignore[no-redef]
                return f"{_normalize_key(name)}|{_normalize_key(entity_type)}"

        def _endpoint_key(name: str) -> str:
            # 关系端点只用 name 维度去匹配；用 make_entity_key(name, "") 复用同一标准化。
            return make_entity_key(name or "", "")

        entity_map = {_endpoint_key(e.name): e for e in entities}

        json_match = re.search(r'\[.*\]', response, re.DOTALL)
        if not json_match:
            return []

        try:
            data = json.loads(json_match.group())
            relations = []
            # KG-OPT-P0-FIX [M4]: 去重 — 丢弃 self-loop 与 (src, tgt, rel) 重复。
            seen: set = set()

            def _score_of(item: Dict[str, Any]) -> float:
                attrs = item.get("attributes") or {}
                for key in ("confidence", "score", "weight"):
                    if key in attrs:
                        try:
                            return float(attrs[key])
                        except (TypeError, ValueError):
                            return 0.5
                # 关系里没有打分时视为 0.5，与 entity 的兜底一致。
                return 0.5

            for item in data:
                if isinstance(item, dict) and "source" in item and "target" in item:
                    source_name = item.get("source")
                    target_name = item.get("target")

                    src_entity = entity_map.get(_endpoint_key(source_name))
                    tgt_entity = entity_map.get(_endpoint_key(target_name))
                    if src_entity is None or tgt_entity is None:
                        continue

                    # KG-OPT-P0-FIX [M4]: self-loop 直接丢弃。
                    if src_entity.uuid == tgt_entity.uuid:
                        continue

                    relation_type = item.get("relation_type", "RELATES_TO") or "RELATES_TO"
                    dedup_key = (src_entity.uuid, tgt_entity.uuid, relation_type)
                    if dedup_key in seen:
                        continue
                    seen.add(dedup_key)

                    rel = Relation(
                        source=src_entity.uuid,
                        target=tgt_entity.uuid,
                        relation_type=relation_type,
                        attributes=item.get("attributes", {}),
                    )
                    # KG-OPT-P0-FIX [M1]: 暂存 score 供截断排序；flag=off 时不使用。
                    rel._extractor_score = _score_of(item)  # type: ignore[attr-defined]
                    relations.append(rel)

            # KG-OPT-P0-FIX [M1]: flag=on 时按 confidence/score 降序硬截断到 MAX_RELATIONS。
            if self._use_hard_cap and len(relations) > MAX_RELATIONS:
                relations.sort(
                    key=lambda r: float(getattr(r, "_extractor_score", 0.5)),
                    reverse=True,
                )
                relations = relations[:MAX_RELATIONS]
            # 清理临时属性，避免污染对外暴露的 Relation 对象。
            for r in relations:
                if hasattr(r, "_extractor_score"):
                    delattr(r, "_extractor_score")

            return relations

        except json.JSONDecodeError:
            return []
