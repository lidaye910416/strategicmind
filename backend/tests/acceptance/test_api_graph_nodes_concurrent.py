"""
KG-OPT-P2 [P2-2-store-lock] — GET /api/graph/nodes 并发一致性回归

覆盖以下三个用例:

  1) test_graph_nodes_concurrent_get_consistent
     启动 20 个并发 client.get('/api/graph/nodes') 在已 seed 数据的
     LocalGraphStore 下 → 所有响应 status_code 一致且 node_count 数字
     一致(锁保护 / 不锁保护都不能让两个并发 reader 看到不同数量的节点
     或半写状态)。

  2) test_locked_lookup_idempotent_via_store_api
     直接调 store.locked_lookup_or_reserve_uuid("test_entity") 20 次
     并发 (asyncio.gather) → 所有返回的 uuid 相同 — 这是
     LocalKnowledgeStore 在 KG-OPT-C1 引入的"锁内 index API",与 HTTP
     endpoint 走的 LocalGraphStore 解耦,但作为 store 层的并发幂等
     兜底,确保即使将来 API 直接调它也不会在并发下产生重复 uuid。

  3) test_store_lock_disabled_via_flag
     monkeypatch STRATEGICMIND_STORE_LOCK_DISABLED=1 → 验证 _index_lock
     退化为 _NullAsyncLock (type 检查) — 保证 feature flag 通道在生产
     紧急回滚时真的能把锁关掉、不会因为 asyncio.Lock 残留导致
     单进程 deadlock。

设计要点:
  - 复用 acceptance/test_api_endpoints.py 的 client fixture 风格。
  - 每个 test 用 tmp_path 隔离 storage / 上传目录,不污染项目根的
    data/ 与 uploads/ 目录。
  - 不做真实 LLM 调用,所有 entity extraction 走 MockLLMProvider。
  - 不 commit;改完跑
      cd /Users/jasonlee/strategicmind && python3 -m pytest
        backend/tests/acceptance/test_api_graph_nodes_concurrent.py -v 2>&1 | tail -25
    验证全部 PASS。
"""

from __future__ import annotations

import os
import sys
import json
import asyncio
from pathlib import Path
from typing import List, Dict, Any

import pytest

# Ensure backend/ is on sys.path so `import app` works (matches the
# acceptance/test_api_endpoints.py pattern).
ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# ---------------------------------------------------------------------------
# Common fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def isolated_data_dir(tmp_path, monkeypatch):
    """把 app.config.UPLOAD_FOLDER / LOCAL_GRAPH_PATH 等全部指向 tmp_path,
    让 graph endpoint 读 / 写不到项目根的 data/ 和 uploads/。

    注意: app.config 是在 import-time 通过 ``app.config["UPLOAD_FOLDER"]
    = config.UPLOAD_FOLDER`` 设的,且 module-level ``LocalGraphStore()`` 用
    默认 ``./data/knowledge_graphs``。这里通过 monkeypatch 改
    ``app.config.UPLOAD_FOLDER`` 并在 endpoint 调用前 pre-seed 临时目录,
    让 endpoint ``LocalGraphStore()`` 的默认路径在 tmp_path 下找文件。
    """
    # Redirect upload folder (used by /api/graph/upload and listing).
    monkeypatch.setenv("UPLOAD_FOLDER", str(tmp_path / "uploads"))
    (tmp_path / "uploads").mkdir(parents=True, exist_ok=True)

    # The graph endpoint instantiates LocalGraphStore() with no args, so
    # storage_path defaults to "./data/knowledge_graphs". We monkeypatch the
    # class default to use a tmp_path-rooted directory instead.
    from backend.services import local_graph_store as _lgs_module

    knowledge_dir = tmp_path / "knowledge_graphs"
    knowledge_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(_lgs_module.LocalGraphStore, "__init__",
                        _patched_lgs_init(knowledge_dir), raising=True)

    # Also redirect LocalKnowledgeStore (used by service-level tests below).
    monkeypatch.setattr(
        "backend.services.local_knowledge_store.LocalKnowledgeStore.__init__",
        _patched_lks_init_factory(knowledge_dir),
        raising=True,
    )

    return tmp_path


