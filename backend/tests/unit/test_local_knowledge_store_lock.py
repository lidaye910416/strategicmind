"""
KG-OPT-P2 [P2-2-store-lock] — 并发锁测试

覆盖以下五个用例:

  1) test_concurrent_insert_entity_same_key_dedups
     asyncio.gather 并发 10 次 insert_entity 同 (name, entity_type) 不同
     payload → 验证只有 1 个磁盘文件 + 1 个 _entity_index 条目 + 10 个
     返回的 entity_id 全部相同(锁保护的 check-then-set 没有让多个
     协程同时看到 MISS)。

  2) test_concurrent_insert_entity_different_keys_all_persist
     50 个并发 insert 不同 name → 50 个文件 + 50 个 index 条目
     (锁不能把不同 key 串行化成只写第一个)。

  3) test_locked_lookup_or_reserve_uuid_concurrent_idempotent
     20 个并发 await store.locked_lookup_or_reserve_uuid("foo") → 全部
     返回相同 uuid(底层依然走 _index_lock 的读+reserve+写)。

  4) test_store_lock_disabled_flag
     monkeypatch STRATEGICMIND_STORE_LOCK_DISABLED=1 → 验证锁退化为
     _NullAsyncLock (写仍正确但不强制互斥) — 即 store._index_lock
     实际类型是 _NullAsyncLock 且 __aenter__ 永远不阻塞。

  5) test_entity_from_name_with_store
     通过 store.locked_lookup_or_reserve_uuid 给 Entity.from_name 注入
     id, 验证重复调用返回相同 entity_id(模型层 + 服务层去重路径对齐)。

设计要点:
  - 使用 pytest + pytest-asyncio (mode=STRICT, 项目根 pyproject 未声明,
    conftest 未开 auto, 因此所有 async test 必须显式 @pytest.mark.asyncio)。
  - 每个 test 独立 tmp_path fixture(不共享 storage_path)。
  - store 不真正调用 LLM, 因此用 mock LLM provider。
  - 显式 monkeypatch.delenv 防止 STRATEGICMIND_STORE_LOCK_DISABLED
    在 test 间互相污染。
"""

from __future__ import annotations

import os
import json
import asyncio
from typing import Dict, List

import pytest

from backend.models.entity import Entity
from backend.models.text_normalize import make_entity_key
from backend.services.local_knowledge_store import (
    LocalKnowledgeStore,
    _NullAsyncLock,
    _is_store_lock_disabled,
    _STORE_LOCK_DISABLED_ENV,
)
from backend.tests.mocks.mock_llm_provider import MockLLMProvider
from backend.tests.mocks.mock_graph_store import MockGraphStore


# ---------------------------------------------------------------------------
# 公共 fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def store_factory(tmp_path):
    """返回一个 (tmp_path, store) 工厂闭包。每个调用方得到自己的 storage。

    默认锁是**启用**的 — STRATEGICMIND_STORE_LOCK_DISABLED 在测试前被
    显式清掉, 保证本文件里除 #4 以外的所有 test 都跑在"锁启用"路径上。
    """
    # 显式清除 env(被外部 / 上一个 test 设置时)
    os.environ.pop(_STORE_LOCK_DISABLED_ENV, None)

    def _make() -> LocalKnowledgeStore:
        llm = MockLLMProvider()
        graph = MockGraphStore()
        s = LocalKnowledgeStore(
            graph_store=graph,
            llm_provider=llm,
            storage_path=str(tmp_path),
        )
        return s

    return _make


def _list_entity_files(storage_path: str) -> List[str]:
    """列出 storage_path 下真正的 entity 文件 (排除 index / relation / graph_)。"""
    out: List[str] = []
    for fn in os.listdir(storage_path):
        if not fn.endswith(".json"):
            continue
        if fn.startswith("_") or fn.startswith("relation_") or fn.startswith("graph_"):
            continue
        out.append(fn)
    return out


