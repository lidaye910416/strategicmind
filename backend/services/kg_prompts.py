"""
KG-OPT-P2 [P2-1-prompt-template]: Single source of truth for KG prompt templates.

This module centralizes everything that used to live duplicated across
``entity_extractor.py`` and ``graph_builder_service.py``:

  - the 8 bottom entity-type whitelist (frozenset)
  - the fallback entity_type (str, default "Concept")
  - MAX_ENTITIES_HINT / MAX_RELATIONS_HINT (prompt-time hints, distinct
    from the per-doc caps in graph_builder_service)
  - SKIP_ROLE_PATTERNS_CN / SKIP_ROLE_PATTERNS_EN (LLM-side role-pattern
    suppression hints)
  - the canonical prompt builders for both entity and relation extraction
    (with the byte-for-byte legacy variants preserved for the
    STRATEGICMIND_USE_HARD_CAP=false rollback path)

Why a single source of truth:
  Historically both ``entity_extractor._build_entity_extraction_prompt``
  and ``graph_builder_service.ENTITY_TYPE_WHITELIST`` (and the legacy
  prompt) lived next to their consumers. P1-FIX F3 already documented
  the dual-source drift risk: changing one without the other causes the
  extractor and the builder to disagree on which entity_types are
  "valid", which surfaces as silent drops or surprise soft-demote
  events. This module eliminates that by being the *only* place these
  constants and prompt templates are defined; the two consumer modules
  import from here.

Environment overrides (hot path, read on every call):
  - ``STRATEGICMIND_KG_TYPE_TAXONOMY`` (CSV): replaces the default
    whitelist. Useful for domain-specific corpora (legal, medical) where
    the 8 bottom types don't fit.
  - ``STRATEGICMIND_KG_FALLBACK_TYPE`` (str): replaces the default
    fallback type ("Concept"). Same rationale.

Both reads are wrapped in ``get_whitelist()`` / ``get_fallback_type()``
so consumers can re-resolve per call (the prompt builders also do this,
so runtime env changes take effect without re-import).
"""

from __future__ import annotations

import os
from typing import Any, Dict, FrozenSet, List, Optional, Tuple


# ---------------------------------------------------------------------------
# Module-level constants (KG-OPT-P2 [P2-1-prompt-template])
# ---------------------------------------------------------------------------

# KG-OPT-P2 [P2-1-prompt-template]: 默认 entity_type 白名单。
# 与 ws4gdxlm1 实施时定下的 8 个 bottom 类型保持一致（Person / Organization /
# Location / Event / Concept / Product / Policy / Coalition）。
# 使用 frozenset 保证不可变 + O(1) 成员判断。
DEFAULT_ENTITY_TYPE_WHITELIST: FrozenSet[str] = frozenset({
    "Person",
    "Organization",
    "Location",
    "Event",
    "Concept",
    "Product",
    "Policy",
    "Coalition",
})

# KG-OPT-P2 [P2-1-prompt-template]: 软降级目标 entity_type。LLM 返回白名单外
# 的 type 时（例如 "Unknown" / "Other" / 新长尾类型），不直接丢弃，
# 而是降级为 ENTITY_TYPE_FALLBACK，并把原始 type 记到
# attributes["original_entity_type"]。可被环境变量覆盖。
DEFAULT_ENTITY_TYPE_FALLBACK: str = "Concept"

# KG-OPT-P2 [P2-1-prompt-template]: Prompt 中提示 LLM 抽取的硬上限。
# 这是 prompt 内的 hint（"Return AT MOST N entities/relations"），
# 不是真正的截断 —— 真正的截断由 entity_extractor._parse_entity_response
# 和 graph_builder_service.build() 实施。
# 历史值：25 entities / 40 relations（与 P0 [entity-cap-hardening] 一致）。
MAX_ENTITIES_HINT: int = 25
MAX_RELATIONS_HINT: int = 40