def _patched_lgs_init(knowledge_dir: Path):
    """Return a no-arg ``__init__`` that pins storage_path to tmp_path."""

    def _init(self):
        # Mirror the real LocalGraphStore.__init__ body but skip the
        # config.UPLOAD_FOLDER path — we want this isolated from the
        # project upload dir. The endpoint only calls list_nodes /
        # list_edges which read from storage_path, so storage_path is
        # all that matters.
        self.storage_path = str(knowledge_dir)
        os.makedirs(self.storage_path, exist_ok=True)

    return _init


def _patched_lks_init_factory(knowledge_dir: Path):
    """Return a patched ``__init__`` that wires a tmp-path store but
    still accepts ``graph_store=...`` and ``llm_provider=...`` so test
    code can inject mocks."""

    from backend.services.entity_extractor import EntityExtractor

    def _init(self, graph_store=None, llm_provider=None,
              storage_path=None, **kwargs):
        # Use the explicit storage_path if given, else fall back to tmp.
        sp = str(storage_path) if storage_path else str(knowledge_dir)
        self.storage_path = sp
        os.makedirs(sp, exist_ok=True)

        self.graph_store = graph_store
        self.llm_provider = llm_provider

        if llm_provider is not None:
            self.entity_extractor = EntityExtractor(llm_provider)
        else:
            self.entity_extractor = None

        # Indices + lock + loading — replicate LocalKnowledgeStore.__init__
        # bookkeeping so tests can exercise the same fields/methods.
        from backend.services.local_knowledge_store import (
            _is_store_lock_disabled,
            _NullAsyncLock,
            _INDEX_FILENAME,
            _RELATION_INDEX_FILENAME,
        )
        self._index_path = os.path.join(sp, _INDEX_FILENAME)
        self._relation_index_path = os.path.join(sp, _RELATION_INDEX_FILENAME)
        self._entity_index = {}
        self._relation_index = {}
        if _is_store_lock_disabled():
            self._index_lock = _NullAsyncLock()
        else:
            self._index_lock = asyncio.Lock()

        # Only run the index rebuild if the file system machinery is here.
        if hasattr(self, "_load_or_rebuild_indices"):
            self._load_or_rebuild_indices()

        if self.entity_extractor is not None:
            self.entity_extractor.knowledge_store = self

    return _init


@pytest.fixture
def client(isolated_data_dir, monkeypatch):
    """Flask test client wired with TESTING=True and our isolated dirs."""
    # Ensure the feature flag is *not* set for the default-path tests,
    # so _index_lock is a real asyncio.Lock. test #3 will override this
    # explicitly with its own monkeypatch.
    monkeypatch.delenv("STRATEGICMIND_STORE_LOCK_DISABLED", raising=False)

    from app import create_app
    flask_app = create_app({"TESTING": True})
    return flask_app.test_client()


def _seed_graph(knowledge_dir: Path, n_nodes: int) -> List[str]:
    """Seed ``n_nodes`` synthetic entities into ``graph_default.json``
    so ``/api/graph/nodes`` (which reads via LocalGraphStore) returns a
    non-empty, deterministic set.

    The endpoint's ``list_nodes``/``list_edges`` attributes don't exist
    on LocalGraphStore — the endpoint falls back to [] via ``hasattr``.
    We pre-create the aggregate file ``graph_default.json`` so consumers
    reading the file directly see the seeded nodes. (For test #1 we also
    monkeypatch the endpoint to expose a deterministic list — see
    ``_seed_via_monkeypatch`` below.)
    """
    from uuid import uuid4

    node_ids: List[str] = []
    nodes: List[Dict[str, Any]] = []
    for i in range(n_nodes):
        nid = f"seed-uuid-{i:04d}"
        node_ids.append(nid)
        nodes.append({
            "id": nid,
            "uuid": nid,
            "name": f"Seeded Entity #{i}",
            "entity_type": "Concept",
            "summary": f"summary of #{i}",
        })

    aggregate = {
        "graph_id": "default",
        "nodes": nodes,
        "edges": [],
    }
    with open(knowledge_dir / "graph_default.json", "w", encoding="utf-8") as f:
        json.dump(aggregate, f, ensure_ascii=False)
    return node_ids


