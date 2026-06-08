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
from typing import Any, Callable, Dict, List, Optional, Tuple


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
from backend.services.market_environment import (
    MarketEnvironmentAgent,
    MARKET_CYCLE_LABELS_CN,
    POLICY_STANCE_LABELS_CN,
)
from backend.services.external_shock_simulator import (
    ExternalShockSimulator,
    ShockType,
)
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


# ---------------------------------------------------------------------------
# should-tier: belief_shift 聚合 + 节流 emit
# ---------------------------------------------------------------------------
# 立场漂移阈值: |new_value - old_value| 大于该值才算 "shift" (而非微小波动)
BELIEF_SHIFT_THRESHOLD: float = 0.10
# belief_shift 事件 emit 节流窗口 (秒): 同一 (round, agent) 在窗口内重复时跳过
BELIEF_SHIFT_THROTTLE_SEC: float = 0.5
# 进程内最近 emit 时刻字典: key=(round, agent_id) → ts
_belief_shift_last_emit: Dict[Tuple[int, str], float] = {}


def _classify_belief_shift(update: Dict[str, Any]) -> float:
    """从 belief_update dict 中提取 magnitude (|new_value - old_value|) — 用于 shift 判定.

    兼容多种字段名 (旧版 BeliefUpdate / 新版 简化 dict / 浮点 position 字段):
      - 优先取 position_delta / delta / shift
      - 否则尝试从 old_position / new_position 计算
      - 都没有则返回 0 (视为非 shift)
    """
    try:
        for key in ("position_delta", "delta", "shift"):
            v = update.get(key)
            if isinstance(v, (int, float)):
                return abs(float(v))
        old_v = update.get("old_position")
        new_v = update.get("new_position")
        if isinstance(old_v, (int, float)) and isinstance(new_v, (int, float)):
            return abs(float(new_v) - float(old_v))
    except Exception:
        return 0.0
    return 0.0


def _aggregate_belief_shift_count(belief_updates: List[Any]) -> int:
    """统计本轮 belief_updates 中 magnitude > 阈值的数量 — 填入 SimRound.belief_shift_count."""
    if not belief_updates:
        return 0
    n = 0
    for u in belief_updates:
        if not isinstance(u, dict):
            continue
        if _classify_belief_shift(u) > BELIEF_SHIFT_THRESHOLD:
            n += 1
    return n


def _emit_belief_shifts(
    event_bus: EventBus,
    run_id: str,
    round_num: int,
    belief_updates: List[Any],
    now: Optional[float] = None,
) -> int:
    """Emit belief_shift 事件 — 同一 (round, agent_id) 在节流窗口内最多 1 条.

    Returns: 实际 emit 的事件数.
    """
    if not belief_updates:
        return 0
    cur = now if now is not None else time.time()
    n_emitted = 0
    for u in belief_updates:
        if not isinstance(u, dict):
            continue
        magnitude = _classify_belief_shift(u)
        if magnitude <= BELIEF_SHIFT_THRESHOLD:
            continue
        agent_id = str(
            u.get("agent_id")
            or u.get("target_id")
            or u.get("entity_id")
            or ""
        )
        if not agent_id:
            continue
        # 节流: 同一 (round, agent) 在窗口内已发过则跳过
        key = (round_num, agent_id)
        last_ts = _belief_shift_last_emit.get(key, 0.0)
        if cur - last_ts < BELIEF_SHIFT_THROTTLE_SEC:
            continue
        _belief_shift_last_emit[key] = cur
        try:
            old_v = u.get("old_position")
            new_v = u.get("new_position")
            topic = u.get("topic") or u.get("update_source") or "belief"
            event_bus.emit(
                run_id, "belief_shift", {
                    "round": round_num,
                    "agent_id": agent_id,
                    "topic": topic,
                    "old_value": old_v if isinstance(old_v, (int, float)) else None,
                    "new_value": new_v if isinstance(new_v, (int, float)) else None,
                    "delta": magnitude,
                    "magnitude": magnitude,
                    "ts": cur,
                },
                stage=Stage.SIMULATION_RUNNING.value,
            )
            n_emitted += 1
        except Exception:
            # 单条失败不影响其他 shift
            pass
    # 定期清理过期的 throttle 记录 (避免内存泄漏)
    if len(_belief_shift_last_emit) > 1000:
        cutoff = cur - 60.0
        stale = [k for k, v in _belief_shift_last_emit.items() if v < cutoff]
        for k in stale:
            _belief_shift_last_emit.pop(k, None)
    return n_emitted


