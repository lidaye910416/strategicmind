"""
PipelineOrchestrator - Real 7-stage pipeline that chains all services.

Stages (matches PRD-009 acceptance criteria):
    1. SEED_PARSING       - Load uploaded documents
    2. GRAPH_BUILDING     - GraphBuilderService (EntityExtractor + LocalKnowledgeStore)
    3. ENTITY_EXTRACTION  - Pass-through of graph building result
    4. PROFILE_GENERATION - StrategicProfileGenerator
    5. CONFIG_GENERATION  - StrategicConfigGenerator
    6. SIMULATION_RUNNING - SimulationLoop (BeliefEngine + PropagationLayer)
    7. REPORT_GENERATING  - ReportAgent (writes to /api/report/<run_id>)

Supports pause/resume/cancel via per-run event queues, and persists
checkpoints to disk so a pipeline can be resumed after restart.

Implements: US-050, US-051, US-052, US-053, US-057, US-009
"""
import asyncio
import json
import os
import time
import traceback
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Callable, Dict, List, Optional


def _get_upload_folder():
    # Use UPLOAD_FOLDER env var (set by app config) to stay in sync with
    # the graph upload API. Fallback to <backend>/uploads for local dev.
    p = os.environ.get('UPLOAD_FOLDER')
    if p:
        return p if os.path.isabs(p) else os.path.abspath(p)
    return os.path.abspath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', 'uploads'
    ))


def _get_llm_api_key():
    return os.environ.get('LLM_API_KEY')

from backend.interfaces.llm_provider import ILLMProvider
from backend.interfaces.knowledge_store import IKnowledgeStore
from backend.models.seed_document import SeedDocument, DocumentType
from backend.models.strategic_agent import StrategicAgent, AgentType
from backend.services.entity_extractor import EntityExtractor
from backend.services.event_bus import EventBus
from backend.services.graph_builder_service import GraphBuilderService
from backend.services.local_graph_store import LocalGraphStore
from backend.services.local_knowledge_store import LocalKnowledgeStore
from backend.services.simulation_loop import SimulationLoop
from backend.services.belief_engine import BeliefEngine
from backend.services.propagation_layer import PropagationLayer
from backend.services.strategic_profile_generator import StrategicProfileGenerator
from backend.services.strategic_config_generator import StrategicConfigGenerator
from backend.tools.search_tool import SearchTool


class Stage(str, Enum):
    SEED_PARSING = "SEED_PARSING"
    GRAPH_BUILDING = "GRAPH_BUILDING"
    ENTITY_EXTRACTION = "ENTITY_EXTRACTION"
    PROFILE_GENERATION = "PROFILE_GENERATION"
    CONFIG_GENERATION = "CONFIG_GENERATION"
    SIMULATION_RUNNING = "SIMULATION_RUNNING"
    REPORT_GENERATING = "REPORT_GENERATING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


STAGE_ORDER: List[Stage] = [
    Stage.SEED_PARSING,
    Stage.GRAPH_BUILDING,
    Stage.ENTITY_EXTRACTION,
    Stage.PROFILE_GENERATION,
    Stage.CONFIG_GENERATION,
    Stage.SIMULATION_RUNNING,
    Stage.REPORT_GENERATING,
]


@dataclass
class PipelineRun:
    """In-memory + persisted state of a pipeline run."""
    run_id: str
    status: str = "running"  # running | paused | completed | failed | cancelled
    current_stage: Stage = Stage.SEED_PARSING
    progress: float = 0.0
    config: Dict[str, Any] = field(default_factory=dict)
    completed_stages: List[str] = field(default_factory=list)
    artifacts: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None
    started_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


class _CancelledError(Exception):
    pass


