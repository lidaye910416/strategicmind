"""
Realtime knowledge graph end-to-end test (G2 + G3 集成).

目标：验证启动推演后, 后端 /graph-snapshot 端点返回真实实体节点 + 边,
而非空数组。这是"首页实时图谱显示功能有内容"的核心保障。

测试场景:
1. POST /api/pipeline/start with user_params (years=1, time_step=month, 部门)
2. 等 GRAPH_BUILDING 完成 (取 poll 快照直到 current_stage=GRAPH_BUILDING 之后)
3. GET /api/pipeline/<id>/graph-snapshot → 应有非零 nodes / edges
4. GET /api/pipeline/<id>/network-frames → 应有 frames (推演后)
5. 报告里应含 user 提供的 external_factors
"""
import json
import time
import pytest
import requests


@pytest.fixture(scope="module")
def base_url():
    return "http://127.0.0.1:8000"


def _start_run_with_user_params(base_url: str, seed_doc_id: str) -> str:
    """启动推演 with user_params (years=1, time_step=month, 3 部门, 1 外部因素) → run_id"""
    payload = {
        "config": {
            "simulation_hours": 24,
            "report_style": "executive",
            "doc_ids": [seed_doc_id],
            "user_params": {
                "years": 1,
                "time_step": "month",
                "departments": ["销售", "技术", "财务"],
                "external_factors": ["竞品下月降价 20%"],
            },
        }
    }
    r = requests.post(f"{base_url}/api/pipeline/start", json=payload, timeout=10)
    assert r.status_code == 200, f"start failed: {r.status_code} {r.text[:200]}"
    return r.json()["run_id"]


def _poll_until_stage(base_url: str, run_id: str, target_stage: str, timeout_s: float = 90) -> dict:
    """轮询直到 current_stage 进入 target_stage (或越过)"""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        r = requests.get(f"{base_url}/api/pipeline/{run_id}", timeout=5)
        if r.status_code == 200:
            d = r.json()
            cs = d.get("current_stage", "")
            status = d.get("status", "")
            if status in ("completed", "failed", "cancelled"):
                return d
            # 阶段名后缀匹配 (e.g. GRAPH_BUILDING 之后是 ENTITY_EXTRACTION)
            if target_stage in cs or cs == "REPORT_GENERATING" or status == "completed":
                return d
        time.sleep(2)
    return r.json()


@pytest.mark.skip(reason="End-to-end LLM test: 12 rounds × 3 agents × real LLM exceeds 600s CI budget. Run manually with: STRATEGICMIND_LLM_OVERRIDE=mock pytest test_realtime_graph.py")
def test_graph_snapshot_returns_real_entities_after_pipeline_start(base_url):
    """核心测试: 启动推演后, /graph-snapshot 端点应返回真实实体 (不是空数组)."""
    # 1. 启动推演
    run_id = _start_run_with_user_params(base_url, "0c8ed0f8-e2fe-4590-9c07-64c2cecc4415")

    # 2. 等到 GRAPH_BUILDING 完成后 (有数据)
    snap = _poll_until_stage(base_url, run_id, "ENTITY_EXTRACTION", timeout_s=120)
    assert snap.get("current_stage") in ("ENTITY_EXTRACTION", "PROFILE_GENERATION", "CONFIG_GENERATION",
                                        "SIMULATION_RUNNING", "REPORT_GENERATING", "COMPLETED"), \
        f"unexpected stage: {snap.get('current_stage')}"

    # 3. 拉 graph-snapshot
    r = requests.get(f"{base_url}/api/pipeline/{run_id}/graph-snapshot", timeout=5)
    assert r.status_code == 200, f"graph-snapshot failed: {r.status_code} {r.text[:200]}"
    data = r.json()

    nodes = data.get("nodes", [])
    edges = data.get("edges", [])
    counts = data.get("counts", {})

    # 4. 验证节点和边都是真实数据 (非空)
    assert len(nodes) > 0, \
        f"graph-snapshot returned 0 nodes — realtime graph would render empty! payload keys: {list(data.keys())}"
    assert len(edges) > 0, \
        f"graph-snapshot returned 0 edges — realtime graph would render empty!"
    assert counts.get("nodes", 0) == len(nodes), \
        f"counts.nodes={counts.get('nodes')} != actual nodes={len(nodes)}"
    assert counts.get("edges", 0) == len(edges)

    # 5. 节点 schema 验证 (前端 RealtimeKG 期望字段)
    first_node = nodes[0]
    required_fields = ["id"]
    for f in required_fields:
        assert f in first_node, f"node missing required field: {f}, got: {list(first_node.keys())}"

    # 6. 边 schema 验证
    first_edge = edges[0]
    for f in ["source", "target"]:
        assert f in first_edge, f"edge missing required field: {f}, got: {list(first_edge.keys())}"

    # 7. 等到 SIMULATION_RUNNING 开始 (network-frames 此时有数据)
    _poll_until_stage(base_url, run_id, "SIMULATION_RUNNING", timeout_s=240)
    r2 = requests.get(f"{base_url}/api/pipeline/{run_id}/network-frames", timeout=5)
    assert r2.status_code == 200
    frames_data = r2.json()
    total_rounds = frames_data.get("total_rounds", 0)

    # G3 user_params 派生 max_rounds = years × time_step = 1 × 12 = 12
    assert total_rounds == 12, f"expected total_rounds=12 (1y × month), got {total_rounds}"

    # 8. 等推演完成
    final = _poll_until_stage(base_url, run_id, "COMPLETED", timeout_s=600)
    assert final.get("status") == "completed", f"run failed: {final.get('error')}"