# Agent 3A v2 N-fix: 软降级桶（fallback entities）的独立截断上限。
# 与 MAX_ENTITIES_HINT 不同, fallback 桶保留 whitelist 之外被软降级
# 的 entity 名称/类型线索; 太多 fallback 会污染下游命名空间, 默认 10.
MAX_FALLBACK_ENTITIES: int = 10

# KG-OPT-P2 [P2-1-prompt-template]: 角色/泛型跳过提示，仅用于 prompt 注入。
# 中文只保留多字精确后缀（避免 "一般" / "常见" 这种高频 bigram 误伤正常实体）。
# 英文只保留与中文一一对应的精确后缀，删除 "directors" 等噪声大的项。
SKIP_ROLE_PATTERNS_CN: Tuple[str, ...] = (
    "员",
    "部门",
    "人员",
    "负责人",
    "工作组",
    "办公室",
    "委员会",
)
SKIP_ROLE_PATTERNS_EN: Tuple[str, ...] = (
    "department",
    "staff",
    "office",
    "committee",
    "team",
    "group",
)

# KG-OPT-P2 [P2-1-prompt-template]: 兼容旧名字 SKIP_ROLE_PATTERNS。
# 内容为 CN 精确后缀（与 P0-FIX [M6] 对齐）。
SKIP_ROLE_PATTERNS: Tuple[str, ...] = SKIP_ROLE_PATTERNS_CN

# KG-OPT-P2 [P2-1-prompt-template]: 默认 8 个 bottom 类型的有序列表。
# 与 DEFAULT_ENTITY_TYPE_WHITELIST 同步更新；如果 ontology 未指定
# entity_types,prompt 注入使用此列表（顺序稳定便于 LLM 解析）。
DEFAULT_BOTTOM_TYPES: Tuple[str, ...] = (
    "Person",
    "Organization",
    "Location",
    "Event",
    "Concept",
    "Product",
    "Policy",
    "Coalition",
)

# KG-OPT-P2 [P2-1-prompt-template]: 环境变量名集中管理。
ENV_TAXONOMY = "STRATEGICMIND_KG_TYPE_TAXONOMY"
ENV_FALLBACK_TYPE = "STRATEGICMIND_KG_FALLBACK_TYPE"


# ---------------------------------------------------------------------------
# Hot-path resolvers (read env every call)
# ---------------------------------------------------------------------------

def _parse_taxonomy_csv(raw: str) -> FrozenSet[str]:
    """解析 CSV 字符串为 frozenset。空字符串 / 空白项会被忽略。

    KG-OPT-P2 [P2-1-prompt-template]: 用于 get_whitelist() 解析
    STRATEGICMIND_KG_TYPE_TAXONOMY 的覆盖值。
    """
    if not raw:
        return DEFAULT_ENTITY_TYPE_WHITELIST
    items = []
    for piece in raw.split(","):
        piece = piece.strip()
        if piece:
            items.append(piece)
    if not items:
        return DEFAULT_ENTITY_TYPE_WHITELIST
    return frozenset(items)


def get_whitelist() -> FrozenSet[str]:
    """返回当前生效的 entity_type 白名单（frozenset）。

    KG-OPT-P2 [P2-1-prompt-template]: 热路径读 env，每次调用都重新解析，
    使得运行时修改 STRATEGICMIND_KG_TYPE_TAXONOMY 立即生效（无需重启）。
    未设置 / 解析为空时回退到 DEFAULT_ENTITY_TYPE_WHITELIST。
    """
    return _parse_taxonomy_csv(os.environ.get(ENV_TAXONOMY, ""))


def get_fallback_type() -> str:
    """返回当前生效的 fallback entity_type（str）。

    KG-OPT-P2 [P2-1-prompt-template]: 热路径读 env，每次调用都重新解析。
    未设置 / 解析为空时回退到 DEFAULT_ENTITY_TYPE_FALLBACK。
    """
    raw = os.environ.get(ENV_FALLBACK_TYPE, "")
    raw = raw.strip() if raw else ""
    return raw or DEFAULT_ENTITY_TYPE_FALLBACK


# ---------------------------------------------------------------------------
# Prompt builders
# ---------------------------------------------------------------------------

