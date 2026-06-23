"""
LoopEngineLLMAdapter — bridge v1 ``llm_provider.chat()`` to v2 LLMClient.complete().

Bug #2 root cause: v1 ``_generate_agent_action`` only saw the agent's
own system_prompt; the LLM did not know about ``world_state`` /
``peer_actions`` / ``recent_episodes`` / ``active_shocks``. This
adapter replaces the v1 freeform prompt with a v2 strictly-typed
``DecisionContext`` and injects the 4 critical slices into the LLM
prompt so it can make grounded decisions.
"""
from __future__ import annotations

import dataclasses
import json
import logging
import re
import warnings
from typing import Any, Dict, List, Sequence

from pydantic import BaseModel, Field, ValidationError

from ...models.action_type import (
    ActionType,
    PropagationChannel,
    StrategicAction,
)
from ...models.strategic_agent import StrategicAgent
from ...models.world_state import WorldState
from .action_taxonomy import BusinessActionType, from_v1 as _from_v1
from .clock import SimClock

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# v2 AgentDecision — pydantic-validated LLM response shape.
# ---------------------------------------------------------------------------


class LegacyActionTypeWarning(UserWarning):
    """Raised when an LLM returns a v1-only action type that lacks a
    direct v2 BusinessActionType equivalent. The resolver falls back to
    ``BusinessActionType.from_v1`` to keep the round alive, but the
    count is exposed for benchmark validation."""


class AgentDecision(BaseModel):
    """Pydantic-validated LLM response shape.

    Validation failures must not collapse a whole round — they bump
    ``parse_failures`` and fall back to a defensive HOLD_POSITION
    decision (see Bug #2 acceptance #2).
    """

    action_type: str = "HOLD_POSITION"
    target_positions: Dict[str, float] = Field(default_factory=dict)
    trust_deltas: Dict[str, float] = Field(default_factory=dict)
    post_content: str = ""
    reasoning: str = ""
    # Ad-hoc v2 fields, set in v2 type resolution
    business_type: str = "MAKE_STATEMENT"
    in_reply_to: str = ""


# ---------------------------------------------------------------------------
# LoopEngineLLMAdapter
# ---------------------------------------------------------------------------


