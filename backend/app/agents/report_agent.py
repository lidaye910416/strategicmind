"""
ReportAgent - Generate strategic reports

Implements US-035 (refactored to use ITool)
"""

import json
from typing import List, Dict, Any, Optional

from backend.interfaces.tool import ITool, ToolResult
from backend.interfaces.llm_provider import ILLMProvider


class ReportAgent:
    """
    Agent for generating strategic reports.

    Uses injected tools for knowledge access instead of Zep SDK.
    """

    def __init__(self, tools: List[ITool], llm_provider: ILLMProvider):
        """
        Initialize ReportAgent.

        Args:
            tools: List of ITool implementations
            llm_provider: LLM provider for report generation
        """
        self.tools = {t.name: t for t in tools}
        self.llm_provider = llm_provider

    async def generate(
        self,
        simulation_results: Dict[str, Any],
        report_style: str = "executive",
        user_params: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Generate a strategic report.

        Args:
            simulation_results: Results from simulation
            report_style: Style of report (executive/technical/narrative)
            user_params: Optional user-supplied params (e.g. external_factors
                and selected_departments) to weave into the prompt.

        Returns:
            Generated report text
        """
        # Build context from simulation_results AND any tool results
        context = await self._gather_context(simulation_results)

        # Generate report using LLM
        prompt = self._build_report_prompt(
            context, report_style, simulation_results, user_params=user_params,
        )

        messages = [{"role": "user", "content": prompt}]
        response = await self.llm_provider.chat(messages)

        return response

    async def _gather_context(self, simulation_results: Dict[str, Any]) -> str:
        """Gather context from knowledge tools + simulation data."""
        context_parts = []

        # Tool-based retrieval (optional)
        if "search" in self.tools:
            try:
                search_tool = self.tools["search"]
                result = await search_tool.execute(query="strategic decision business impact")
                if result.success and result.data:
                    context_parts.append(f"Search results:\n{result.data}")
            except Exception:
                pass

        # Inline simulation data is the primary context - we always
        # include it so the model has something to reason about even
        # when knowledge-store search returns nothing.
        if simulation_results:
            try:
                sim_summary = self._summarize_simulation(simulation_results)
                if sim_summary:
                    context_parts.append(f"Simulation data:\n{sim_summary}")
            except Exception:
                # Never let context-building crash the report
                pass

        return "\n\n".join(context_parts) if context_parts else "No context available"

    @staticmethod
    def _summarize_simulation(simulation_results: Dict[str, Any]) -> str:
        """Compact, JSON-safe summary of the simulation data for the prompt."""
        if not isinstance(simulation_results, dict):
            return ""

        lines: list = []

        # Top-level metadata
        for k in ("run_id", "status", "current_stage", "current_round", "total_rounds"):
            if k in simulation_results:
                lines.append(f"{k}: {simulation_results[k]}")

        # PROFILE_GENERATION artifacts: agents
        artifacts = simulation_results.get("artifacts") or {}
        prof = artifacts.get("PROFILE_GENERATION") or {}
        if isinstance(prof, dict):
            agents = prof.get("agents") or []
            if agents:
                lines.append(f"\nStakeholders ({len(agents)}):")
                for a in agents[:20]:
                    if not isinstance(a, dict):
                        continue
                    name = a.get("name", "?")
                    atype = a.get("type", "?")
                    inf = a.get("influence_weight", "")
                    inf_s = f", influence={inf}" if inf != "" else ""
                    lines.append(f"  - {name} ({atype}{inf_s})")

        # SIMULATION_RUNNING artifacts: rounds + actions
        sim = artifacts.get("SIMULATION_RUNNING") or {}
        if isinstance(sim, dict):
            rounds = sim.get("round_results") or []
            if rounds:
                lines.append(f"\nSimulation rounds ({len(rounds)}):")
                for r in rounds[:20]:
                    if not isinstance(r, dict):
                        continue
                    rn = r.get("round_num", "?")
                    hr = r.get("simulated_hour", "?")
                    actions = r.get("actions") or []
                    lines.append(f"  R{rn} (hour {hr}): {len(actions)} actions")
                    for a in actions[:5]:
                        if not isinstance(a, dict):
                            continue
                        atype = a.get("action_type", "?")
                        desc = (a.get("public_description") or "").strip()
                        if desc and len(desc) > 120:
                            desc = desc[:120] + "..."
                        actor_name = a.get("actor_name", "")
                        actor_s = f" by {actor_name}" if actor_name else ""
                        lines.append(f"    - [{atype}]{actor_s} {desc}")

        # CONFIG_GENERATION: simulation parameters
        cfg = artifacts.get("CONFIG_GENERATION") or {}
        if isinstance(cfg, dict):
            sim_cfg = cfg.get("sim_config") or {}
            if sim_cfg:
                lines.append(
                    f"\nSimulation config: max_rounds={sim_cfg.get('max_rounds')}, "
                    f"hours={sim_cfg.get('simulated_hours')}, "
                    f"agents={len(sim_cfg.get('agents', []))}"
                )

        return "\n".join(lines)

    def _build_report_prompt(
        self,
        context: str,
        style: str,
        simulation_results: Dict[str, Any],
        user_params: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Build prompt for report generation"""
        style_instructions = {
            "executive": "Provide a concise summary with key recommendations",
            "technical": "Provide detailed analysis with data supporting each point",
            "narrative": "Tell a story about the strategic situation and outcomes",
        }

        # Defensive: if the orchestrator passed nothing useful, fall back
        # to a generic "do your best" instruction so the LLM still
        # produces a meaningful report.
        if not context or context == "No context available":
            context = (
                "No structured simulation data was available. Use your "
                "general strategic-analysis knowledge to produce a "
                "well-structured report for the user."
            )

        # P2-G3 remainder: surface user-supplied external_factors and
        # selected_departments so the LLM explicitly addresses them in
        # the report (and the generated .md contains those keywords).
        user_params = user_params or {}
        extra_blocks: List[str] = []
        external_factors = [
            str(x).strip() for x in (user_params.get("external_factors") or [])
            if str(x).strip()
        ]
        if external_factors:
            factors_lines = "\n".join(f"- {f}" for f in external_factors)
            extra_blocks.append(
                "## 外部因素 (user-specified)\n"
                "The user explicitly called out the following external "
                "factors. The report MUST reference each one and discuss "
                "its impact on strategy, risk, and next steps.\n"
                f"{factors_lines}"
            )
        selected_departments = [
            str(d).strip() for d in (user_params.get("departments") or [])
            if str(d).strip()
        ]
        if selected_departments:
            dept_lines = "\n".join(f"- {d}" for d in selected_departments)
            extra_blocks.append(
                "## 部门覆盖范围 (user-specified)\n"
                "The user scoped the analysis to the following departments; "
                "make sure findings and recommendations cover each.\n"
                f"{dept_lines}"
            )
        extra_section = "\n\n".join(extra_blocks)

        return f"""Generate a strategic report based on the following simulation results and context.

Context:
{context}

{extra_section}

Style: {style_instructions.get(style, style_instructions['executive'])}

Include the following sections (in markdown):
1. Executive Summary - 2-3 sentence top-line takeaway
2. Key Findings - the most important observations from the simulation
3. Strategic Recommendations - 3-5 concrete recommendations
4. Risk Assessment - top 3-5 risks with mitigations
5. Next Steps - actionable items for the next 30-90 days

Important: If the context above contains structured simulation data
(stakeholders, rounds, actions), reference those specifically. If it
does not, reason from your general strategic knowledge. In both
cases, do not refuse to produce a report.
"""

    async def chat(self, message: str, context: Dict[str, Any]) -> str:
        """
        Answer follow-up questions about the report.

        Args:
            message: User question
            context: Conversation context

        Returns:
            Response text
        """
        # Provide the report + the user's question so the model can
        # answer follow-ups without needing an external store.
        report_text = ""
        run_id = context.get("runId") if isinstance(context, dict) else None
        if run_id:
            try:
                import os
                # Best-effort: pull the report file from disk so chat
                # answers reference the actual report content.
                from backend.app.config import config as app_config
                path = os.path.join(app_config.reports_dir, f"{run_id}.md")
                if os.path.exists(path):
                    with open(path, "r", encoding="utf-8") as f:
                        report_text = f.read()[:8000]
            except Exception:
                report_text = ""

        system_prompt = (
            "You are a strategic advisor answering questions about a "
            "completed simulation report. Use the report content below "
            "as the source of truth. If the user's question cannot be "
            "answered from the report, say so honestly and offer your "
            "best general reasoning."
        )

        user_parts = []
        if report_text:
            user_parts.append(f"Report:\n```\n{report_text}\n```")
        user_parts.append(f"Question: {message}")
        user_content = "\n\n".join(user_parts)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]
        return await self.llm_provider.chat(messages)