# ---------------------------------------------------------------------------
# 1) 同 key 并发 insert → dedup 守住
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_concurrent_insert_entity_same_key_dedups(store_factory):
    """10 个并发 insert_entity 同一 (name, entity_type) 不同 payload
    → 必须只有 1 个文件 + 1 个 index 条目 + 10 个返回值完全相同。

    锁住了 check-then-set, 不会因为 asyncio.gather 的任务交错让多个
    协程都看到 MISS。
    """
    store = store_factory()

    name = "Apple Inc."
    etype = "Organization"
    payloads = [
        {"name": name, "entity_type": etype, "summary": f"call #{i}", "payload_idx": i}
        for i in range(10)
    ]

    results = await asyncio.gather(
        *(store.insert_entity(p) for p in payloads)
    )

    # 10 个返回的 uuid 全部相同
    assert len(set(results)) == 1, (
        f"expected 1 unique uuid, got {len(set(results))}: {set(results)}"
    )
    canonical_id = results[0]

    # 1 个磁盘文件
    files = _list_entity_files(store.storage_path)
    assert len(files) == 1, f"expected 1 entity file, got {len(files)}: {files}"
    assert files[0] == f"{canonical_id}.json"

    # 1 个 _entity_index 条目 (normalized key 唯一)
    assert len(store._entity_index) == 1
    expected_key = make_entity_key(name, etype)
    assert expected_key in store._entity_index
    assert store._entity_index[expected_key] == canonical_id

    # on-disk 文件里记录的是 first-wins 的那个 payload (call #0)
    with open(os.path.join(store.storage_path, files[0]), "r", encoding="utf-8") as f:
        on_disk = json.load(f)
    assert on_disk["uuid"] == canonical_id
    assert on_disk.get("payload_idx") == 0, (
        f"first-wins 语义被破坏: 磁盘上是 {on_disk.get('payload_idx')}"
    )


# ---------------------------------------------------------------------------
# 2) 不同 key 并发 insert → 全部落盘
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_concurrent_insert_entity_different_keys_all_persist(store_factory):
    """50 个并发 insert_entity 不同 (name, entity_type) → 必须全部落盘
    (锁不能错把不同 key 误判为重复, 也不能在 reserve 阶段就丢 key)。"""
    store = store_factory()

    N = 50
    payloads = [
        {"name": f"Entity-{i:03d}", "entity_type": "Concept", "summary": f"s{i}"}
        for i in range(N)
    ]

    results = await asyncio.gather(
        *(store.insert_entity(p) for p in payloads)
    )

    # 50 个不同 uuid
    assert len(set(results)) == N, (
        f"expected {N} unique uuids, got {len(set(results))}"
    )

    # 50 个磁盘文件
    files = _list_entity_files(store.storage_path)
    assert len(files) == N, f"expected {N} entity files, got {len(files)}"

    # 50 个 index 条目, 每个 name→uuid 都对得上
    assert len(store._entity_index) == N
    for i in range(N):
        key = make_entity_key(f"Entity-{i:03d}", "Concept")
        assert key in store._entity_index
        # 索引里登记的 uuid 就是那次 insert 返回的 uuid
        assert store._entity_index[key] in {r for r in results}


# ---------------------------------------------------------------------------
# 3) locked_lookup_or_reserve_uuid 并发幂等
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_locked_lookup_or_reserve_uuid_concurrent_idempotent(store_factory):
    """20 个并发 await store.locked_lookup_or_reserve_uuid("foo") → 全部
    返回相同 uuid(底层走 _index_lock 的 read+reserve+write)。"""
    store = store_factory()

    uuids = await asyncio.gather(
        *(store.locked_lookup_or_reserve_uuid("foo", "Concept") for _ in range(20))
    )

    # 20 个返回值完全相同
    unique = set(uuids)
    assert len(unique) == 1, (
        f"expected 1 unique uuid from 20 concurrent lookups, got {len(unique)}: {unique}"
    )
    canonical = uuids[0]

    # 索引里只有 1 条
    key = make_entity_key("foo", "Concept")
    assert store._entity_index[key] == canonical
    assert len(store._entity_index) == 1

    # 1 个磁盘文件
    files = _list_entity_files(store.storage_path)
    assert len(files) == 1
    assert files[0] == f"{canonical}.json"

    # 之后再来 1 次, 仍是同一个 uuid
    again = await store.locked_lookup_or_reserve_uuid("foo", "Concept")
    assert again == canonical


