"""
GraphBuilderService - Build knowledge graph from SeedDocuments

Uses IKnowledgeStore (injected) for graph operations.
Implements: US-022 (uses US-021 LocalKnowledgeStore)
"""

from typing import Dict, List, Any, Optional, Callable
import asyncio
import logging as _logging  # KG-OPT-P1-FIX F2: 软降级审计日志
import os as _os
import re as _re  # KG-OPT-P0 [_signal_score]: 用于 _signal_score 中 summary 实词数统计

from ..interfaces.knowledge_store import IKnowledgeStore
from ..interfaces.llm_provider import ILLMProvider
from ..models.seed_document import SeedDocument
from ..config.manager import parse_bool
from .entity_extractor import EntityExtractor

# KG-OPT-P1-FIX F2: 模块级 logger,供软降级事件审计。
_logger = _logging.getLogger(__name__)


def _use_hard_cap() -> bool:
    """KG-OPT-P0-FIX [M7]: STRATEGICMIND_USE_HARD_CAP 控制是否启用硬上限路径。
    默认 true（按 p0 规范），通过环境变量 STRATEGICMIND_USE_HARD_CAP=false 可回退旧路径。
    使用 backend.config.manager.parse_bool 进行标准化布尔解析,支持 1/0/yes/no/on/off 等常见形式。"""
    return parse_bool(_os.environ.get("STRATEGICMIND_USE_HARD_CAP"), default=True)


# Step 10 (ws4gdxlm1) — per-doc entity cap. the prior art doesn't need this
# because Zep's server-side merge collapses similar entities post-extract;
# our local extractor produces N from each LLM call with no upper bound,
# and ws4gdxlm1 numeric evidence showed one doc producing 1014 entity files
# (29% of total). Capping at 50 mirrors the "high-signal action types only"
# filter the prior art applies in its action_descriptions table.
# KG-OPT-P0-FIX [C2]: 将 import 期绑定移到 build() 热路径,确保 flag=off 时默认 cap=50。
# 模块顶部保留一个 default 绑定供外部参考,但运行时一律调用 _get_max_entities_per_doc() / _get_max_relations_per_doc()
# 以响应 runtime env 变化。


def _get_max_entities_per_doc() -> int:
    """KG-OPT-P0-FIX [C2]: 热路径解析 per-doc entity 上限。
    flag=true → env override 或默认 25;flag=false → env override 或默认 50。
    """
    if _use_hard_cap():
        return int(_os.environ.get("STRATEGICMIND_MAX_ENTITIES_PER_DOC", "25"))
    return int(_os.environ.get("STRATEGICMIND_MAX_ENTITIES_PER_DOC", "50"))


def _get_max_relations_per_doc() -> Optional[int]:
    """KG-OPT-P0-FIX [C2]: 热路径解析 per-doc relation 上限。
    flag=true → env override 或默认 40;flag=false → env override 或默认 None(不截断)。
    """
    if _use_hard_cap():
        return int(_os.environ.get("STRATEGICMIND_MAX_RELATIONS_PER_DOC", "40"))
    raw = _os.environ.get("STRATEGICMIND_MAX_RELATIONS_PER_DOC")
    if raw is None:
        return None
    return int(raw)


# 模块顶部 default 绑定(供外部参考);build() 内部会重新调用以拿到 runtime 最新值。
MAX_ENTITIES_PER_DOC = _get_max_entities_per_doc()
MAX_RELATIONS_PER_DOC = _get_max_relations_per_doc()

# KG-OPT-P0 [_signal_score]: 实体类型白名单。frozenset 保证 O(1) 查询与不可变。
# 这 8 个类型对应 prompt 中提示 LLM 重点抽取的"高信号动作类型"——其余类型
# (如 "Unknown" 默认值) 在 STRATEGICMIND_USE_HARD_CAP=true 路径下被静默丢弃。
ENTITY_TYPE_WHITELIST = frozenset({
    "Person",
    "Organization",
    "Location",
    "Event",
    "Concept",
    "Product",
    "Policy",
    "Coalition",
})

# KG-OPT-P1 [B3]: 模块级"软降级"目标 entity_type。
# 当 LLM 返回白名单外的 type 时(常见为 "Unknown"/"Other"/新长尾类型),
# 不再硬丢弃,而是把 entity_type 降级为 _ENTITY_TYPE_FALLBACK 并把原始 type
# 记到 attributes["original_entity_type"],便于后续审计与回追。
# 可通过环境变量 STRATEGICMIND_KG_FALLBACK_TYPE 覆盖,默认 "Concept"。
_ENTITY_TYPE_FALLBACK = _os.environ.get("STRATEGICMIND_KG_FALLBACK_TYPE", "Concept")