def build_entity_extraction_prompt(
    text: str,
    ontology: Optional[Dict[str, Any]] = None,
    use_hard_cap: bool = True,
) -> str:
    """Build the canonical entity extraction prompt.

    KG-OPT-P2 [P2-1-prompt-template]: 当 ``use_hard_cap=True`` 时返回带
    hard-cap + 严格 enum + signal_density + 跳过角色类指令的新 prompt;
    当 ``use_hard_cap=False`` 时回退到 ``build_legacy_entity_extraction_prompt``
    的字节内容（与改前一致）。

    Args:
        text: 输入文本
        ontology: 可选 ontology schema（dict with ``entity_types`` 列表）
        use_hard_cap: 与 STRATEGICMIND_USE_HARD_CAP feature flag 对齐

    Returns:
        完整 prompt 字符串
    """
    if not use_hard_cap:
        return build_legacy_entity_extraction_prompt(text, ontology)

    # 1) 决定可用 entity_type 列表：ontology 优先；否则使用当前 8 个 bottom 类型。
    if ontology and ontology.get("entity_types"):
        allowed_types = [et.get("name", et) for et in ontology["entity_types"]]
    else:
        allowed_types = list(DEFAULT_BOTTOM_TYPES)

    type_lines = "\n".join(f"- {t}" for t in allowed_types)

    # 2) 角色/泛型跳过指令（双语：中英都告诉 LLM，跨语料更稳）。
    skip_lines_zh = "、".join(SKIP_ROLE_PATTERNS_CN)
    skip_lines_en = ", ".join(SKIP_ROLE_PATTERNS_EN)

    # 3) ontology 描述（仅当用户提供时附带）。
    ontology_block = ""
    if ontology:
        entity_types = ontology.get("entity_types", [])
        if entity_types:
            ontology_block = "\nOntology hints (use only the types listed above; ignore any others):\n"
            for et in entity_types:
                ontology_block += f"- {et.get('name', et)}: {et.get('description', '')}\n"

    prompt = f"""Extract entities from the following text.

HARD CAP: Return AT MOST {MAX_ENTITIES_HINT} entities. Prefer high-signal,
named, and uniquely identifiable entities. Do not pad with generic roles.

entity_type MUST be one of the following STRICT values (no "etc.", no
free-form extensions, no lowercase variants — pick the closest one and
stay in this enum):
{type_lines}

Skip these generic-role / role-pattern entities (do NOT extract them as
nodes even if mentioned):
  ZH: {skip_lines_zh}
  EN: {skip_lines_en}

Return entities as a JSON list with fields:
- name: entity name
- entity_type: one of the values listed above
- summary: brief description (one short sentence)
- signal_density: float in [0.0, 1.0] — how informative / load-bearing
  this entity is in the text. 1.0 = central actor / named institution;
  0.0 = passing mention / decorative. Be honest; do not inflate.

Text:
{text}
{ontology_block}
Output as JSON list:
[
  {{"name": "...", "entity_type": "...", "summary": "...", "signal_density": 0.0}},
  ...
]

Only include entities that are clearly mentioned in the text.
Do not exceed {MAX_ENTITIES_HINT} entries.
"""
    return prompt


def build_legacy_entity_extraction_prompt(
    text: str,
    ontology: Optional[Dict[str, Any]] = None,
) -> str:
    """旧版 entity prompt（feature flag 关闭时回退到这里的字节内容）。

    KG-OPT-P2 [P2-1-prompt-template]: 字节级保留 P0 改前的 prompt 内容，
    便于回滚 / 缓存命中。修改此函数会破坏 STRATEGICMIND_USE_HARD_CAP=false
    的旧路径，禁止无审慎地改 prompt 文本。
    """
    prompt = f"""Extract all entities from the following text.

Return entities as a JSON list with fields:
- name: entity name
- entity_type: type (Person, Organization, Location, Event, Concept, etc.)
- summary: brief description

Text:
{text}

"""

    if ontology:
        entity_types = ontology.get("entity_types", [])
        if entity_types:
            prompt += f"\nUse these entity types if applicable:\n"
            for et in entity_types:
                prompt += f"- {et.get('name', et)}: {et.get('description', '')}\n"

    prompt += """
Output as JSON list:
[{"name": "...", "entity_type": "...", "summary": "..."}, ...]

Only include entities that are clearly mentioned in the text."""

    return prompt


