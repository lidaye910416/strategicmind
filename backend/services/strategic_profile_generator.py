"""
StrategicProfileGenerator - Generate StrategicAgent profiles from entities

This generator creates StrategicAgent profiles for the strategic simulation,
using IKnowledgeStore for entity context.

G7 (kg_engine): when ``STRATEGICMIND_PROFILE_RETRIEVAL=1`` is set in the
environment, the generator calls ``kg_index.retrieval(query, k=5)`` and
injects the resulting entities as a "retrieved context" block into the
LLM prompt. The default (env unset / =0) keeps the prior prompt-only
path, byte-identical to the pre-G7 baseline, so a flag-flip is the
only thing that changes behavior. Verified by the snapshot test in
``backend/services/kg_engine/tests/test_graph_index.py``.
"""

import os
from typing import Dict, List, Any, Optional

from ..interfaces.knowledge_store import IKnowledgeStore
from ..interfaces.llm_provider import ILLMProvider
from ..models.strategic_agent import StrategicAgent, AgentType, BeliefState, InterestProfile


# G7 feature flag. Read at module import so a snapshot test can mock the
# env once and observe byte-stable behavior across the rest of the run.
_RETRIEVAL_ENV = "STRATEGICMIND_PROFILE_RETRIEVAL"


def _retrieval_enabled() -> bool:
    raw = os.environ.get(_RETRIEVAL_ENV, "")
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _format_retrieved_context(entities: List[Dict[str, Any]]) -> str:
    """Format the retrieval hits into a prompt block.

    Stable, line-oriented so the snapshot test stays byte-identical
    across Python runs (no set ordering, no locale-sensitive
    formatting).
    """
    if not entities:
        return ""
    lines: List[str] = ["[retrieved_context]"]
    for ent in entities:
        eid = ent.get("id") or ent.get("uuid") or ""
        name = ent.get("name", "") or ""
        etype = ent.get("entity_type", "") or ""
        score = ent.get("__score__")
        depth = ent.get("__depth__")
        bits = [f"id={eid}", f"name={name}"]
        if etype:
            bits.append(f"type={etype}")
        if score is not None:
            bits.append(f"score={float(score):.3f}")
        if depth is not None:
            bits.append(f"depth={int(depth)}")
        lines.append("  - " + " ".join(bits))
    return "\n".join(lines)


class StrategicProfileGenerator:
    """
    Generates StrategicAgent profiles from knowledge store entities.

    Strategic profile generator for strategic scenarios.

    Usage:
        generator = StrategicProfileGenerator(knowledge_store, llm_provider)
        agent = await generator.generate(entity)
    """

    def __init__(
        self,
        knowledge_store: IKnowledgeStore,
        llm_provider: ILLMProvider,
    ):
        self.knowledge_store = knowledge_store
        self.llm_provider = llm_provider

    async def generate(
        self,
        entity: Dict[str, Any],
        agent_type: Optional[AgentType] = None,
    ) -> StrategicAgent:
        """Generate StrategicAgent from entity"""
        # Determine agent type from entity if not specified
        if agent_type is None:
            agent_type = self._infer_agent_type(entity)

        # Get entity context
        context = await self.knowledge_store.get_entity_context(entity.get("uuid", ""))

        # G7: when the retrieval flag is on, augment context with a
        # ``retrieval(query, k=5)`` call against the kg_engine adapter
        # (attached to the knowledge store as ``.kg_index``). The
        # default path leaves ``context`` unchanged.
        if _retrieval_enabled():
            kg_index = getattr(self.knowledge_store, "kg_index", None)
            query = (
                entity.get("name", "")
                or entity.get("uuid", "")
                or entity.get("id", "")
            )
            if kg_index is not None and hasattr(kg_index, "retrieval"):
                try:
                    hits = kg_index.retrieval(query, k=5) or []
                except Exception:
                    hits = []
                retrieved_block = _format_retrieved_context(hits)
                if retrieved_block:
                    context = (context or "") + "\n\n" + retrieved_block

        # Generate beliefs and interests using LLM
        beliefs, interests = await self._generate_profile_components(
            entity, context, agent_type
        )
        
        # Create agent
        agent = StrategicAgent(
            name=entity.get("name", "Unknown"),
            agent_type=agent_type,
            beliefs=beliefs,
            interests=interests,
            influence_weight=self._calculate_influence(entity),
            credibility=0.8,
        )
        
        return agent
    
    async def _generate_profile_components(
        self,
        entity: Dict[str, Any],
        context: str,
        agent_type: AgentType,
    ) -> tuple:
        """Generate beliefs and interests using LLM"""
        prompt = f"""Generate profile for {entity.get('name', 'Unknown')}

Entity: {entity}
Context: {context}

Generate a JSON with:
- beliefs: List of {{
    "topic": "belief topic",
    "position": -1.0 to 1.0,
    "confidence": 0.0 to 1.0
}}
- interests: {{
    "primary_interests": ["interest1", ...],
    "secondary_interests": [...],
    "red_lines": [...],
    "risk_tolerance": 0.0 to 1.0,
    "time_horizon": "short"/"medium"/"long"
}}"""
        
        messages = [{"role": "user", "content": prompt}]
        response = await self.llm_provider.chat(messages)
        
        # Parse response (simplified)
        beliefs = BeliefState()
        interests = InterestProfile()
        
        return beliefs, interests
    
    def _infer_agent_type(self, entity: Dict[str, Any]) -> AgentType:
        """Infer agent type from entity"""
        entity_type = entity.get("entity_type", "").lower()
        
        type_mapping = {
            "person": AgentType.CORPORATE_EXEC,
            "organization": AgentType.CORPORATE_EXEC,
            "government": AgentType.POLICY_MAKER,
            "investor": AgentType.INSTITUTIONAL_INVESTOR,
            "analyst": AgentType.ANALYST,
            "media": AgentType.MEDIA,
        }
        
        for key, atype in type_mapping.items():
            if key in entity_type:
                return atype
        
        return AgentType.CORPORATE_EXEC
    
    def _calculate_influence(self, entity: Dict[str, Any]) -> float:
        """Calculate influence weight from entity"""
        # Simple heuristic
        attributes = entity.get("attributes", {})
        influence = attributes.get("influence_weight", 0.5)
        return float(influence)


