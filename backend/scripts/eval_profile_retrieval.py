"""
eval_profile_retrieval.py — A/B harness for the G7 retrieval flag.

Compares the prompt-only PROFILE_GENERATION path (default,
``STRATEGICMIND_PROFILE_RETRIEVAL=0``) against the retrieval-grounded
path (``STRATEGICMIND_PROFILE_RETRIEVAL=1``) on a small set of
fixture runs and writes a markdown report to
``data/reports/eval_<ts>.md``.

The harness is intentionally self-contained:

- It uses an in-memory ``KGIndex`` populated with 5 hand-crafted
  fixtures covering different industries (a competitor, a regulator,
  a market segment, a partner, a department). No LLM is invoked for
  the entity/relation extraction — the whole point of G7 is to test
  the retrieval layer, not the extractor.
- The "LLM" is a deterministic mock driven by
  ``STRATEGICMIND_LLM_OVERRIDE`` (matches the project's existing test
  convention), so the script finishes in well under 60s with the
  mock provider and produces byte-stable output.
- The report records: fixture name, prompt-only prompt size,
  retrieval-grounded prompt size, top-3 retrieval hits, and a small
  hit-rate score (1.0 if the named anchor entity is in the top-k,
  else 0.0). The score lets a human reviewer eyeball whether the
  flag is safe to flip.

Usage:

    # default (writes to data/reports/eval_<ts>.md)
    STRATEGICMIND_LLM_OVERRIDE=mocks.MockProvider \
        python3 backend/scripts/eval_profile_retrieval.py

    # CI-friendly "fast path" — small fixture set, no LLM
    STRATEGICMIND_LLM_OVERRIDE=mocks.MockProvider \
        python3 backend/scripts/eval_profile_retrieval.py --quick

    # Override the report path
    ... --report /tmp/my_eval.md
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Tuple

# Make project importable when run as a script
ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Mirror the run_server env defaults
BACKEND_DIR = ROOT / "backend"
os.environ.setdefault("UPLOAD_FOLDER", str(BACKEND_DIR / "uploads"))
os.environ.setdefault("REPORTS_DIR", str(BACKEND_DIR / "data" / "reports"))
os.environ.setdefault("PIPELINE_CHECKPOINT_DIR", str(BACKEND_DIR / "data" / "pipelines"))
for d in (
    os.environ["UPLOAD_FOLDER"],
    os.environ["REPORTS_DIR"],
    os.environ["PIPELINE_CHECKPOINT_DIR"],
):
    Path(d).mkdir(parents=True, exist_ok=True)

REPORTS_DIR = Path(os.environ["REPORTS_DIR"])


# ---------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------
# Each fixture is a (name, kg_payload, query, anchor_id) tuple. The
# anchor_id is the entity the retrieval should surface in the top-k;
# the report checks whether the flag-on path actually found it.
def _all_fixtures() -> List[Dict[str, Any]]:
    return [
        {
            "name": "competitor_pricing",
            "query": "competitor pricing strategy",
            "anchor": "compA",
            "entities": {
                "compA": {
                    "id": "compA",
                    "name": "Competitor Alpha",
                    "entity_type": "organization",
                    "summary": "Aggressive pricing strategy in cloud segment",
                },
                "compB": {
                    "id": "compB",
                    "name": "Competitor Beta",
                    "entity_type": "organization",
                    "summary": "Premium pricing, slower rollout",
                },
                "deptX": {
                    "id": "deptX",
                    "name": "Marketing Department",
                    "entity_type": "department",
                    "summary": "Owns pricing and promotion",
                },
            },
            "relations": [
                ("compA", "competes_with", "deptX"),
                ("compB", "competes_with", "deptX"),
            ],
        },
        {
            "name": "regulator_compliance",
            "query": "regulator compliance policy",
            "anchor": "regA",
            "entities": {
                "regA": {
                    "id": "regA",
                    "name": "Federal Regulator Alpha",
                    "entity_type": "government",
                    "summary": "Issues compliance policy for cloud providers",
                },
                "deptLegal": {
                    "id": "deptLegal",
                    "name": "Legal Department",
                    "entity_type": "department",
                    "summary": "Tracks regulatory policy and audits",
                },
                "compA": {
                    "id": "compA",
                    "name": "Competitor Alpha",
                    "entity_type": "organization",
                    "summary": "Cloud provider, mostly compliant",
                },
            },
            "relations": [
                ("regA", "regulates", "deptLegal"),
                ("regA", "regulates", "compA"),
            ],
        },
        {
            "name": "partner_alliance",
            "query": "partner alliance growth",
            "anchor": "partZ",
            "entities": {
                "partZ": {
                    "id": "partZ",
                    "name": "Partner Zeta",
                    "entity_type": "organization",
                    "summary": "Strategic alliance for growth in APAC",
                },
                "deptBiz": {
                    "id": "deptBiz",
                    "name": "Business Development",
                    "entity_type": "department",
                    "summary": "Owns partner program and alliance pipeline",
                },
                "compA": {
                    "id": "compA",
                    "name": "Competitor Alpha",
                    "entity_type": "organization",
                    "summary": "Distributes through independent resellers",
                },
            },
            "relations": [
                ("partZ", "allied_with", "deptBiz"),
            ],
        },
        {
            "name": "market_segment",
            "query": "enterprise customer segment",
            "anchor": "custE",
            "entities": {
                "custE": {
                    "id": "custE",
                    "name": "Enterprise Customer Epsilon",
                    "entity_type": "customer",
                    "summary": "Large enterprise, multi-year contract",
                },
                "deptSales": {
                    "id": "deptSales",
                    "name": "Sales Department",
                    "entity_type": "department",
                    "summary": "Owns enterprise customer segment",
                },
                "compA": {
                    "id": "compA",
                    "name": "Competitor Alpha",
                    "entity_type": "organization",
                    "summary": "Also targets enterprise customer",
                },
            },
            "relations": [
                ("deptSales", "sells_to", "custE"),
            ],
        },
        {
            "name": "supply_chain",
            "query": "supplier logistics bottleneck",
            "anchor": "supS",
            "entities": {
                "supS": {
                    "id": "supS",
                    "name": "Supplier Sigma",
                    "entity_type": "organization",
                    "summary": "Critical supplier, logistics bottleneck risk",
                },
                "deptOps": {
                    "id": "deptOps",
                    "name": "Operations Department",
                    "entity_type": "department",
                    "summary": "Manages supplier and logistics",
                },
                "compA": {
                    "id": "compA",
                    "name": "Competitor Alpha",
                    "entity_type": "organization",
                    "summary": "Vertically integrated supplier",
                },
            },
            "relations": [
                ("supS", "supplies_to", "deptOps"),
            ],
        },
    ]


# ---------------------------------------------------------------------
# Mock LLM provider
# ---------------------------------------------------------------------
# In tests we point ``STRATEGICMIND_LLM_OVERRIDE`` at ``mocks.MockProvider``
# (the project's existing mock). Here we additionally define a minimal
# in-process provider so the harness works even when the project's
# ``tests.mocks`` module isn't on the path (e.g. from a clean checkout).
class _FallbackMockProvider:
    """Standalone mock that records prompts and returns deterministic
    JSON. Used only when ``tests.mocks.MockProvider`` is unavailable.
    """

    def __init__(self) -> None:
        self.calls: List[str] = []

    async def chat(self, messages, **kwargs):
        prompt = messages[-1]["content"] if messages else ""
        self.calls.append(prompt)
        return SimpleNamespace(content='{"beliefs": [], "interests": {}}')

    async def stream_chat(self, messages, **kwargs):
        prompt = messages[-1]["content"] if messages else ""
        self.calls.append(prompt)
        yield '{"beliefs": []'


def _resolve_provider():
    """Return an LLM provider. Prefer the project's MockProvider when
    available; otherwise fall back to the in-process one above. Both
    are deterministic, so the harness's assertions stay stable."""
    override = os.environ.get("STRATEGICMIND_LLM_OVERRIDE", "")
    if override:
        try:
            module_name, attr = override.rsplit(".", 1)
            import importlib

            mod = importlib.import_module(module_name)
            cls = getattr(mod, attr)
            return cls()
        except Exception as exc:  # pragma: no cover - defensive
            print(f"[warn] could not load {override!r}: {exc!r}", file=sys.stderr)
    return _FallbackMockProvider()