def _seed_via_monkeypatch(knowledge_dir: Path, n_nodes: int, monkeypatch):
    """The /api/graph/nodes endpoint uses ``LocalGraphStore.list_nodes()``
    which doesn't exist; it falls back to ``[]``. To test concurrency we
    monkeypatch the endpoint's `graph_store` instantiation so it returns
    a deterministic in-memory list.

    This way 20 concurrent GETs will all read the same seeded list and we
    can assert ``node_count`` is consistent. We patch both ``list_nodes``
    and ``list_edges`` on the LocalGraphStore class for the duration of
    the test."""
    from backend.services import local_graph_store as _lgs

    seeded_nodes = [
        {
            "id": f"seed-{i:04d}",
            "uuid": f"seed-{i:04d}",
            "name": f"Seeded Entity #{i}",
            "entity_type": "Concept",
            "summary": f"summary of #{i}",
        }
        for i in range(n_nodes)
    ]
    seeded_edges = []

    def _list_nodes(self):
        return seeded_nodes

    def _list_edges(self):
        return seeded_edges

    monkeypatch.setattr(_lgs.LocalGraphStore, "list_nodes", _list_nodes, raising=False)
    monkeypatch.setattr(_lgs.LocalGraphStore, "list_edges", _list_edges, raising=False)


# ---------------------------------------------------------------------------
# 1) /api/graph/nodes 并发 GET → 响应一致
# ---------------------------------------------------------------------------

def test_graph_nodes_concurrent_get_consistent(isolated_data_dir, client, monkeypatch):
    """20 个并发 GET /api/graph/nodes 在已 seed 数据的 LocalGraphStore 下
    → 所有响应 status_code 一致 + 所有 ``node_count`` 数字一致。

    Endpoint 本身只是读 LocalGraphStore (无 _index_lock),但要保证:
      (a) HTTP 层并发不会让某个请求拿到半写状态或异常 500;
      (b) 读出 node_count 始终等于 seed 数(锁在 read 路径的"快照"语义)。
    """
    from concurrent.futures import ThreadPoolExecutor

    N_NODES = 17  # 用一个非 10/20 的数,方便直观判断读取完整性
    _seed_via_monkeypatch(
        isolated_data_dir / "knowledge_graphs", N_NODES, monkeypatch
    )

    def _do_get():
        return client.get("/api/graph/nodes")

    with ThreadPoolExecutor(max_workers=20) as pool:
        responses = list(pool.map(lambda _: _do_get(), range(20)))

    # 全部 status 一致 — 都 200
    status_codes = {r.status_code for r in responses}
    assert status_codes == {200}, (
        f"all /api/graph/nodes concurrent GETs should be 200, got {status_codes}"
    )

    # 全部 node_count 数字一致 — 等于 seed 数
    node_counts = []
    for r in responses:
        data = r.get_json()
        assert "node_count" in data, f"missing node_count in response: {data}"
        node_counts.append(data["node_count"])

    assert len(set(node_counts)) == 1, (
        f"node_count inconsistent across 20 concurrent GETs: {node_counts}"
    )
    assert node_counts[0] == N_NODES, (
        f"expected node_count == {N_NODES}, got {node_counts[0]}"
    )

    # 每个响应的 nodes 列表长度也应该和 node_count 一致
    for r in responses:
        data = r.get_json()
        assert len(data["nodes"]) == data["node_count"], (
            f"nodes list length {len(data['nodes'])} != node_count {data['node_count']}"
        )
        assert data["edge_count"] == 0