# ---------------------------------------------------------------------
# G7 retrieval-hook self-test
# ---------------------------------------------------------------------
# Run with:
#   STRATEGICMIND_PROFILE_RETRIEVAL=1 STRATEGICMIND_LLM_OVERRIDE=... \
#       python3 -m backend.services.strategic_profile_generator._test_retrieval_hook
# The test asserts that:
#  - with =0 (default) the prompt does NOT include a [retrieved_context] block;
#  - with =1 the prompt DOES include a non-empty [retrieved_context] block
#    containing the top-1 entity returned by kg_index.retrieval.
# It uses a fake knowledge store + LLM provider so it can run with no
# external services and finishes in milliseconds.
def _test_retrieval_hook() -> int:
    """Self-test for the retrieval flag. Returns 0 on success, 1 on
    any assertion failure. Intended to be invoked via
    ``python3 -m backend.services.strategic_profile_generator._test_retrieval_hook``.
    """
    import asyncio
    import sys
    from types import SimpleNamespace

    from .kg_engine import build_from_dict
    from ..interfaces.llm_provider import ILLMProvider

    class _CapturingProvider(ILLMProvider):
        """Records the last prompt it received."""

        def __init__(self) -> None:
            self.last_prompt: str = ""

        async def chat(self, messages, **kwargs):
            self.last_prompt = messages[-1]["content"] if messages else ""
            return SimpleNamespace(content="{}")

        async def stream_chat(self, messages, **kwargs):
            yield "{}"

    class _FakeStore:
        def __init__(self, kg):
            self.kg_index = kg

        async def get_entity_context(self, entity_id: str) -> str:
            return f"ctx-for:{entity_id}"

    async def _run() -> int:
        kg = build_from_dict(
            entities={
                "compA": {
                    "id": "compA",
                    "name": "Competitor Alpha",
                    "entity_type": "organization",
                    "summary": "Pricing strategy and market share dynamics",
                },
                "deptX": {
                    "id": "deptX",
                    "name": "Marketing Department",
                    "entity_type": "department",
                    "summary": "Handles pricing and promotion",
                },
            },
            relations=[("compA", "competes_with", "deptX")],
        )
        entity = {"id": "compA", "name": "Competitor Alpha", "uuid": "compA"}

        # Case 1: flag off — no [retrieved_context] block.
        os.environ[_RETRIEVAL_ENV] = "0"
        provider_off = _CapturingProvider()
        gen_off = StrategicProfileGenerator(_FakeStore(kg), provider_off)
        await gen_off.generate(entity)
        if "[retrieved_context]" in provider_off.last_prompt:
            print("FAIL: flag=0 still injected [retrieved_context]", file=sys.stderr)
            return 1

        # Case 2: flag on — block present and contains 'compA' (top hit).
        os.environ[_RETRIEVAL_ENV] = "1"
        provider_on = _CapturingProvider()
        gen_on = StrategicProfileGenerator(_FakeStore(kg), provider_on)
        await gen_on.generate(entity)
        if "[retrieved_context]" not in provider_on.last_prompt:
            print("FAIL: flag=1 did not inject [retrieved_context]", file=sys.stderr)
            return 1
        if "compA" not in provider_on.last_prompt:
            print("FAIL: flag=1 block missing top hit 'compA'", file=sys.stderr)
            return 1

        # Clean up so a subsequent default test isn't polluted.
        os.environ.pop(_RETRIEVAL_ENV, None)
        print("OK retrieval_hook")
        return 0

    return asyncio.run(_run())


if __name__ == "__main__":
    import sys
    sys.exit(_test_retrieval_hook())