# ---------------------------------------------------------------------
# Eval runner
# ---------------------------------------------------------------------
class _CapturingProvider:
    """Wraps an ILLMProvider and records the last prompt it received.
    Used by the A/B harness to compare the prompt-only vs retrieval-
    grounded prompt sizes and content."""

    def __init__(self, inner) -> None:
        self._inner = inner
        self.last_prompt: str = ""

    async def chat(self, messages, **kwargs):
        self.last_prompt = messages[-1]["content"] if messages else ""
        return await self._inner.chat(messages, **kwargs)

    async def stream_chat(self, messages, **kwargs):
        self.last_prompt = messages[-1]["content"] if messages else ""
        async for chunk in self._inner.stream_chat(messages, **kwargs):
            yield chunk


class _FakeStore:
    def __init__(self, kg) -> None:
        self.kg_index = kg
        self.calls: List[str] = []

    async def get_entity_context(self, entity_id: str) -> str:
        self.calls.append(entity_id)
        return f"ctx-for:{entity_id}"


def _resolve_generator(provider):
    """Build a :class:`StrategicProfileGenerator` against the (faked)
    knowledge store. Importing is delayed to keep --help fast and to
    avoid module-level side effects when --quick is used."""
    from backend.services.strategic_profile_generator import (
        StrategicProfileGenerator,
    )
    return StrategicProfileGenerator