def build_relation_extraction_prompt(
    text: str,
    entities: List[Any],
    use_hard_cap: bool = True,
) -> str:
    """Build the canonical relation extraction prompt.

    KG-OPT-P2 [P2-1-prompt-template]: 当 ``use_hard_cap=True`` 时返回带
    hard-cap + source/target 必须来自 entities 列表 + 仅高信噪比边的新 prompt;
    当 ``use_hard_cap=False`` 时回退到 ``build_legacy_relation_extraction_prompt``
    的字节内容。

    Args:
        text: 输入文本
        entities: 已抽取的 Entity 对象列表（每个需有 .name 和 .entity_type）
        use_hard_cap: 与 STRATEGICMIND_USE_HARD_CAP feature flag 对齐

    Returns:
        完整 prompt 字符串
    """
    if not use_hard_cap:
        return build_legacy_relation_extraction_prompt(text, entities)

    entity_list = "\n".join([
        f"- {e.name} ({e.entity_type})" for e in entities
    ])

    prompt = f"""Extract relationships between the following entities from the text.

HARD CAP: Return AT MOST {MAX_RELATIONS_HINT} relations.

HARD RULE — endpoint selection:
  source and target MUST be selected verbatim from the entity list below.
  Never invent a node that was not in the entities pass. If both endpoints
  are not present in the list, drop the edge.

HARD RULE — high signal-to-noise only:
  - Include only direct, evidenced relations.
  - Exclude co-mention only (two entities appearing in the same sentence
    is not a relation).
  - Exclude inferred / weak ties that the text does not actually assert.
  - Exclude self-loops (source == target).
  - Exclude duplicate edges within the same response (one edge per
    unordered pair per relation_type).

Entities:
{entity_list}

Text:
{text}
Output as JSON list:
[
  {{"source": "entity1_name", "target": "entity2_name", "relation_type": "RELATES_TO", "attributes": {{}}}},
  ...
]

Only include relationships explicitly mentioned or clearly implied in the text.
Do not exceed {MAX_RELATIONS_HINT} entries.
"""
    return prompt


def build_legacy_relation_extraction_prompt(
    text: str,
    entities: List[Any],
    ontology: Optional[Dict[str, Any]] = None,
) -> str:
    """旧版 relation prompt（feature flag 关闭时回退到这里的字节内容）。

    KG-OPT-P2 [P2-1-prompt-template]: 字节级保留 P0 改前的 prompt 内容。
    修改此函数会破坏 STRATEGICMIND_USE_HARD_CAP=false 的旧路径。
    """
    entity_list = "\n".join([
        f"- {e.name} ({e.entity_type})" for e in entities
    ])

    prompt = f"""Extract relationships between the following entities from the text.

Entities:
{entity_list}

Text:
{text}

"""

    if ontology:
        relation_types = ontology.get("edge_types", [])
        if relation_types:
            prompt += f"\nUse these relation types if applicable:\n"
            for rt in relation_types:
                prompt += f"- {rt.get('name', rt)}: {rt.get('description', '')}\n"

    prompt += """
Output as JSON list:
[{"source": "entity1_name", "target": "entity2_name", "relation_type": "RELATES_TO", "attributes": {}}, ...]

Only include relationships explicitly mentioned or clearly implied in the text."""

    return prompt


# ---------------------------------------------------------------------------
# Runtime self-check
# ---------------------------------------------------------------------------