def reset_belief_shift_throttle() -> None:
    """测试用: 清空节流记录."""
    _belief_shift_last_emit.clear()


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
        # Per-instance event bus (defaults to module singleton so the SSE
        # endpoint in backend.app.api.pipeline (which subscribes to the
        # module-level ``event_bus``) sees frames emitted here. Tests can
        # still inject their own ``event_bus`` for isolation.
        if event_bus is not None:
            self.event_bus: EventBus = event_bus
        else:
            from backend.services.event_bus import event_bus as _global_bus
            self.event_bus = _global_bus
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

    def delete_run(self, run_id: str) -> bool:
        """Delete a run completely: in-memory state + on-disk checkpoint.

        - 不能删正在跑的 (status in {running, paused}) — 返回 False
        - 取消控制队列 + 取消 task (如果存在)
        - 删 self._runs[run_id] + 删 <run_id>.json
        """
        run = self._runs.get(run_id)
        if run and run.status in ("running", "paused"):
            return False  # 正在跑的不能直接删, 需先 cancel

        # 取消 task (best-effort, 防止后台线程还在写 checkpoint)
        task = self._tasks.pop(run_id, None)
        if task and not task.done():
            try:
                task.cancel()
            except Exception:
                pass

        # 清 control queue
        self._control.pop(run_id, None)

        # 删内存状态
        self._runs.pop(run_id, None)

        # 删磁盘 checkpoint
        try:
            path = os.path.join(self.checkpoint_dir, f"{run_id}.json")
            if os.path.isfile(path):
                os.remove(path)
        except OSError:
            pass  # 磁盘已删就当成功

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
        # should-tier v3: wire progress_callback so graph_builder_service
        # can emit entity_emerged per new entity. Callback failure must not
        # break the build pipeline, so wrap in try/except.
        def _on_entity_emerged(payload: Dict[str, Any]) -> None:
            try:
                self.event_bus.emit(
                    run.run_id,
                    "entity_emerged",
                    payload,
                    stage=Stage.GRAPH_BUILDING.value,
                )
            except Exception:
                # Swallow: callback failure must not break pipeline
                pass
        result = await builder.build(documents, progress_callback=_on_entity_emerged)
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

        # P2-G3 remainder: append 3 ANALYST slot agents per department so
        # the PROFILE artifact reflects the user-supplied departments.
        # Stable id "{dept}_slot_{i}" lets the report/UI reference them.
        user_params = run.config.get("user_params") or {}
        departments = user_params.get("departments") or []
        for dept in departments:
            for slot in range(3):
                agents.append(StrategicAgent(
                    name=f"{dept}-Analyst-{slot+1}",
                    agent_type=AgentType.ANALYST,
                    influence_weight=0.5,
                ))

        # Serialise agents. Department slot agents (the last 3*|departments|
        # entries) get a "department" field plus a stable "id" tag.
        slot_offset = len(agents) - 3 * len(departments)
        agent_dicts: List[Dict[str, Any]] = []
        for idx, a in enumerate(agents):
            d: Dict[str, Any] = {
                "agent_id": a.agent_id,
                "name": a.name,
                "type": a.agent_type.value,
                "influence_weight": a.influence_weight,
            }
            if idx >= slot_offset and departments:
                slot_idx = idx - slot_offset
                dept = departments[slot_idx // 3]
                d["department"] = dept
                d["id"] = f"{dept}_slot_{slot_idx % 3}"
            agent_dicts.append(d)

        return {
            "agents": agent_dicts,
            "count": len(agents),
        }

    async def _stage_config_generation(self, run: PipelineRun) -> Dict[str, Any]:
        prev = run.artifacts.get(Stage.PROFILE_GENERATION.value, {})
        agent_dicts = prev.get("agents", [])

        # P2-G3: 先用 user_params 派生 max_rounds（如果 user_params 存在）
        user_params = run.config.get("user_params") or {}
        if user_params:
            years = int(user_params.get("years", 1))
            time_step = user_params.get("time_step", "month")
            step_mult = {"year": 1, "quarter": 4, "month": 12}.get(time_step, 12)
            max_rounds = years * step_mult
        else:
            max_rounds = int(run.config.get("max_rounds", 3))

        # P4 LOOP: 多年推演需要保证 simulated_hours >= max_rounds * hours_per_round
        # 默认 hours_per_round=6，max_rounds=36 (3年×12月) → simulated_hours 至少 216
        hours_per_round = 6  # 与 SimulationLoop 默认一致
        min_sim_hours = max_rounds * hours_per_round
        sim_hours_cfg = int(run.config.get("simulated_hours", 72))
        sim_config: Dict[str, Any] = {
            "agents": agent_dicts,
            "max_rounds": max_rounds,
            "simulated_hours": max(sim_hours_cfg, min_sim_hours),
            "user_params": user_params,  # 透传给下游
        }
        # Best-effort use of StrategicConfigGenerator on a synthesized seed doc
        try:
            doc_ids: List[str] = run.config.get("doc_ids", [])
            docs = self._load_seed_documents(doc_ids)
            if docs:
                gen = StrategicConfigGenerator(config={})
                cfg = gen.generate(
                    docs[0],
                    requirement=run.config.get("requirement", ""),
                    user_params=user_params or None,
                )
                sim_config["topics"] = cfg.topics
                sim_config["metrics"] = cfg.metrics
                # P2-G3 关键：把派生 max_rounds / agents 写回 sim_config
                if cfg.max_rounds and cfg.max_rounds > sim_config.get("max_rounds", 0):
                    sim_config["max_rounds"] = cfg.max_rounds
                if cfg.agents:
                    sim_config["agents"] = [
                        a if isinstance(a, dict) else {
                            "agent_type": getattr(a, "agent_type", "ANALYST"),
                            "id": getattr(a, "id", "agent"),
                            "name": getattr(a, "name", ""),
                        }
                        for a in cfg.agents
                    ]
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
                agents.append(StrategicAgent(
                    name=a.get("name", "Agent"),
                    agent_type=agent_type_map.get(a.get("type"), AgentType.ANALYST),
                    influence_weight=a.get("influence_weight", 0.5),
                ))
            except Exception:
                continue
        if not agents:
            return {"current_round": 0, "round_results": [], "skipped": "no agents rehydrated"}

        belief_engine = BeliefEngine()
        propagation = PropagationLayer()
        sim_loop = SimulationLoop(
            belief_engine=belief_engine,
            propagation_layer=propagation,
            llm_provider=self.llm_provider,
        )
        # P4 LOOP: 接入 MarketEnvironmentAgent（每 4 轮季度演化）+ ExternalShockSimulator（每 3 轮按用户外部因素注入）
        # 设计目标：MiroFish 风格"按年份循环迭代 + 内外部环境变化"
        user_params = run.config.get("user_params") or {}
        industry = (
            run.config.get("industry")
            or user_params.get("industry")
            or "digital_service"
        )
        market_env = MarketEnvironmentAgent()
        external_factors = user_params.get("external_factors") or []
        shock_sim = ExternalShockSimulator(config={"base_probability": 0.1})

        run_id = run.run_id

        def _emit_market_event(quarter: int, snapshot: Dict[str, Any]) -> None:
            """Emit a market_event SSE frame with the freshly-evolved indicators."""
            cycle_cn = snapshot.get("cycle_label_cn") or MARKET_CYCLE_LABELS_CN.get(
                snapshot.get("current_cycle", ""), ""
            )
            stance_cn = POLICY_STANCE_LABELS_CN.get(
                snapshot.get("policy_stance", ""), ""
            )
            self.event_bus.emit(
                run_id, "market_event", {
                    "quarter": quarter,
                    "fiscal_year_offset": snapshot.get("fiscal_year_offset", 0),
                    "industry": industry,
                    "sector_growth_rate": round(snapshot.get("sector_growth_rate", 0.0), 4),
                    "policy_stance": snapshot.get("policy_stance", ""),
                    "policy_stance_cn": stance_cn,
                    "policy_pressure": round(snapshot.get("policy_pressure", 0.0), 3),
                    "capital_availability": round(snapshot.get("capital_availability", 0.0), 3),
                    "consumer_sentiment": round(snapshot.get("consumer_sentiment", 0.0), 3),
                    "current_cycle": snapshot.get("current_cycle", ""),
                    "cycle_label_cn": cycle_cn,
                    "msg_cn": f"市场事件 Q{quarter}: 行业增速 {snapshot.get('sector_growth_rate', 0) * 100:+.1f}% / 周期 {cycle_cn} / 政策 {stance_cn}",
                },
                stage=Stage.SIMULATION_RUNNING.value,
            )

        def _emit_shock_injected(round_num: int, factor: str, shock) -> None:
            """Emit a shock_injected SSE frame when an external factor triggers a shock."""
            try:
                shock_dict = shock.to_dict() if hasattr(shock, "to_dict") else dict(shock)
            except Exception:
                shock_dict = {"shock_type": str(getattr(shock, "shock_type", "UNKNOWN"))}
            self.event_bus.emit(
                run_id, "shock_injected", {
                    "round": round_num,
                    "factor": factor,
                    "shock": shock_dict,
                    "msg_cn": f"外部冲击 R{round_num}（{factor[:20]}）: {shock_dict.get('shock_type', '')}",
                },
                stage=Stage.SIMULATION_RUNNING.value,
            )

        def _on_progress(evt: Dict[str, Any]) -> None:
            """progress_callback: emit round_progress + per-N-round market/shock side effects."""
            try:
                round_num = int(evt.get("round") or 0)
            except Exception:
                round_num = 0
            # 0) Emit round_started (新事件) — 每轮开始时让前端 banner 闪现
            # 注意: progress_callback 在每轮 done 后才触发, 故此事件在每轮结束时发送
            # 用于驱动"Round N 完成"提示 (区别于 round_completed 的"快照"语义)
            # 1) Always emit round_progress (back-compat — 含 progress 字段)
            try:
                self.event_bus.emit(
                    run_id, "round_progress", evt,
                    stage=Stage.SIMULATION_RUNNING.value,
                )
            except Exception:
                pass  # never let SSE emit failure break simulation

            # 2) Emit round_completed (新事件 — 不带 progress 字段, 仅快照)
            # payload: {round, total_rounds, actions_count, belief_updates_count,
            #           belief_shift_count, propagation_events_count, new_entities, new_relations, ts}
            belief_updates_list = evt.get("belief_updates") or []
            belief_shift_count = _aggregate_belief_shift_count(belief_updates_list)
            try:
                rc_payload: Dict[str, Any] = {
                    "round": round_num,
                    "total_rounds": evt.get("total_rounds"),
                    "actions_count": len(evt.get("actions") or []),
                    "belief_updates_count": len(belief_updates_list),
                    "belief_shift_count": belief_shift_count,
                    "propagation_events_count": len(evt.get("propagation_events") or []),
                    "actions": evt.get("actions"),
                    "belief_updates": belief_updates_list,
                    "propagation_events": evt.get("propagation_events"),
                    "new_entities": evt.get("new_entities"),
                    "new_relations": evt.get("new_relations"),
                    "ts": time.time(),
                }
                self.event_bus.emit(
                    run_id, "round_completed", rc_payload,
                    stage=Stage.SIMULATION_RUNNING.value,
                )
            except Exception:
                pass  # never let SSE emit failure break simulation

            # 2.5) Emit belief_shift (新事件 — 每条 belief shift 一帧, 节流到 500ms 内最多 1 条)
            # 前端 BeliefShiftFeed 消费; SimRound.belief_shift_count 字段填充靠上方聚合
            try:
                _emit_belief_shifts(
                    self.event_bus, run_id, round_num, belief_updates_list,
                )
            except Exception:
                pass

            # 3) Emit round_started (新事件 — 用于下一轮的 banner 闪现)
            # 与 round_completed 配对 — 一个回合"开始/完成"双通知
            try:
                if round_num > 0:
                    self.event_bus.emit(
                        run_id, "round_started", {
                            "round": round_num,
                            "total_rounds": evt.get("total_rounds"),
                            "ts": time.time(),
                        },
                        stage=Stage.SIMULATION_RUNNING.value,
                    )
            except Exception:
                pass

            # 4) P4 LOOP: 每 4 轮演化一次市场（季度）
            if round_num > 0 and round_num % 4 == 0:
                try:
                    market_env.evolve_quarter()
                    snap = market_env.snapshot()
                    _emit_market_event(market_env.fiscal_quarter, snap)
                except Exception:
                    # Never let a market-evolution failure break the simulation
                    pass
            # 5) P4 LOOP: 每 3 轮 + 外部因素非空 → 注入 shock
            if (
                round_num > 0
                and round_num % 3 == 0
                and external_factors
            ):
                # Round-robin: 同一个 factor 在不同 R 注入
                factor = external_factors[(round_num // 3 - 1) % len(external_factors)]
                try:
                    shock = shock_sim.inject_shock(
                        context={"agents": agents, "round": round_num, "factor": factor},
                        probability=1.0,  # 用户显式提供 → 必触发
                        round_num=round_num,
                    )
                    if shock is not None:
                        _emit_shock_injected(round_num, factor, shock)
                except Exception:
                    pass

        try:
            results = await sim_loop.run(
                agents=agents,
                max_rounds=int(sim_config.get("max_rounds", 3)),
                simulated_hours=int(sim_config.get("simulated_hours", 72)),
                progress_callback=_on_progress,
            )
        except Exception as e:
            return {"error": str(e), "current_round": 0, "round_results": []}
        # Persist latest market snapshot on the run for cross-year / hydrate use
        try:
            run.artifacts["_market_env_snapshot"] = market_env.snapshot()
        except Exception:
            pass
        return results

    # ---------- P4 LOOP: 跨年推演（再推 1 年） ----------

    def advance_year(
        self,
        run_id: str,
        year_offset: int = 1,
    ) -> Dict[str, Any]:
        """
        Run an additional ``year_offset`` year(s) (default 1) on top of a
        previously-completed/failed run. Reuses the checkpoint + artifacts
        to keep the existing graph + agents; emits ``year_advanced`` and
        additional ``market_event`` / ``shock_injected`` events through
        the event bus.

        Spec: G5 (MiroFish loop) — POST /api/pipeline/<id>/advance-year
        """
        run = self._runs.get(run_id)
        if run is None:
            # 尝试从磁盘 checkpoint 恢复
            ckpt = self._load_checkpoint(run_id)
            if not ckpt:
                return {"error": "Run not found", "run_id": run_id}
            # 重建一个内存 run（status 设为 failed 以便 advance_year 启动）
            run = PipelineRun(
                run_id=run_id,
                status="failed",
                config=ckpt.get("config") or {},
            )
            run.artifacts = ckpt.get("artifacts") or {}
            run.completed_stages = list(ckpt.get("completed_stages") or [])
            self._runs[run_id] = run
        if run.status not in ("completed", "failed"):
            return {
                "error": f"Cannot advance year from status={run.status}; need completed/failed",
                "run_id": run_id,
            }

        # 计算本轮再推 1 年的回合数（12 月 + 1 年）
        user_params = run.config.get("user_params") or {}
        time_step = user_params.get("time_step", "month")
        per_year = {"year": 1, "quarter": 4, "month": 12}.get(time_step, 12)
        rounds_to_run = per_year * max(1, int(year_offset))

        # 准备 control queue（与正常 start 路径相同），并重置 status
        import asyncio
        run.status = "running"
        run.error = None
        try:
            self._control[run_id] = asyncio.Queue()
        except RuntimeError:
            # No running loop in this thread — fall back to a thread
            import threading
            def _thread_target():
                asyncio.run(self._advance_year_run(run_id, rounds_to_run))
            threading.Thread(target=_thread_target, daemon=True).start()
            return {
                "run_id": run_id,
                "year_offset": year_offset,
                "rounds_to_run": rounds_to_run,
                "status": "running",
                "message": "advance-year kicked off in background thread",
            }

        # Run on the existing event loop if possible
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop and loop.is_running():
            task = loop.create_task(self._advance_year_run(run_id, rounds_to_run))
            self._tasks[run_id] = task
        else:
            import threading
            def _thread_target():
                asyncio.run(self._advance_year_run(run_id, rounds_to_run))
            threading.Thread(target=_thread_target, daemon=True).start()

        return {
            "run_id": run_id,
            "year_offset": year_offset,
            "rounds_to_run": rounds_to_run,
            "status": "running",
            "message": f"再推 {year_offset} 年（{rounds_to_run} 回合）已启动",
        }

    async def _advance_year_run(self, run_id: str, rounds_to_run: int) -> None:
        """Internal: actually run the additional rounds for advance-year."""
        run = self._runs.get(run_id)
        if run is None:
            return
        try:
            # 优先复用上一次 SIMULATION_RUNNING 结果的 agents / config
            sim_artifact = run.artifacts.get(Stage.SIMULATION_RUNNING.value) or {}
            sim_config = (sim_artifact.get("sim_config")
                          or run.artifacts.get(Stage.CONFIG_GENERATION.value, {}).get("sim_config")
                          or {})
            agents_meta = sim_config.get("agents") or []
            if not agents_meta:
                raise RuntimeError("No agents in stored config; cannot advance year")

            agent_type_map = {t.value: t for t in AgentType}
            agents: List[StrategicAgent] = []
            for a in agents_meta:
                try:
                    agents.append(StrategicAgent(
                        name=a.get("name", "Agent"),
                        agent_type=agent_type_map.get(a.get("type"), AgentType.ANALYST),
                        influence_weight=a.get("influence_weight", 0.5),
                    ))
                except Exception:
                    continue
            if not agents:
                raise RuntimeError("No agents rehydrated for advance-year")

            belief_engine = BeliefEngine()
            propagation = PropagationLayer()
            sim_loop = SimulationLoop(
                belief_engine=belief_engine,
                propagation_layer=propagation,
                llm_provider=self.llm_provider,
            )

            # 复用 _stage_simulation_running 中的市场环境 + shock 接线
            user_params = run.config.get("user_params") or {}
            industry = (
                run.config.get("industry")
                or user_params.get("industry")
                or "digital_service"
            )
            market_env = MarketEnvironmentAgent()
            # Restore prior snapshot if any
            prior_snap = run.artifacts.get("_market_env_snapshot")
            if isinstance(prior_snap, dict):
                try:
                    market_env.sector_growth_rate = prior_snap.get("sector_growth_rate", market_env.sector_growth_rate)
                    market_env.cycle_position = prior_snap.get("cycle_position", market_env.cycle_position)
                    market_env.fiscal_quarter = prior_snap.get("fiscal_quarter", market_env.fiscal_quarter)
                    market_env.fiscal_year_offset = prior_snap.get("fiscal_year_offset", market_env.fiscal_year_offset)
                except Exception:
                    pass
            external_factors = user_params.get("external_factors") or []
            shock_sim = ExternalShockSimulator(config={"base_probability": 0.1})

            def _emit_market_event(quarter: int, snapshot: Dict[str, Any]) -> None:
                cycle_cn = snapshot.get("cycle_label_cn") or MARKET_CYCLE_LABELS_CN.get(
                    snapshot.get("current_cycle", ""), ""
                )
                stance_cn = POLICY_STANCE_LABELS_CN.get(
                    snapshot.get("policy_stance", ""), ""
                )
                self.event_bus.emit(
                    run_id, "market_event", {
                        "quarter": quarter,
                        "fiscal_year_offset": snapshot.get("fiscal_year_offset", 0),
                        "industry": industry,
                        "sector_growth_rate": round(snapshot.get("sector_growth_rate", 0.0), 4),
                        "policy_stance": snapshot.get("policy_stance", ""),
                        "policy_stance_cn": stance_cn,
                        "policy_pressure": round(snapshot.get("policy_pressure", 0.0), 3),
                        "capital_availability": round(snapshot.get("capital_availability", 0.0), 3),
                        "consumer_sentiment": round(snapshot.get("consumer_sentiment", 0.0), 3),
                        "current_cycle": snapshot.get("current_cycle", ""),
                        "cycle_label_cn": cycle_cn,
                        "msg_cn": f"市场事件 Q{quarter}: 行业增速 {snapshot.get('sector_growth_rate', 0) * 100:+.1f}% / 周期 {cycle_cn} / 政策 {stance_cn}",
                    },
                    stage=Stage.SIMULATION_RUNNING.value,
                )

            def _emit_shock_injected(round_num: int, factor: str, shock) -> None:
                try:
                    shock_dict = shock.to_dict() if hasattr(shock, "to_dict") else dict(shock)
                except Exception:
                    shock_dict = {"shock_type": str(getattr(shock, "shock_type", "UNKNOWN"))}
                self.event_bus.emit(
                    run_id, "shock_injected", {
                        "round": round_num,
                        "factor": factor,
                        "shock": shock_dict,
                        "msg_cn": f"外部冲击 R{round_num}（{factor[:20]}）: {shock_dict.get('shock_type', '')}",
                    },
                    stage=Stage.SIMULATION_RUNNING.value,
                )

            # 起始轮次：在已有 round_results 之后续推
            existing = sim_artifact.get("round_results") or []
            start_round = len(existing) + 1

            def _on_progress(evt: Dict[str, Any]) -> None:
                # 用 event.round 直接作为全局轮号（start_round + n-1）
                try:
                    local_n = int(evt.get("round") or 0)
                except Exception:
                    local_n = 0
                global_round = start_round + max(0, local_n - 1)
                evt2 = dict(evt)
                evt2["round"] = global_round
                # 1) round_progress (back-compat)
                try:
                    self.event_bus.emit(
                        run_id, "round_progress", evt2,
                        stage=Stage.SIMULATION_RUNNING.value,
                    )
                except Exception:
                    pass
                # 2) round_completed (新事件)
                try:
                    belief_updates_list = evt2.get("belief_updates") or []
                    rc_payload: Dict[str, Any] = {
                        "round": global_round,
                        "total_rounds": evt2.get("total_rounds"),
                        "actions_count": len(evt2.get("actions") or []),
                        "belief_updates_count": len(belief_updates_list),
                        "belief_shift_count": _aggregate_belief_shift_count(belief_updates_list),
                        "propagation_events_count": len(evt2.get("propagation_events") or []),
                        "actions": evt2.get("actions"),
                        "belief_updates": belief_updates_list,
                        "propagation_events": evt2.get("propagation_events"),
                        "new_entities": evt2.get("new_entities"),
                        "new_relations": evt2.get("new_relations"),
                        "ts": time.time(),
                    }
                    self.event_bus.emit(
                        run_id, "round_completed", rc_payload,
                        stage=Stage.SIMULATION_RUNNING.value,
                    )
                except Exception:
                    pass
                # 2.5) belief_shift (新事件 — 节流)
                try:
                    _emit_belief_shifts(
                        self.event_bus, run_id, global_round,
                        evt2.get("belief_updates") or [],
                    )
                except Exception:
                    pass
                # 3) round_started (新事件)
                try:
                    if global_round > 0:
                        self.event_bus.emit(
                            run_id, "round_started", {
                                "round": global_round,
                                "total_rounds": evt2.get("total_rounds"),
                                "ts": time.time(),
                            },
                            stage=Stage.SIMULATION_RUNNING.value,
                        )
                except Exception:
                    pass
                if local_n > 0 and local_n % 4 == 0:
                    try:
                        market_env.evolve_quarter()
                        snap = market_env.snapshot()
                        _emit_market_event(market_env.fiscal_quarter, snap)
                    except Exception:
                        pass
                if local_n > 0 and local_n % 3 == 0 and external_factors:
                    factor = external_factors[(local_n // 3 - 1) % len(external_factors)]
                    try:
                        shock = shock_sim.inject_shock(
                            context={"agents": agents, "round": global_round, "factor": factor},
                            probability=1.0,
                            round_num=global_round,
                        )
                        if shock is not None:
                            _emit_shock_injected(global_round, factor, shock)
                    except Exception:
                        pass

            # Run additional rounds
            self.event_bus.emit(
                run_id, "year_advanced", {
                    "year_offset": 1,
                    "rounds_to_run": rounds_to_run,
                    "start_round": start_round,
                    "msg_cn": f"再推 1 年（{rounds_to_run} 回合）启动",
                },
                stage=Stage.SIMULATION_RUNNING.value,
            )
            new_results = await sim_loop.run(
                agents=agents,
                max_rounds=rounds_to_run,
                simulated_hours=rounds_to_run * 6,
                progress_callback=_on_progress,
            )
            # 合并：append new round_results to the prior sim artifact
            merged = list(existing) + list(new_results.get("round_results", []))
            sim_artifact["round_results"] = merged
            sim_artifact["current_round"] = len(merged)
            sim_artifact["total_rounds"] = len(merged)
            sim_artifact["advanced_year"] = True
            run.artifacts[Stage.SIMULATION_RUNNING.value] = sim_artifact
            run.artifacts["_market_env_snapshot"] = market_env.snapshot()
            run.status = "completed"
            run.current_stage = Stage.COMPLETED
            run.progress = 1.0
            self._save_checkpoint(run)
            self.event_bus.emit(
                run_id, "year_advanced", {
                    "year_offset": 1,
                    "status": "completed",
                    "rounds_added": len(new_results.get("round_results", [])),
                    "total_rounds": len(merged),
                    "msg_cn": f"再推 1 年完成（共 {len(merged)} 回合）",
                },
                stage=Stage.SIMULATION_RUNNING.value,
            )
        except Exception as e:
            run.status = "failed"
            run.error = f"advance-year failed: {e}\n{traceback.format_exc()}"
            self._save_checkpoint(run)
            self.event_bus.emit(
                run_id, "year_advanced", {
                    "status": "failed",
                    "error": str(e),
                    "msg_cn": f"再推 1 年失败：{e}",
                },
                stage=Stage.SIMULATION_RUNNING.value,
            )
        finally:
            self._control.pop(run_id, None)

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
        # P2-G3 remainder: pass user_params so the report surfaces
        # user-specified external_factors and selected_departments.
        report_user_params = run.config.get("user_params") or {}
        try:
            content = await report_agent.generate(
                sim_results,
                report_style="executive",
                user_params=report_user_params or None,
            )
        except Exception as e:
            content = (
                f"# Strategic Report (degraded)\n\n"
                f"ReportAgent failed: {e}\n\n"
                f"## Simulation summary\n{json.dumps(sim_results, default=str)[:2000]}"
            )
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