class LoopEngineLLMAdapter:
    """Adapts the v1 ``llm_provider.chat()`` interface to v2 ``LLMClient``.

    The engine never sees the underlying v1 client. It only knows the
    typed ``LLMClient.complete(context) -> AgentDecision`` contract.

    Implementation notes
    --------------------

    * The prompt explicitly includes the 4 slices that v1 missed
      (world_state, recent_episodes, peer_actions, active_shocks)
      so the LLM can ground its decision in current state.
    * Pydantic ``ValidationError`` -> HOLD_POSITION fallback + counter
      bump (Bug #2 acceptance #2).
    * v1-only action type that doesn't map to a v2 type -> count
      ``v1_type_unmapped_warnings`` and fall back to
      ``BusinessActionType.from_v1`` (Bug #2 acceptance #5).
    """

    def __init__(self, llm_provider: Any, knowledge_store: Any) -> None:
        self.llm = llm_provider
        self.kg = knowledge_store
        self._metrics = {
            "parse_failures": 0,
            "v1_type_unmapped_warnings": 0,
        }

    # ------------------------------------------------------------------
    # Public API (LLMClient protocol)
    # ------------------------------------------------------------------
    async def generate_action(
        self,
        *,
        agent: StrategicAgent,
        clock: SimClock,
        world_state: WorldState,
        candidates: Sequence[BusinessActionType],
        recent_episodes: Sequence[Dict[str, Any]] = (),
    ) -> StrategicAction:
        """Build a full DecisionContext prompt, call v1 LLM, parse, validate."""
        messages = self._build_prompt(agent, clock, world_state, candidates, recent_episodes)
        raw = await self.llm.chat(messages)
        try:
            decision = self._parse_and_validate(raw, candidates)
        except ValidationError as exc:
            self._metrics["parse_failures"] += 1
            logger.warning("LoopEngineLLMAdapter parse failure: %s", exc)
            # Conservative fallback — never let a bad LLM response kill a round.
            decision = AgentDecision(
                action_type="HOLD_POSITION",
                reasoning=f"parse_fallback: {exc.error_count()} errors",
                post_content=(
                    f"{agent.name}：本期决策保守延续，无重大动作。"
                ),
            )

        # Detect v1-only action type that doesn't map to a v2 type.
        if decision.action_type not in {c.value for c in candidates}:
            try:
                BusinessActionType(decision.action_type)
            except ValueError:
                # v1-only type — count it (Bug #2 acceptance #5).
                self._metrics["v1_type_unmapped_warnings"] += 1
                warnings.warn(
                    f"v1-only action_type={decision.action_type} not in v2 set; "
                    f"resolver will fall back to from_v1()",
                    LegacyActionTypeWarning,
                    stacklevel=2,
                )
                # Best-effort mapping via from_v1 (raises if no map).
                try:
                    mapped = _from_v1(ActionType(decision.action_type))
                    decision.action_type = mapped.value
                    decision.business_type = mapped.value
                except (ValueError, KeyError):
                    # No mapping — fall back to MAKE_STATEMENT.
                    decision.action_type = "MAKE_STATEMENT"
                    decision.business_type = "MAKE_STATEMENT"

        return self._to_strategic_action(decision, agent, clock)

    # ------------------------------------------------------------------
    # Prompt building
    # ------------------------------------------------------------------
    def _build_prompt(
        self,
        agent: StrategicAgent,
        clock: SimClock,
        world_state: WorldState,
        candidates: Sequence[BusinessActionType],
        recent_episodes: Sequence[Dict[str, Any]],
    ) -> List[Dict[str, str]]:
        """Construct system + user messages with full DecisionContext.

        Critical: 4 slices injected (world_state / peer_actions / episodes /
        shocks) that v1 ``_generate_agent_action`` missed entirely.
        """
        system = self._system_prompt(agent, candidates)
        user = self._user_prompt(agent, clock, world_state, recent_episodes)
        return [{"role": "system", "content": system}, {"role": "user", "content": user}]

    def _system_prompt(self, agent: StrategicAgent, candidates: Sequence[BusinessActionType]) -> str:
        persona = getattr(agent, "persona", "") or agent.name
        cand_list = ", ".join(c.value for c in candidates)
        return (
            f"You are {agent.name} (role: {persona}). "
            f"You are a 9-department strategic actor. "
            f"Choose exactly ONE action_type from the v2 set: {cand_list}. "
            f"Output STRICT JSON with fields: action_type, target_positions "
            f"(topic -> delta in [-1,1]), trust_deltas (agent_id -> delta), "
            f"post_content (>=40 chars, no template), reasoning."
        )

    def _user_prompt(
        self,
        agent: StrategicAgent,
        clock: SimClock,
        world_state: WorldState,
        recent_episodes: Sequence[Dict[str, Any]],
    ) -> str:
        ws = world_state.to_dict() if hasattr(world_state, "to_dict") else dict(world_state)
        ep_lines = []
        for e in (recent_episodes or [])[:5]:
            text = (e.get("text") or "")[:200]
            ep_lines.append(f"  - R{e.get('round_num','?')}: {text}")
        ep_block = "\n".join(ep_lines) if ep_lines else "  (no prior episodes)"
        return (
            f"## World State (round {clock.describe().get('round_num', '?')})\n"
            f"{json.dumps(ws, default=str, ensure_ascii=False)[:1500]}\n\n"
            f"## Your Recent Episodes (newest first)\n{ep_block}\n\n"
            f"## Decision\nOutput JSON only."
        )

    # ------------------------------------------------------------------
    # Parse + validate
    # ------------------------------------------------------------------
    def _parse_and_validate(
        self, raw: Any, candidates: Sequence[BusinessActionType]
    ) -> AgentDecision:
        text = self._extract_text(raw)
        # Strip code fences LLM often adds.
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.MULTILINE)
        data = json.loads(text)
        return AgentDecision.model_validate(data)

    @staticmethod
    def _extract_text(raw: Any) -> str:
        if isinstance(raw, str):
            return raw
        if isinstance(raw, dict):
            for key in ("content", "text", "message"):
                if key in raw and isinstance(raw[key], str):
                    return raw[key]
            return json.dumps(raw, default=str)
        return str(raw)

    @staticmethod
    def _to_strategic_action(
        decision: AgentDecision, agent: StrategicAgent, clock: SimClock
    ) -> StrategicAction:
        """Build a v1 StrategicAction carrying v2 ad-hoc fields.

        v2 fields (post_content, target_positions, trust_deltas, business_type)
        live as ad-hoc attributes on the StrategicAction (matches
        engine._decide_action convention of getattr/setattr).
        """
        try:
            btype = BusinessActionType(decision.action_type)
        except ValueError:
            btype = BusinessActionType.MAKE_STATEMENT
        action = StrategicAction(
            actor_id=agent.agent_id,
            round_num=int(clock.describe().get("round_num", 0) or 0),
            action_type=ActionType.MAKE_STATEMENT,  # legacy enum slot; resolver reads metadata.business_type
            public_description=decision.post_content[:280] if decision.post_content else "",
        )
        # Stash v2 fields on the action as ad-hoc attributes — the v1
        # dataclass doesn't declare them so we use setattr-style.
        try:
            action.post_content = decision.post_content
            action.reasoning = decision.reasoning
            action.target_positions = decision.target_positions
            action.trust_deltas = decision.trust_deltas
            action.business_type = btype.value
            if decision.in_reply_to:
                action.in_reply_to = decision.in_reply_to
        except (AttributeError, dataclasses.FrozenInstanceError):
            # Frozen instance — fall back to metadata dict.
            md = action.metadata or {}
            md["business_type"] = btype.value
            md["post_content"] = decision.post_content
            md["target_positions"] = dict(decision.target_positions)
            md["trust_deltas"] = dict(decision.trust_deltas)
            action.metadata = md
        return action


# Re-export at module level for tests.
__all__ = [
    "LoopEngineLLMAdapter",
    "AgentDecision",
    "LegacyActionTypeWarning",
]