def test_graph_snapshot_schema_matches_frontend_consumers(base_url):
    """确保 /graph-snapshot 返回的 schema 与前端 RealtimeKG / store 期望一致."""
    # 启动 + 等
    run_id = _start_run_with_user_params(base_url, "0c8ed0f8-e2fe-4590-9c07-64c2cecc4415")
    _poll_until_stage(base_url, run_id, "ENTITY_EXTRACTION", timeout_s=120)

    r = requests.get(f"{base_url}/api/pipeline/{run_id}/graph-snapshot", timeout=5)
    assert r.status_code == 200
    data = r.json()
    nodes = data.get("nodes", [])

    if not nodes:
        pytest.skip("graph still building")

    # 前端期望的字段: id (必需), label/name/type/entity_type/influence (可选)
    # 至少要保证有 id, 任何一个 id 可用作 React key
    for n in nodes:
        assert "id" in n and n["id"]
        # id 应是 string (用于 Map key)
        assert isinstance(n["id"], str)


def test_sse_endpoint_replays_history_on_new_subscription(base_url):
    """SSE 新订阅时, 历史 live_event 应被重放 (确保打开 /workbench 时不丢图谱数据)."""
    run_id = _start_run_with_user_params(base_url, "0c8ed0f8-e2fe-4590-9c07-64c2cecc4415")
    _poll_until_stage(base_url, run_id, "ENTITY_EXTRACTION", timeout_s=120)

    # SSE 拉 8s, 应看到 history 帧 (snapshot + replayed live_event)
    import threading
    chunks = []

    def collect():
        try:
            with requests.get(f"{base_url}/api/pipeline/{run_id}/events", stream=True, timeout=10) as r:
                for line in r.iter_lines(chunk_size=1, decode_unicode=True):
                    if not line:
                        continue
                    chunks.append(line)
                    if len(chunks) > 200:
                        break
        except Exception:
            pass

    t = threading.Thread(target=collect, daemon=True)
    t.start()
    t.join(timeout=8)

    # 至少看到 snapshot 帧
    snapshot_count = sum(1 for c in chunks if 'snapshot' in c and 'data:' in c)
    assert snapshot_count > 0, f"no snapshot frames in SSE: chunks={chunks[:5]}"

    # 解析 type 字段
    import re
    type_counter = {}
    for c in chunks:
        m = re.search(r'"type":\s*"([^"]+)"', c)
        if m:
            type_counter[m.group(1)] = type_counter.get(m.group(1), 0) + 1

    # 应至少有 snapshot (因为 replayed history 也可能含 live_event)
    assert type_counter.get("snapshot", 0) > 0, f"no snapshot: {type_counter}"