# KG-OPT-P0-FIX [M8]: 用于惩罚人称/部门类低信号实体的关键字。
# 已移除单字 "处" —— 之前是子串检查,"处" 会误伤词内含 "处" 的实体(如 "处理"/"处长"/"处在")。
# 仅保留更精确的多字关键词,使用 tuple 保持不可变,实际匹配时由 _signal_score
# 转小写后做子串检查。"处" 类单字改为 word-boundary suffix 检查,详见 _signal_score。
_SIGNAL_PENALTY_KEYWORDS = (
    "department",
    "bureau",
    "office of",
    "committee on",
    "部门",
    "工作组",
    "办公室",
    "委员会",
    "人员",
    "负责人",
)

# KG-OPT-P0-FIX [M8]: 单字 suffix 惩罚列表。仅当 entity name/summary 以这些单字结尾
# 才算 penalty (word-boundary 语义,避免误伤 "处理"/"处长" 等含 "处" 字的多字词)。
_SIGNAL_PENALTY_SUFFIXES = (
    "处",
)


def _signal_score(e: Any) -> float:
    """KG-OPT-P0-FIX [M8]: 计算实体的"信号密度"分数,取代旧的 -len(summary) 排序键。

    KG-OPT-P1 [B1]: 排序键优先使用 entity_extractor 写入的
    ``attributes["signal_density"]``(若它是 0-1 范围内的 float);
    否则回退到 tokens - 2 * penalty 公式。这样 LLM 端产出的
    0-1 归一化 signal_density 会被 graph_builder 排序时利用,
    而不需要在 build 阶段重新估算。

    公式(回退分支): tokens = summary 实词数(最小为 1);
          penalty = 命中 _SIGNAL_PENALTY_KEYWORDS 的关键字数(子串检查,小写)
                  + 命中 _SIGNAL_PENALTY_SUFFIXES 的后缀单字数(以 suffix 结尾,小写);
          return  = tokens - 2 * penalty

    高分实体优先保留;平局时由调用方按 name 长度进一步排序。
    对缺少 summary 属性的对象安全——使用 getattr 默认 ""。
    """
    # KG-OPT-P1 [B1]: 优先读取 attributes["signal_density"],要求是 float 且 [0,1]。
    attrs = getattr(e, "attributes", None)
    if isinstance(attrs, dict):
        sd = attrs.get("signal_density")
        if isinstance(sd, (int, float)) and not isinstance(sd, bool):
            sd_f = float(sd)
            if 0.0 <= sd_f <= 1.0:
                return sd_f
    name = (getattr(e, "name", "") or "").lower()
    summary = (getattr(e, "summary", "") or "").lower()
    tokens = max(1, len(_re.findall(r"\w+", getattr(e, "summary", "") or "")))
    penalty = sum(
        1 for kw in _SIGNAL_PENALTY_KEYWORDS if kw in name or kw in summary
    )
    penalty += sum(
        1 for suf in _SIGNAL_PENALTY_SUFFIXES if name.endswith(suf) or summary.endswith(suf)
    )
    return tokens - 2 * penalty


