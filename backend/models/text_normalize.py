"""
Shared text-normalization helpers for entity / relation dedup keys.

Used by `models.Entity.from_name` and `services.LocalKnowledgeStore` so the
"stable lookup key" produced at model-creation time matches the one used by
the persistence layer at insert time. Living in `models/` avoids a model →
service back-reference (which would form a cycle).

Design intent: mirror Zep's server-side name merging (which uses embeddings
+ canonical forms) at the lexical level. This is intentionally aggressive
— "Apple", " apple ", "Apple, Inc.", "Apple Inc" all normalize to "apple".
See ws4gdxlm1 risk #2: the merge audit trail belongs in
`entity.metadata._original_names` for callers that need provenance.
"""

import re


_PUNCT_RE = re.compile(r"[\.\,\;\:\!\?\-\'\"\(\)\[\]\{\}\/\\]+")
_WS_RE = re.compile(r"\s+")
_CORP_SUFFIX_RE = re.compile(
    r"\s+(inc|incorporated|corp|corporation|ltd|limited|llc|plc|gmbh|co|company)\.?$",
    re.IGNORECASE,
)


def normalize_text(s: str) -> str:
    """Lower + trim + collapse whitespace + drop punctuation + strip common
    corporate suffixes. Returns a stable lookup-key fragment."""
    if not isinstance(s, str):
        return ""
    out = s.strip().lower()
    out = _PUNCT_RE.sub(" ", out)
    out = _WS_RE.sub(" ", out).strip()
    # Iterate — stripping one suffix may expose another.
    while True:
        new = _CORP_SUFFIX_RE.sub("", out).strip()
        if new == out:
            break
        out = new
    return out


def make_entity_key(name: str, entity_type: str) -> str:
    """Build the dedup key used by LocalKnowledgeStore._entity_index."""
    return f"{normalize_text(name)}|{normalize_text(entity_type)}"


def make_relation_key(source_id: str, target_id: str, relation_type: str) -> str:
    """Build the dedup key used by LocalKnowledgeStore._relation_index.

    source_id / target_id are uuids (already canonical), so only the
    relation_type is normalized."""
    src = (source_id or "").strip()
    tgt = (target_id or "").strip()
    rt = normalize_text(relation_type or "")
    return f"{src}|{tgt}|{rt}"