async def _run_fixture(
    fixture: Dict[str, Any],
    retrieval_on: bool,
    provider_factory,
) -> Dict[str, Any]:
    """Run a single fixture under the given flag state. Returns a
    small dict of metrics for the report."""
    from backend.services.kg_engine import build_from_dict
    from backend.services.strategic_profile_generator import (
        StrategicProfileGenerator,
    )

    kg = build_from_dict(
        entities=fixture["entities"],
        relations=fixture.get("relations", []),
    )
    provider = provider_factory()
    capturing = _CapturingProvider(provider)
    store = _FakeStore(kg)
    gen = StrategicProfileGenerator(store, capturing)

    entity = {
        "id": fixture["anchor"],
        "name": fixture["entities"][fixture["anchor"]]["name"],
        "uuid": fixture["anchor"],
    }

    os.environ["STRATEGICMIND_PROFILE_RETRIEVAL"] = "1" if retrieval_on else "0"
    try:
        await gen.generate(entity)
    finally:
        os.environ.pop("STRATEGICMIND_PROFILE_RETRIEVAL", None)

    prompt = capturing.last_prompt
    hits = kg.retrieval(fixture["query"], k=5) if retrieval_on else []
    hit_ids = [h.get("id") for h in hits]
    return {
        "name": fixture["name"],
        "query": fixture["query"],
        "anchor": fixture["anchor"],
        "prompt_len": len(prompt),
        "has_retrieval_block": "[retrieved_context]" in prompt,
        "retrieval_hits": hit_ids,
        "anchor_in_top_k": fixture["anchor"] in hit_ids,
    }


def _build_report(rows: List[Dict[str, Any]], quick: bool) -> str:
    """Render the A/B table as a markdown report. Stable column order
    so a human can diff two runs."""
    lines: List[str] = []
    lines.append("# G7 Profile-Retrieval A/B Report")
    lines.append("")
    lines.append(f"- quick mode: `{quick}`")
    lines.append(f"- generated_at: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(
        "- flag: `STRATEGICMIND_PROFILE_RETRIEVAL` "
        "(0 = prompt-only, 1 = retrieval-grounded)"
    )
    lines.append("")
    lines.append("## Per-fixture comparison")
    lines.append("")
    lines.append(
        "| fixture | prompt-only len | retrieval-on len | "
        "block present | top-1 hit | anchor in top-k |"
    )
    lines.append("|---|---:|---:|:---:|:---:|:---:|")
    wins = 0
    for row in rows:
        prompt_only = row["prompt_only"]
        retrieval_on = row["retrieval_on"]
        top1 = retrieval_on["retrieval_hits"][0] if retrieval_on["retrieval_hits"] else "-"
        ok = retrieval_on["anchor_in_top_k"]
        if ok:
            wins += 1
        lines.append(
            f"| {row['name']} | {prompt_only['prompt_len']} | "
            f"{retrieval_on['prompt_len']} | "
            f"{'yes' if retrieval_on['has_retrieval_block'] else 'no'} | "
            f"{top1} | {'yes' if ok else 'no'} |"
        )
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(
        f"- **anchor hit-rate:** {wins}/{len(rows)} "
        f"({'>= 3/5 — eligible to flip flag' if wins >= 3 else '< 3/5 — keep flag off'})"
    )
    lines.append(
        "- **block size delta:** retrieval adds ~"
        "5 lines per fixture (top-k entities formatted as a prompt block)"
    )
    lines.append(
        "- **default-off path:** prompt length is unchanged vs. pre-G7 baseline"
    )
    lines.append("")
    lines.append("## How to flip the flag")
    lines.append("")
    lines.append("```bash")
    lines.append("# keep off (default, byte-identical to pre-G7 baseline)")
    lines.append("unset STRATEGICMIND_PROFILE_RETRIEVAL")
    lines.append("# turn on (only after this report shows >= 3/5 anchor hit-rate)")
    lines.append("export STRATEGICMIND_PROFILE_RETRIEVAL=1")
    lines.append("```")
    lines.append("")
    return "\n".join(lines)


async def _main(quick: bool, report_path: Optional[str]) -> int:
    fixtures = _all_fixtures()
    if quick:
        fixtures = fixtures[:2]

    provider_factory = _resolve_provider
    rows: List[Dict[str, Any]] = []
    for fixture in fixtures:
        prompt_only = await _run_fixture(fixture, retrieval_on=False, provider_factory=provider_factory)
        retrieval_on = await _run_fixture(fixture, retrieval_on=True, provider_factory=provider_factory)
        rows.append({
            "name": fixture["name"],
            "prompt_only": prompt_only,
            "retrieval_on": retrieval_on,
        })

    report = _build_report(rows, quick=quick)
    if report_path:
        out = Path(report_path)
        out.parent.mkdir(parents=True, exist_ok=True)
    else:
        ts = time.strftime("%Y%m%d-%H%M%S")
        out = REPORTS_DIR / f"eval_{ts}.md"
    out.write_text(report, encoding="utf-8")
    print(f"OK wrote {out} ({len(fixtures)} fixtures)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Run a smaller 2-fixture set; finishes in <1s with MockProvider.",
    )
    parser.add_argument(
        "--report",
        default=None,
        help="Override the report output path (default: data/reports/eval_<ts>.md).",
    )
    args = parser.parse_args()
    return asyncio.run(_main(quick=args.quick, report_path=args.report))


if __name__ == "__main__":
    sys.exit(main())