class GraphBuilderService:
    """
    Builds knowledge graph from seed documents.

    Workflow:
        1. Parse documents (SeedDocumentParser)
        2. Extract entities and relations (EntityExtractor)
        3. Store in knowledge graph (IKnowledgeStore)
        4. Build relationships
    """

    def __init__(
        self,
        entity_extractor: EntityExtractor,
        knowledge_store: IKnowledgeStore,
        config: Optional[Dict[str, Any]] = None,
    ):
        self.entity_extractor = entity_extractor
        self.knowledge_store = knowledge_store
        self.config = config or {}
        # KG-OPT-P1-FIX F2: 软降级事件计数器。benchmark 可通过 get_softdemote_count() 读取。
        self._softdemote_count = 0
        # Wire the extractor's back-reference so `Entity.from_name` inside
        # `_parse_entity_response` can hit the store's `_entity_index` and
        # reuse existing uuids on a normalized (name, type) match. This
        # closes the three-layer dedup loop when GraphBuilderService is
        # constructed with an extractor that wasn't built by the store.
        # No-op if the extractor was already wired (LocalKnowledgeStore
        # case) — reassigning to the same reference is safe.
        try:
            self.entity_extractor.knowledge_store = self.knowledge_store
        except AttributeError:
            # Test stubs may not allow attribute assignment — fine,
            # the store-layer dedup still catches duplicates.
            pass

    def get_softdemote_count(self) -> int:
        """KG-OPT-P1-FIX F2: 返回自构造以来发生的软降级事件数,供 benchmark 读取。"""
        return self._softdemote_count

    async def build(
        self,
        seed_documents: List[SeedDocument],
        ontology: Optional[Dict[str, Any]] = None,
        progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """
        Build graph from seed documents.

        Args:
            seed_documents: List of parsed documents
            ontology: Optional ontology schema
            progress_callback: Optional callback invoked with
                ``{"type": "entity_emerged", "entity": {...}, "doc_id": "..."}``
                for each newly-stored entity (used to drive SSE ``entity_emerged``
                events for the real-time EntityDanmaku component).

        Returns:
            Build statistics
        """
        all_entities = []
        all_relations = []

        for doc in seed_documents:
            content = doc.content

            # Extract entities
            entities = await self.entity_extractor.extract_entities(content, ontology)

            # Step 10 (ws4gdxlm1) — per-doc cap.
            # Rank by signal density (longer summary + longer name = more
            # context per entity) then truncate to max_entities_per_doc.
            # This mirrors the prior-art's DO_NOTHING skip behaviour at the
            # extractor level — keep the high-signal entities, drop the
            # filler. Without this cap a single dense doc (e.g.
            # hubei_plan_seed.txt) can flood the graph with hundreds of
            # marginal entities and crowd out subsequent docs.
            # KG-OPT-P0-FIX [C2]: 在 build() 热路径重新解析 cap,响应 runtime env 变化。
            max_entities_per_doc = _get_max_entities_per_doc()
            if _use_hard_cap():
                # KG-OPT-P0 [_signal_score]: 新行为(硬上限路径)——白名单过滤 + 信号密度排序 + 截断。
                # 1) 丢弃 entity_type 不在白名单的实体(常见为 "Unknown" 默认值);
                # 2) 按 _signal_score 降序、name 长度降序排序;
                # 3) 截断到 max_entities_per_doc(默认 25,与 prompt 对齐)。
                # KG-OPT-P1 [B2]: 把"硬丢弃"改成"软降级"——entity_type 不在白名单时,
                # 不直接丢弃,而是:attributes["original_entity_type"] = 原 type;
                # e.entity_type = _ENTITY_TYPE_FALLBACK(默认 "Concept")。这样 LLM
                # 偶尔返回的合理新类型(如 "Technology"/"Initiative")不会再被静默丢弃,
                # 也不会污染白名单下游,而是降级到 fallback 桶里且保留回追线索。
                # 该软降级逻辑只在 flag=on 启用;flag=off 保留旧的全量保留路径。
                _fallback = _ENTITY_TYPE_FALLBACK
                for e in entities:
                    et = getattr(e, "entity_type", None)
                    if et is None or et not in ENTITY_TYPE_WHITELIST:
                        # KG-OPT-P1-FIX F2: 软降级桶通过 __is_fallback + name prefix 隔离命名空间。
                        # 保留 entity_type = "Concept" 不变(下游契约稳定),
                        # 但同时设置 attributes["__is_fallback"]=True 与 original_entity_type,
                        # 并把 entity.name 加前缀 "[fallback] "——这样下游 _norm_key(name) 自动
                        # 有 namespace 隔离,不会与真正的 Concept 节点碰撞。仅在 attributes 没有
                        # __is_fallback 时才加 name 前缀,避免重复处理。
                        attrs = getattr(e, "attributes", None)
                        if not isinstance(attrs, dict):
                            # KG-OPT-P1 [B2]: 兼容 attributes 缺失/非 dict 的情况——
                            # 安全起见用空 dict 替换,Entity 应有 dict attributes,
                            # 但外部测试 stub 可能给 None,所以兜底。
                            try:
                                e.attributes = {}
                            except Exception:
                                pass
                            attrs = getattr(e, "attributes", {}) or {}
                        # 仅当原始 type 与 fallback 不同时记录 original,避免污染。
                        if et is not None and et != _fallback:
                            attrs["original_entity_type"] = et
                        # KG-OPT-P1-FIX F2: 标记软降级桶,供下游 namespace 隔离用。
                        is_already_fallback = bool(attrs.get("__is_fallback"))
                        attrs["__is_fallback"] = True
                        try:
                            e.entity_type = _fallback
                        except Exception:
                            # 对象可能是 frozen/不可写,跳过——这是软降级,
                            # 比硬丢弃弱,失败时只损失一个实体的类型,保留其内容。
                            pass
                        # KG-OPT-P1-FIX F2: name 加前缀确保 _norm_key 命名空间隔离。
                        # 重复处理时(罕见)不再二次加前缀,避免 "[fallback] [fallback] X"。
                        if not is_already_fallback:
                            try:
                                cur_name = getattr(e, "name", "") or ""
                                if not cur_name.startswith("[fallback] "):
                                    e.name = "[fallback] " + cur_name
                            except Exception:
                                # frozen/不可写,跳过 name prefix。
                                pass
                        # KG-OPT-P1-FIX F2: 计数 + 审计日志,便于 benchmark 与排查。
                        self._softdemote_count += 1
                        try:
                            _logger.warning(
                                "KG soft-demote: original_type=%r name=%r -> fallback=%r",
                                et,
                                getattr(e, "name", None),
                                _fallback,
                            )
                        except Exception:
                            # logger 配置不可用时静默——主流程优先。
                            pass
                if len(entities) > max_entities_per_doc:
                    entities.sort(
                        key=lambda e: (
                            -_signal_score(e),
                            -len(getattr(e, "name", "") or ""),
                        ),
                    )
                    entities = entities[:max_entities_per_doc]
            else:
                # KG-OPT-P0 [_signal_score]: 旧行为——按 summary 长度排序后截断,保持
                # 与 ws4gdxlm1 行为完全一致。flag=false 时走此分支,默认 cap=50。
                if len(entities) > max_entities_per_doc:
                    entities.sort(
                        key=lambda e: (
                            -len(getattr(e, "summary", "") or ""),
                            -len(getattr(e, "name", "") or ""),
                        ),
                    )
                    entities = entities[:max_entities_per_doc]

            # Extract relations
            relations = await self.entity_extractor.extract_relations(
                content, entities, ontology
            )

            # KG-OPT-P0 [_signal_score]: 硬上限路径下额外对 relations 做截断。
            # relations 没有 summary 字段,无法复用 _signal_score,直接切片即可。
            # KG-OPT-P0-FIX [C2]: 在热路径重新解析 relations cap,flag=off 时返回 None 即不截断。
            max_relations_per_doc = _get_max_relations_per_doc()
            if max_relations_per_doc is not None and len(relations) > max_relations_per_doc:
                relations = relations[:max_relations_per_doc]

            # Store entities
            for entity in entities:
                entity_id = await self.knowledge_store.insert_entity(
                    entity.to_dict(),
                    metadata={"source_doc": doc.doc_id, "doc_type": doc.doc_type.value}
                )
                entity.uuid = entity_id
                all_entities.append(entity)
                # should-tier: per-entity callback for live SSE emit
                if progress_callback is not None:
                    try:
                        ent_dict = entity.to_dict() if hasattr(entity, "to_dict") else {
                            "id": getattr(entity, "uuid", None),
                            "name": getattr(entity, "name", None),
                            "type": getattr(entity, "entity_type", None),
                        }
                        progress_callback({
                            "type": "entity_emerged",
                            "entity": {
                                "id": entity_id or ent_dict.get("id"),
                                "name": ent_dict.get("name"),
                                "label": ent_dict.get("name") or ent_dict.get("label"),
                                "type": ent_dict.get("type") or ent_dict.get("entity_type"),
                                "source_doc": doc.doc_id,
                            },
                            "doc_id": doc.doc_id,
                        })
                    except Exception:
                        # Callback failure must not break build pipeline
                        pass

            # Store relations
            for relation in relations:
                await self.knowledge_store.insert_relation({
                    "source_id": relation.source,
                    "target_id": relation.target,
                    "relation_type": relation.relation_type,
                    "attributes": relation.attributes,
                })
                all_relations.append(relation)

        return {
            "documents_processed": len(seed_documents),
            "entities_created": len(all_entities),
            "relations_created": len(all_relations),
        }
    
    async def search_context(
        self,
        query: str,
        top_k: int = 10,
    ) -> List[Dict[str, Any]]:
        """Search the built graph for context"""
        return await self.knowledge_store.search(query, top_k=top_k)