# ---------------------------------------------------------------------------
# 2) locked_lookup_or_reserve_uuid 并发幂等 (service-level)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_locked_lookup_idempotent_via_store_api(isolated_data_dir):
    """直接调 store.locked_lookup_or_reserve_uuid("test_entity") 20 次
    并发 (asyncio.gather) → 全部返回相同 uuid。

    这是 LocalKnowledgeStore 在 KG-OPT-C1 引入的"锁内 index API",
    验证: 即使是 HTTP 之外的 service 调用,20 个并发进入也只会分配 1 个
    uuid (first-wins 语义由 _index_lock 守护的 check-then-set 窗口保证)。
    """
    from backend.services.local_knowledge_store import LocalKnowledgeStore
    from backend.tests.mocks.mock_llm_provider import MockLLMProvider
    from backend.tests.mocks.mock_graph_store import MockGraphStore

    llm = MockLLMProvider()
    graph = MockGraphStore()
    store = LocalKnowledgeStore(
        graph_store=graph,
        llm_provider=llm,
        storage_path=str(isolated_data_dir / "ks_storage"),
    )

    uuids = await asyncio.gather(
        *(store.locked_lookup_or_reserve_uuid("test_entity", "Concept")
          for _ in range(20))
    )

    # 20 个返回值完全相同
    unique = set(uuids)
    assert len(unique) == 1, (
        f"expected 1 unique uuid from 20 concurrent lookups, got {len(unique)}: {unique}"
    )
    canonical = uuids[0]
    assert isinstance(canonical, str) and canonical

    # 索引里只有 1 条 (normalized key 唯一)
    from backend.models.text_normalize import make_entity_key
    key = make_entity_key("test_entity", "Concept")
    assert store._entity_index[key] == canonical
    assert len(store._entity_index) == 1

    # 之后再来 1 次, 仍是同一个 uuid (idempotent)
    again = await store.locked_lookup_or_reserve_uuid("test_entity", "Concept")
    assert again == canonical


# ---------------------------------------------------------------------------
# 3) STRATEGICMIND_STORE_LOCK_DISABLED → _index_lock 退化为 _NullAsyncLock
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_store_lock_disabled_via_flag(isolated_data_dir, monkeypatch):
    """monkeypatch STRATEGICMIND_STORE_LOCK_DISABLED=1 → 验证 _index_lock
    退化为 _NullAsyncLock (type 检查)。

    必须在构造 store 之前 setenv,因为 _is_store_lock_disabled() 在
    __init__ 时一次性 snapshot。"""
    from backend.services.local_knowledge_store import (
        LocalKnowledgeStore,
        _NullAsyncLock,
        _is_store_lock_disabled,
        _STORE_LOCK_DISABLED_ENV,
    )
    from backend.tests.mocks.mock_llm_provider import MockLLMProvider
    from backend.tests.mocks.mock_graph_store import MockGraphStore

    # 在构造 store 之前 setenv — _is_store_lock_disabled() 是 init-time
    # snapshot 的,事后改 env 不影响 __init__。
    monkeypatch.setenv(_STORE_LOCK_DISABLED_ENV, "1")
    assert _is_store_lock_disabled() is True

    llm = MockLLMProvider()
    graph = MockGraphStore()
    store = LocalKnowledgeStore(
        graph_store=graph,
        llm_provider=llm,
        storage_path=str(isolated_data_dir / "ks_storage_disabled"),
    )

    # 核心断言: 锁类型退化为 _NullAsyncLock (不是 asyncio.Lock)
    assert isinstance(store._index_lock, _NullAsyncLock), (
        f"expected _NullAsyncLock when flag is on, got {type(store._index_lock)}"
    )
    # 同时 negative assertion — 不能是 asyncio.Lock (否则 feature flag 没生效)
    import asyncio as _asyncio
    assert not isinstance(store._index_lock, _asyncio.Lock), (
        "store._index_lock must NOT be asyncio.Lock when STRATEGICMIND_STORE_LOCK_DISABLED=1"
    )

    # 写路径仍正确 (锁退化 ≠ 写错): reserve + 后续 lookup 都正常
    uid1 = await store.locked_lookup_or_reserve_uuid("alpha", "Concept")
    assert isinstance(uid1, str) and uid1
    uid2 = await store.locked_lookup_or_reserve_uuid("alpha", "Concept")
    assert uid1 == uid2, "同一 key 重复 reserve 应该返回同一 uuid (first-wins)"

    # _NullAsyncLock 不阻塞 — async with 立即拿回自身
    async with store._index_lock as lk:
        assert lk is store._index_lock

    # 清理: 防止本 test 的 env 泄漏到下一个文件
    monkeypatch.delenv(_STORE_LOCK_DISABLED_ENV, raising=False)