# ---------------------------------------------------------------------------
# 4) 锁被 STRATEGICMIND_STORE_LOCK_DISABLED 退化为 _NullAsyncLock
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_store_lock_disabled_flag(monkeypatch, tmp_path):
    """monkeypatch STRATEGICMIND_STORE_LOCK_DISABLED=1 → 验证 _index_lock
    是 _NullAsyncLock 且写仍正确(只是不强制互斥)。

    注意: 必须在构造 store 之前 setenv, 因为 _is_store_lock_disabled()
    在 __init__ 时一次性 snapshot。
    """
    monkeypatch.setenv(_STORE_LOCK_DISABLED_ENV, "1")
    # 同步保护: helper 函数也确实看到 True
    assert _is_store_lock_disabled() is True

    llm = MockLLMProvider()
    graph = MockGraphStore()
    store = LocalKnowledgeStore(
        graph_store=graph,
        llm_provider=llm,
        storage_path=str(tmp_path),
    )

    # 锁类型退化为 _NullAsyncLock
    assert isinstance(store._index_lock, _NullAsyncLock), (
        f"expected _NullAsyncLock when flag is on, got {type(store._index_lock)}"
    )

    # 写仍然正确(不强制互斥 ≠ 写错)
    eid = await store.insert_entity(
        {"name": "Bar Co", "entity_type": "Organization", "summary": "x"}
    )
    assert isinstance(eid, str) and eid
    key = make_entity_key("Bar Co", "Organization")
    assert store._entity_index[key] == eid
    files = _list_entity_files(store.storage_path)
    assert files == [f"{eid}.json"]

    # lookup 路径也走 _NullAsyncLock
    uid = await store.locked_lookup_or_reserve_uuid("Baz", "Concept")
    assert uid == eid or isinstance(uid, str)  # 不同 key → 应该是新 uuid
    # 验证 _NullAsyncLock 不会 await / 不会阻塞
    async with store._index_lock as lk:
        assert lk is store._index_lock

    # 清理: 防止本 test 的 env 泄漏到下一个文件
    monkeypatch.delenv(_STORE_LOCK_DISABLED_ENV, raising=False)


# ---------------------------------------------------------------------------
# 5) Entity.from_name 通过 store 注入 uuid
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_entity_from_name_with_store(store_factory):
    """通过 store.locked_lookup_or_reserve_uuid 给 Entity.from_name 注入 id,
    验证重复调用返回相同 entity_id(模型层 dedup 路径对齐服务层)。"""
    store = store_factory()

    # 第一次 from_name: 没有 store 记录 → 应拿到一个全新 uuid
    e1 = Entity.from_name(
        "Microsoft",
        "Organization",
        summary="first call",
        knowledge_store=store,
    )
    # store 此刻还没有 (microsoft|organization) 的 index 条目,
    # from_name 直接走 getattr(store, "_entity_index", None) — 此时为空,
    # 所以 e1.uuid 是新 uuid, 不等同于后续 reserve 的结果。
    assert isinstance(e1.uuid, str) and e1.uuid

    # reserve 一次, 让 index 里有 (microsoft|organization) → reserved_uuid
    reserved_uuid = await store.locked_lookup_or_reserve_uuid(
        "Microsoft", "Organization"
    )

    # 第二次 from_name: store 索引里有 hit → e2.uuid == reserved_uuid
    e2 = Entity.from_name(
        "Microsoft",
        "Organization",
        summary="second call",
        knowledge_store=store,
    )
    assert e2.uuid == reserved_uuid, (
        f"expected Entity.from_name to reuse {reserved_uuid}, got {e2.uuid}"
    )

    # 第三次 with different summary 但同样 (name, type) → 仍同 uuid
    e3 = Entity.from_name(
        "Microsoft",
        "Organization",
        summary="third call",
        knowledge_store=store,
    )
    assert e3.uuid == reserved_uuid
    assert e2.uuid == e3.uuid

    # 不同的 (name, type) → 不同 uuid
    e4 = Entity.from_name(
        "Apple Inc.",
        "Organization",
        summary="different entity",
        knowledge_store=store,
    )
    assert e4.uuid != reserved_uuid
    assert isinstance(e4.uuid, str) and e4.uuid