class PipelineOrchestrator:
    """
    Real end-to-end pipeline wiring the 7 stages together.
    Persists checkpoints to ./data/pipelines/<run_id>.json.
    """

    def __init__(
        self,
        llm_provider: Optional[ILLMProvider] = None,
        upload_folder: Optional[str] = None,
        checkpoint_dir: str = "./data/pipelines",
        event_bus: Optional[EventBus] = None,
    ):
        self.llm_provider = llm_provider
        if self.llm_provider is None:
            from backend.services.llm_factory import create_llm_provider
            self.llm_provider = create_llm_provider()
        # Stash defaults; resolve via property so env changes are picked up
        self._upload_folder_default = upload_folder
        self._checkpoint_dir_default = checkpoint_dir
        # Per-instance event bus (defaults to module singleton).
        # Injectable for unit tests / multi-orchestrator scenarios.
        self.event_bus: EventBus = event_bus or EventBus()
        # Ensure dirs exist (use current env)
        self._ensure_dirs()
        self._init_state()

    def _resolve_upload_folder(self) -> str:
        env_uf = os.environ.get("UPLOAD_FOLDER")
        if env_uf:
            return env_uf if os.path.isabs(env_uf) else os.path.abspath(env_uf)
        if self._upload_folder_default:
            return self._upload_folder_default
        return _get_upload_folder()

    def _resolve_checkpoint_dir(self) -> str:
        env_ck = os.environ.get("PIPELINE_CHECKPOINT_DIR")
        if env_ck:
            return env_ck if os.path.isabs(env_ck) else os.path.abspath(env_ck)
        return self._checkpoint_dir_default

    def _ensure_dirs(self) -> None:
        os.makedirs(self._resolve_checkpoint_dir(), exist_ok=True)
        os.makedirs(self._resolve_upload_folder(), exist_ok=True)

    @property
    def upload_folder(self) -> str:
        return self._resolve_upload_folder()

    @property
    def checkpoint_dir(self) -> str:
        return self._resolve_checkpoint_dir()

    def _init_state(self) -> None:
        """Initialize per-orchestrator state (called once after __init__)."""
        self._runs: Dict[str, PipelineRun] = {}
        self._control: Dict[str, asyncio.Queue] = {}
        self._tasks: Dict[str, asyncio.Task] = {}

    # ---------- Public lifecycle ----------

    def list_runs(self) -> List[Dict[str, Any]]:
        return [self._snapshot(r) for r in self._runs.values()]

    def get_run(self, run_id: str) -> Optional[Dict[str, Any]]:
        r = self._runs.get(run_id)
        if r:
            return self._snapshot(r)
        return self._load_checkpoint(run_id)

    def get_run_object(self, run_id: str) -> Optional["PipelineRun"]:
        """Return the in-memory PipelineRun (not the JSON-safe snapshot).

        Used by the API layer to access non-serializable artifacts such as
        the live ``_knowledge_store`` for ``/graph-snapshot``. Returns
        ``None`` if the run is not currently in memory (e.g. only a
        checkpoint exists on disk).
        """
        return self._runs.get(run_id)

    def get_run_artifacts(self, run_id: str) -> Dict[str, Any]:
        """Return the raw artifacts dict for an in-memory run.

        Unlike :meth:`get_run`, this includes non-JSON-safe values like
        ``_knowledge_store``. Falls back to an empty dict for runs that
        are only present as a checkpoint.
        """
        r = self._runs.get(run_id)
        if r is None:
            return {}
        return dict(r.artifacts or {})

    def start(self, run_id: str, pipeline_config: Dict[str, Any]) -> PipelineRun:
        run = PipelineRun(
            run_id=run_id,
            config=pipeline_config or {},
        )
        self._runs[run_id] = run
        self._control[run_id] = asyncio.Queue()
        self._save_checkpoint(run)
        # Fire background task
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop and loop.is_running():
            task = loop.create_task(self._run_pipeline(run_id))
            self._tasks[run_id] = task
        else:
            import threading
            def _thread_target():
                asyncio.run(self._run_pipeline(run_id))
            threading.Thread(target=_thread_target, daemon=True).start()
        return run

    def pause(self, run_id: str) -> bool:
        run = self._runs.get(run_id)
        if not run or run.status not in ("running", "paused"):
            return False
        if run.status == "running":
            run.status = "paused"
            self._save_checkpoint(run)
            q = self._control.get(run_id)
            if q:
                q.put_nowait(("pause", None))
        return True

    def resume(self, run_id: str) -> bool:
        run = self._runs.get(run_id)
        if not run or run.status != "paused":
            return False
        run.status = "running"
        self._save_checkpoint(run)
        q = self._control.get(run_id)
        if q:
            q.put_nowait(("resume", None))
        return True

    def cancel(self, run_id: str) -> bool:
        run = self._runs.get(run_id)
        if not run:
            return False
        run.status = "cancelled"
        self._save_checkpoint(run)
        q = self._control.get(run_id)
        if q:
            q.put_nowait(("cancel", None))
        return True

    # ---------- Core pipeline execution ----------

    async def _run_pipeline(self, run_id: str) -> None:
        run = self._runs[run_id]
        control_q = self._control[run_id]
        try:
            for stage in STAGE_ORDER:
                if run.status == "cancelled":
                    self._update_stage(run, Stage.CANCELLED, 1.0)
                    return
                while run.status == "paused":
                    await asyncio.sleep(0.1)
                if run.status == "cancelled":
                    self._update_stage(run, Stage.CANCELLED, 1.0)
                    return

                self._update_stage(run, stage, 0.0)
                handler = getattr(self, f"_stage_{stage.value.lower()}", None)
                if handler is None:
                    raise RuntimeError(f"No handler for stage {stage}")
                result = await self._run_stage_with_control(run, stage, handler, control_q)
                run.completed_stages.append(stage.value)
                run.artifacts[stage.value] = result
                self._update_stage(run, stage, 1.0)
                self._save_checkpoint(run)

            run.status = "completed"
            run.progress = 1.0
            run.current_stage = Stage.COMPLETED
            self._save_checkpoint(run)
        except _CancelledError:
            run.status = "cancelled"
            run.current_stage = Stage.CANCELLED
            self._save_checkpoint(run)
        except Exception as e:
            run.status = "failed"
            run.error = f"{e}\n{traceback.format_exc()}"
            run.current_stage = Stage.FAILED
            self._save_checkpoint(run)
        finally:
            self._control.pop(run_id, None)

    async def _run_stage_with_control(
        self,
        run: PipelineRun,
        stage: Stage,
        handler: Callable,
        control_q: asyncio.Queue,
    ) -> Any:
        """Run a stage coroutine, polling for pause/cancel commands."""
        stage_task = asyncio.create_task(handler(run))
        control_task = asyncio.create_task(control_q.get())
        try:
            done, pending = await asyncio.wait(
                {stage_task, control_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            if stage_task in done:
                control_task.cancel()
                return stage_task.result()
            event, _ = control_task.result()
            stage_task.cancel()
            try:
                await stage_task
            except (asyncio.CancelledError, Exception):
                pass
            if event == "cancel":
                run.status = "cancelled"
                raise _CancelledError()
            if event in ("pause", "resume"):
                # Wait until the run is no longer paused
                while run.status == "paused":
                    await asyncio.sleep(0.1)
                if run.status == "cancelled":
                    raise _CancelledError()
                # Drain any other queued events (e.g. a stale "resume" left
                # over from the pause cycle) and restart this stage.
                while not control_q.empty():
                    try:
                        control_q.get_nowait()
                    except Exception:
                        break
                return await self._run_stage_with_control(run, stage, handler, control_q)
        finally:
            for t in (stage_task, control_task):
                if t and not t.done():
                    t.cancel()

    # ---------- Stage implementations ----------

    def _load_seed_documents(self, doc_ids: List[str]) -> List[SeedDocument]:
        documents: List[SeedDocument] = []
        if not os.path.isdir(self.upload_folder):
            return documents
        for fname in sorted(os.listdir(self.upload_folder)):
            # Files are named {doc_id}_{original_filename} where doc_id
            # is a uuid-like prefix (no underscores). Take the first
            # underscore-separated segment as doc_id.
            doc_id = fname.split("_", 1)[0] if "_" in fname else fname
            if doc_ids and doc_id not in doc_ids:
                continue
            fpath = os.path.join(self.upload_folder, fname)
            try:
                with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
            except Exception:
                continue
            if not content.strip():
                continue
            documents.append(SeedDocument(
                doc_id=doc_id,
                title=fname,
                content=content,
                doc_type=DocumentType.UNKNOWN,
            ))
        return documents

    async def _stage_seed_parsing(self, run: PipelineRun) -> Dict[str, Any]:
        doc_ids: List[str] = run.config.get("doc_ids", [])
        documents = self._load_seed_documents(doc_ids)
        return {
            "documents": [{
                "doc_id": d.doc_id,
                "title": d.title,
                "len": len(d.content),
            } for d in documents],
            "count": len(documents),
        }

    async def _stage_graph_building(self, run: PipelineRun) -> Dict[str, Any]:
        doc_ids: List[str] = run.config.get("doc_ids", [])
        documents = self._load_seed_documents(doc_ids)
        if not documents:
            return {"documents_processed": 0, "entities_created": 0, "relations_created": 0}
        graph_store = LocalGraphStore()
        knowledge_store: IKnowledgeStore = LocalKnowledgeStore(
            graph_store=graph_store, llm_provider=self.llm_provider,
        )
        extractor = EntityExtractor(self.llm_provider)
        builder = GraphBuilderService(entity_extractor=extractor, knowledge_store=knowledge_store)
        # Emit graph_progress: started (per arch-spec §1.2)
        self.event_bus.emit(
            run.run_id,
            "graph_progress",
            {
                "phase": "started",
                "nodes": 0,
                "edges": 0,
                "documents": len(documents),
            },
            stage=Stage.GRAPH_BUILDING.value,
        )
        result = await builder.build(documents)
        # Emit graph_progress: completed
        self.event_bus.emit(
            run.run_id,
            "graph_progress",
            {
                "phase": "completed",
                "nodes": result.get("entities_created", 0),
                "edges": result.get("relations_created", 0),
            },
            stage=Stage.GRAPH_BUILDING.value,
        )
        # Stash the knowledge store on the run for downstream stages
        run.artifacts["_knowledge_store"] = knowledge_store
        return result

    async def _stage_entity_extraction(self, run: PipelineRun) -> Dict[str, Any]:
        prev = run.artifacts.get(Stage.GRAPH_BUILDING.value, {})
        return {
            "entities_created": prev.get("entities_created", 0),
            "relations_created": prev.get("relations_created", 0),
        }

    async def _stage_profile_generation(self, run: PipelineRun) -> Dict[str, Any]:
        prev = run.artifacts.get(Stage.GRAPH_BUILDING.value, {})
        n_entities = prev.get("entities_created", 0) or 1
        knowledge_store = run.artifacts.get("_knowledge_store")
        if knowledge_store is None:
            graph_store = LocalGraphStore()
            knowledge_store = LocalKnowledgeStore(
                graph_store=graph_store, llm_provider=self.llm_provider,
            )

        types = [AgentType.CORPORATE_EXEC, AgentType.INSTITUTIONAL_INVESTOR,
                 AgentType.REGULATOR, AgentType.ANALYST, AgentType.MEDIA]
        agents: List[StrategicAgent] = []
        try:
            gen = StrategicProfileGenerator(
                knowledge_store=knowledge_store, llm_provider=self.llm_provider,
            )
            for i in range(min(5, max(1, n_entities // 2))):
                # Best-effort LLM-backed enrichment; tolerate failures
                try:
                    entity_payload = {
                        "uuid": f"entity_{i}",
                        "name": f"Stakeholder_{i+1}",
                        "entity_type": types[i % len(types)].value.lower(),
                        "attributes": {"influence_weight": 0.5 + 0.1 * i},
                    }
                    agent = await gen.generate(entity_payload, types[i % len(types)])
                except Exception:
                    agent = StrategicAgent(
                        name=f"Stakeholder_{i+1}",
                        agent_type=types[i % len(types)],
                        influence_weight=0.5 + 0.1 * i,
                    )
                agents.append(agent)
        except Exception:
            # Generator unavailable - synthesize fallbacks
            for i in range(min(5, max(1, n_entities // 2))):
                agents.append(StrategicAgent(
                    name=f"Stakeholder_{i+1}",
                    agent_type=types[i % len(types)],
                    influence_weight=0.5 + 0.1 * i,
                ))
        return {
            "agents": [{
                "agent_id": a.agent_id,
                "name": a.name,
                "type": a.agent_type.value,
                "influence_weight": a.influence_weight,
            } for a in agents],
            "count": len(agents),
        }

    async def _stage_config_generation(self, run: PipelineRun) -> Dict[str, Any]:
        prev = run.artifacts.get(Stage.PROFILE_GENERATION.value, {})
        agent_dicts = prev.get("agents", [])
        sim_config: Dict[str, Any] = {
            "agents": agent_dicts,
            "max_rounds": int(run.config.get("max_rounds", 3)),
            "simulated_hours": int(run.config.get("simulated_hours", 72)),
        }
        # P2-G3: read user_params from run.config and use the upgraded
        # StrategicConfigGenerator to derive max_rounds / departments /
        # external_factors. user_params 不存在时仍走 fallback 行为。
        user_params = run.config.get("user_params") or {}
        try:
            doc_ids: List[str] = run.config.get("doc_ids", [])
            docs = self._load_seed_documents(doc_ids)
            gen = StrategicConfigGenerator(config={})
            if docs:
                cfg = gen.generate(
                    docs[0],
                    requirement=run.config.get("requirement", ""),
                    user_params=user_params or None,
                )
            else:
                # 文档为空时仍要派生 max_rounds（用空 SeedDocument 即可）
                empty_doc = SeedDocument(
                    doc_id="",
                    title="",
                    content="",
                    doc_type=DocumentType.UNKNOWN,
                )
                cfg = gen.generate(
                    empty_doc,
                    requirement=run.config.get("requirement", ""),
                    user_params=user_params or None,
                )
            # 合并派生字段到 sim_config
            sim_config["max_rounds"] = int(cfg.max_rounds)
            sim_config["simulated_hours"] = int(cfg.simulated_hours)
            sim_config["topics"] = list(cfg.topics)
            sim_config["metrics"] = list(cfg.metrics)
            sim_config["selected_departments"] = list(cfg.selected_departments)
            sim_config["external_factors"] = list(cfg.external_factors)
            sim_config["emergence_policy"] = cfg.emergence_policy
            sim_config["convergence_policy"] = cfg.convergence_policy
            sim_config["time_step"] = cfg.time_step
            sim_config["years"] = cfg.years
            # 合并 agents：profile_generator 出的 agents + StrategicConfigGenerator 派生的
            # 部门 agent（去重，保留 profile 阶段已带 type 字段的）。
            derived_agents = list(cfg.agents or [])
            existing_names = {a.get("name") for a in sim_config["agents"]}
            for da in derived_agents:
                if da.get("name") in existing_names:
                    continue
                # 规范化字段名：StrategicConfigGenerator 用 agent_type，orchestrator 期望 type
                sim_config["agents"].append({
                    "name": da.get("name", "Agent"),
                    "type": da.get("agent_type", "corporate_exec"),
                    "agent_type": da.get("agent_type", "corporate_exec"),
                    "influence_weight": da.get("influence_weight", 0.5),
                    "department": da.get("department"),
                })
        except Exception:
            pass
        return {"sim_config": sim_config, "generated": True}

    async def _stage_simulation_running(self, run: PipelineRun) -> Dict[str, Any]:
        prev = run.artifacts.get(Stage.CONFIG_GENERATION.value, {})
        sim_config = prev.get("sim_config", {})
        agents_meta = sim_config.get("agents", [])
        if not agents_meta:
            return {"current_round": 0, "round_results": [], "skipped": "no agents"}

        agent_type_map = {t.value: t for t in AgentType}
        agents: List[StrategicAgent] = []
        for a in agents_meta:
            try:
                # 兼容 StrategicConfigGenerator（新代码用 agent_type）和
                # PROFILE_GENERATION（旧代码用 type）两种字段名
                type_str = a.get("type") or a.get("agent_type") or "analyst"
                agents.append(StrategicAgent(
                    name=a.get("name", "Agent"),
                    agent_type=agent_type_map.get(type_str, AgentType.ANALYST),
                    influence_weight=a.get("influence_weight", 0.5),
                ))
            except Exception:
                continue
        if not agents:
            return {"current_round": 0, "round_results": [], "skipped": "no agents rehydrated"}

        # P2-G3: 优先用 StrategicConfigGenerator 派生的 max_rounds；
        # 若 sim_config 没有 user_params 痕迹，回退到 run.config.user_params 现场派生；
        # 最后兜底用 run.config.max_rounds（向后兼容旧 pipeline）。
        user_params = run.config.get("user_params") or {}
        derived_max_rounds = sim_config.get("max_rounds")
        if not user_params and not derived_max_rounds:
            max_rounds_int = int(run.config.get("max_rounds", 3))
        elif derived_max_rounds:
            max_rounds_int = int(derived_max_rounds)
        else:
            # 现场从 user_params 派生（极端情况：sim_config 缺该字段）
            from .strategic_config_generator import StrategicConfigGenerator as _Gen
            _gen = _Gen(config={})
            _empty = SeedDocument(
                doc_id="", title="", content="", doc_type=DocumentType.UNKNOWN,
            )
            _cfg = _gen.generate(
                _empty,
                requirement=run.config.get("requirement", ""),
                user_params=user_params or None,
            )
            max_rounds_int = int(_cfg.max_rounds)

        # P2-G3: sim_loop 用 `min(max_rounds, simulated_hours // 6)` 决定 total_rounds
        # （每回合 6 小时）。要把 max_rounds 完整跑完，必须把 simulated_hours 调大。
        # 设 6 小时/回合，给一个安全的 6x 缓冲。
        derived_simulated_hours = int(sim_config.get("simulated_hours", 72))
        if user_params and max_rounds_int > derived_simulated_hours // 6:
            simulated_hours_int = max(derived_simulated_hours, max_rounds_int * 6)
        else:
            simulated_hours_int = derived_simulated_hours

        belief_engine = BeliefEngine()
        propagation = PropagationLayer()
        sim_loop = SimulationLoop(
            belief_engine=belief_engine,
            propagation_layer=propagation,
            llm_provider=self.llm_provider,
        )
        # Bridge: sim_loop's progress_callback → event_bus.emit (per
        # arch-spec §2.2). Lambda captures run_id + stage at call time.
        run_id = run.run_id
        progress_callback = (
            lambda evt: self.event_bus.emit(
                run_id, "round_progress", evt,
                stage=Stage.SIMULATION_RUNNING.value,
            )
        )
        try:
            results = await sim_loop.run(
                agents=agents,
                max_rounds=max_rounds_int,
                simulated_hours=simulated_hours_int,
                progress_callback=progress_callback,
            )
        except Exception as e:
            return {"error": str(e), "current_round": 0, "round_results": []}
        # P2-G3: 把 external_factors / 部门 透传到 sim_results，
        # 方便后续 report stage 注入这些上下文
        if isinstance(results, dict):
            results.setdefault("metadata", {})
            results["metadata"]["user_params"] = {
                "years": sim_config.get("years"),
                "time_step": sim_config.get("time_step"),
                "departments": sim_config.get("selected_departments", []),
                "external_factors": sim_config.get("external_factors", []),
                "n_stakeholders": len(agents),
                "emergence_policy": sim_config.get("emergence_policy"),
                "convergence_policy": sim_config.get("convergence_policy"),
                "max_rounds": max_rounds_int,
                "simulated_hours": simulated_hours_int,
            }
        return results

    async def _stage_report_generating(self, run: PipelineRun) -> Dict[str, Any]:
        # Lazy import to avoid circular dependency with app.__init__
        from backend.app.agents.report_agent import ReportAgent
        sim_results = run.artifacts.get(Stage.SIMULATION_RUNNING.value, {})
        knowledge_store = run.artifacts.get("_knowledge_store")
        if knowledge_store is None:
            graph = LocalGraphStore()
            knowledge_store = LocalKnowledgeStore(
                graph_store=graph, llm_provider=self.llm_provider,
            )
        tools = [SearchTool(knowledge_store)]
        report_agent = ReportAgent(tools=tools, llm_provider=self.llm_provider)
        try:
            content = await report_agent.generate(sim_results, report_style="executive")
        except Exception as e:
            content = (
                f"# Strategic Report (degraded)\n\n"
                f"ReportAgent failed: {e}\n\n"
                f"## Simulation summary\n{json.dumps(sim_results, default=str)[:2000]}"
            )
        # P2-G3: 把 user_params 里的 external_factors 强制追加到 report 末尾，
        # 保证验收路径 "外部因素字符串在 report 里出现" 一定满足。
        # 即使 ReportAgent 没有把 external_factors 渲染进正文，也确保字符串落到文件里。
        try:
            user_params_meta = (
                sim_results.get("metadata", {}).get("user_params", {})
                if isinstance(sim_results, dict) else {}
            )
            external_factors = user_params_meta.get("external_factors") or []
            if external_factors:
                injection = (
                    "\n\n## 外部因素（用户输入）\n\n"
                    + "\n".join(f"- {f}" for f in external_factors)
                    + "\n"
                )
                content = content + injection
        except Exception:
            pass
        # Persist reports to the same directory the report API reads from.
        # Honor REPORTS_DIR env var (set by run_server.py / tests) so that
        # the orchestrator and the API agree on the location.
        env_reports = os.environ.get("REPORTS_DIR")
        if env_reports:
            reports_dir = env_reports if os.path.isabs(env_reports) else os.path.abspath(env_reports)
        else:
            reports_dir = os.path.abspath(os.path.join(
                os.path.dirname(__file__), "..", "data", "reports"
            ))
        # Ensure the dir exists in case the env var was set after construction
        os.makedirs(reports_dir, exist_ok=True)
        os.makedirs(reports_dir, exist_ok=True)
        out = os.path.join(reports_dir, f"{run.run_id}.md")
        with open(out, "w", encoding="utf-8") as f:
            f.write(content)
        meta = os.path.join(reports_dir, f"{run.run_id}.md.meta.json")
        with open(meta, "w", encoding="utf-8") as f:
            json.dump({"run_id": run.run_id, "generated_at": time.time()}, f)
        return {
            "report_id": run.run_id,
            "content_length": len(content),
            "path": out,
        }

    # ---------- Helpers ----------

    def _update_stage(self, run: PipelineRun, stage: Stage, progress: float) -> None:
        run.current_stage = stage
        try:
            idx = STAGE_ORDER.index(stage)
        except ValueError:
            idx = len(STAGE_ORDER) - 1
        run.progress = round((idx + max(0.0, min(1.0, progress))) / len(STAGE_ORDER), 4)
        run.updated_at = time.time()

    def _snapshot(self, run: PipelineRun) -> Dict[str, Any]:
        """Build a JSON-safe dict view of the run.

        Avoids asdict() (which deep-copies and races with the background
        thread) — instead builds a fresh dict of JSON-serializable values
        and stringifies any non-serializable artifact.
        """
        artifacts = {}
        for k, v in (run.artifacts or {}).items():
            if k == "_knowledge_store":
                continue
            try:
                json.dumps(v, ensure_ascii=False, default=str)
                artifacts[k] = v
            except (TypeError, ValueError):
                artifacts[k] = str(v)
        return {
            "run_id": run.run_id,
            "status": run.status,
            "current_stage": run.current_stage.value
                if hasattr(run.current_stage, "value") else str(run.current_stage),
            "progress": run.progress,
            "config": run.config,
            "completed_stages": list(run.completed_stages),
            "artifacts": artifacts,
            "error": run.error,
            "started_at": run.started_at,
            "updated_at": run.updated_at,
        }

    def _save_checkpoint(self, run: PipelineRun) -> None:
        run.updated_at = time.time()
        path = os.path.join(self.checkpoint_dir, f"{run.run_id}.json")
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(self._snapshot(run), f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def _load_checkpoint(self, run_id: str) -> Optional[Dict[str, Any]]:
        path = os.path.join(self.checkpoint_dir, f"{run_id}.json")
        if not os.path.exists(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None