# KG-OPT-P2 [P2-1-prompt-template]: 启动时验证默认白名单至少包含
# 8 个基础类型,防止意外的常量退化（如有人误删了某一行）。
# 注意：这里只验证 *默认* 白名单 —— 运行时通过 STRATEGICMIND_KG_TYPE_TAXONOMY
# 覆盖到 domain-specific 白名单是合法用法，不在此 assert 范围。
_default_whitelist = get_whitelist()
assert (
    len(_default_whitelist) >= 8
), (
    f"KG-OPT-P2 [P2-1-prompt-template]: 默认 entity_type 白名单"
    f" 应至少包含 8 个基础类型，实际有 {len(_default_whitelist)} 个："
    f" {sorted(_default_whitelist)}"
)


# ---------------------------------------------------------------------------
# Self-test (KG-OPT-P2 [P2-5-taxonomy-extensible])
# ---------------------------------------------------------------------------

# KG-OPT-P2 [P2-5-taxonomy-extensible]: _self_test 仅供 debug 入口,
# 由 pytest 单测 (test_kg_prompts_taxonomy.py) 显式调用, 不会在 import 时
# 自动运行。下面覆盖三条不变量路径:
#   1) 默认 8 元组白名单 — 不设 env 时 get_whitelist() 等于 8 元组;
#   2) CSV 自定义 — STRATEGICMIND_KG_TYPE_TAXONOMY="Foo,Bar,Baz" 时
#      get_whitelist() 返回 frozenset({"Foo","Bar","Baz"});
#   3) Fallback 覆盖 — STRATEGICMIND_KG_FALLBACK_TYPE="Misc" 时
#      get_fallback_type() 返回 "Misc"。
# 任何失败直接抛 AssertionError。
def _self_test() -> None:
    """KG-OPT-P2 [P2-5-taxonomy-extensible]: taxonomy 自测烟雾测试。

    注释说明: 该函数绝不在 import 时自动运行 — 调用方必须显式 ``_self_test()``。
    临时修改 ``os.environ`` 会在 try/finally 中恢复, 不会污染测试外的环境。
    """
    # 路径 1: 默认 8 元组白名单
    assert get_whitelist() == DEFAULT_ENTITY_TYPE_WHITELIST, (
        f"default whitelist mismatch: {get_whitelist()}"
    )
    assert len(get_whitelist()) == 8, (
        f"default whitelist size != 8: {len(get_whitelist())}"
    )

    # 路径 2: CSV 自定义白名单
    saved_taxonomy = os.environ.get(ENV_TAXONOMY)
    try:
        os.environ[ENV_TAXONOMY] = "Foo,Bar,Baz"
        assert get_whitelist() == frozenset({"Foo", "Bar", "Baz"}), (
            f"custom whitelist mismatch: {get_whitelist()}"
        )
    finally:
        if saved_taxonomy is None:
            os.environ.pop(ENV_TAXONOMY, None)
        else:
            os.environ[ENV_TAXONOMY] = saved_taxonomy

    # 路径 3: Fallback 覆盖
    saved_fallback = os.environ.get(ENV_FALLBACK_TYPE)
    try:
        os.environ[ENV_FALLBACK_TYPE] = "Misc"
        assert get_fallback_type() == "Misc", (
            f"custom fallback mismatch: {get_fallback_type()}"
        )
    finally:
        if saved_fallback is None:
            os.environ.pop(ENV_FALLBACK_TYPE, None)
        else:
            os.environ[ENV_FALLBACK_TYPE] = saved_fallback


__all__ = [
    "DEFAULT_ENTITY_TYPE_WHITELIST",
    "DEFAULT_ENTITY_TYPE_FALLBACK",
    "DEFAULT_BOTTOM_TYPES",
    "MAX_ENTITIES_HINT",
    "MAX_RELATIONS_HINT",
    "SKIP_ROLE_PATTERNS_CN",
    "SKIP_ROLE_PATTERNS_EN",
    "SKIP_ROLE_PATTERNS",
    "ENV_TAXONOMY",
    "ENV_FALLBACK_TYPE",
    "get_whitelist",
    "get_fallback_type",
    "build_entity_extraction_prompt",
    "build_legacy_entity_extraction_prompt",
    "build_relation_extraction_prompt",
    "build_legacy_relation_extraction_prompt",
    "_self_test",
]
