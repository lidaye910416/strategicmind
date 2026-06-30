# ⚠️ ARCHIVED — 2026-06-23

> **This runbook is for commit `080e307e` (an older KG optimization).**
> **It has been SUPERSEDED by:**
> - [docs/features/knowledge-graph-quality.md](../features/knowledge-graph-quality.md) — new spec with `STRATEGICMIND_KG_GLOBAL_TARGET` (default 200)
> - [docs/decisions/ADR-001-kg-eviction-signal-density.md](../decisions/ADR-001-kg-eviction-signal-density.md) — eviction strategy
> - [docs/runs/2026-06-23-p0-bug-fix.md](../runs/2026-06-23-p0-bug-fix.md) — commit `db10a153`
>
> **Do NOT use this runbook for the current codebase. The env flag names and behavior have changed.**

---

# KG Optimization 灰度发布 Runbook (P2-3)

> 任务: 080e307e `perf(knowledge-graph): 收敛 strategicmind 每轮节点至 MiroFish 量级` 的 staging / production 灰度发布流程.

---

## 1. 背景

commit `080e307e` 在不做 LLM 行为变更的前提下, 把 strategicmind 每轮写入的实体/关系节点数从 MiroFish 同等规模的 5-6× 压缩回 MiroFish 80-240 节点量级. 6 大根因 (165 agent 协同诊断, 31/40 通过对抗验证) 分别为: (1) `entity_extractor` prompt 无 `maxItems` + ontology 无白名单导致单 doc 最高 1014 实体; (2) `memory_writeback` 用 uuid 唯一键让 12 轮 × 30 actors 单 run 制造约 540 节点; (3) `pipeline_orchestrator._on_progress` 与 `LoopEngine.write_round` 双写; (4) `WSNode` 按 `action_id` 唯一无 `(slice,round)` 聚合, 携带 dict snapshot 节点 2-5×; (5) `IN_REPLY_TO` 引用不存在 episode 时建无 `created_at` 占位, 5-15 orphan/run; (6) `IterativeSimulationEngine` 用 `iter_{N}` 隔离 run_id, 5 iter 写入 5 份独立 graph 文件.

mock benchmark (3 doc seed, `backend/scripts/benchmark_kg_optimization.py`) 实测: `entities_after_cap` 150 → 75 (2.0×), `relations_after_cap` 294 → 120 (2.45×), `store_relations_unique` 294 → 80 (3.68×), `avg_signal_density` 0.559 → 0.784 (+40%, 排序键生效证据), `store_entities_unique/doc` 50 → 25 (2.0×). 外推 8 doc 真实场景约 280 节点, 对齐 MiroFish 80-240 量级. 集成测试 43 passed / 2 skipped / 0 failed (`test_memory_writeback_integration` / `test_loop_engine_integration` / `test_pipeline` / `test_graph_snapshot_limit` / `test_p4_loop` / `test_loop_v2_orchestrator_integration` / `test_loop_engine_v2` / `test_memory_knowledge_store_merged` / `test_loop_episode_recall` / `test_graph_snapshot_influence`).

---

## 2. Feature Flag 矩阵

| Flag | 默认值 | 读取位置 (file:line) | 关闭后回退行为 |
|------|--------|----------------------|----------------|
| `STRATEGICMIND_USE_HARD_CAP` | `true` | `backend/services/entity_extractor.py:49` `HARD_CAP_ENV_VAR`; `backend/services/graph_builder_service.py:36-39` `_use_hard_cap()` | prompt 不再注入 `AT MOST 25` 硬上限与 8 类型 ontology enum; `_get_max_entities_per_doc()` 从 25 退回 50 (`graph_builder_service.py:_get_max_entities_per_doc`); 不做 `signal_density` 排序与白名单软降级. parser 端硬截断失效, 节点/关系数回到 2× 旧基线. |
| `STRATEGICMIND_USE_NATURAL_KEY` | `false` (T1.5 字节级兼容) | `backend/services/loop/memory_writeback.py:83-85` `USE_NATURAL_KEY` | `EpisodicMemory` 与 `WSNode` 退回 `uuid4` 唯一键, `(actor_id[:12], round_num, slice[:24])` 三维自然键与 `md5(text)[:12]` 内容指纹 episode dedup 失效; `dedup_metrics` 计数器 (`episode_dedup_hits` / `ws_dedup_hits` / `in_reply_to_skipped`) 永远为 0. 单 run 节点数回到 540 量级. |
| `STRATEGICMIND_NO_DOUBLE_WRITE` | `true` | `backend/services/pipeline_orchestrator.py:111-132` `_no_double_write()` | 旧路径恢复: `_on_progress` 每 action 调 `MemoryWriteback.write_action`, 与 `LoopEngine.write_round` 双写 `EpisodicMemory` + `JSON load+save` + `mirror task`. 节点与 mirror graph 全部翻倍, IO 翻 2-3×. |
| `STRATEGICMIND_SHARED_RUN_ID` | `true` | `backend/services/iterative_simulation_engine.py:15` `SHARED_RUN_ID_FLAG`; `:57-65` 实例化读取 | `IterativeSimulationEngine` 退回 `iter_{iteration_num}` 隔离 run_id, 5 iter 在 5 份独立 graph 文件中 5× 重复节点; `EpisodicMemory` 跨 iter 不再自然 dedup, `report_agent` group_by iteration 字段缺失. |
| `STRATEGICMIND_STORE_LOCK_DISABLED` | `false` (lock 启用) | `backend/services/local_knowledge_store.py:66-77` `_STORE_LOCK_DISABLED_ENV` / `_is_store_lock_disabled()`; `__init__` 替换 `_index_lock` 为 `_NullAsyncLock` (`:147-150`) | `LocalKnowledgeStore.insert_entity` 失去 `asyncio.Lock` 保护, `_entity_index` / `_relation_index` 上 check-then-set 出现 race; 并发 insert 同 normalized key 时两路均 `existing_id is None` 并各自分配 uuid, last-writer-wins 写索引, 磁盘文件 duplicate. 性能可提升但正确性退化, 仅在 perf 压测/A-B 对比场景使用. |

注: 全部 flag 均经 `backend/config/manager.py:41-63` `parse_bool()` 集中解析, 接受 `1/true/yes/on` (大小写无关), 解析漂移已修复.

---

## 3. 灰度计划

### 阶段 A — Staging 1 周 (Day 0 ~ Day 6)

- **目标**: 用真实流量回放 + 合成高压力 doc 验证 prompt 硬上限 + dedup 在真实 LLM 下的行为.
- **Flag 配置**: 全部开启 (与 production 一致), 即 `STRATEGICMIND_USE_HARD_CAP=true` + `STRATEGICMIND_NO_DOUBLE_WRITE=true` + `STRATEGICMIND_SHARED_RUN_ID=true` + `STRATEGICMIND_USE_NATURAL_KEY=1` (首次打开, 验证兼容性) + `STRATEGICMIND_STORE_LOCK_DISABLED` 留空 (lock 启用).
- **流量**: 把 production 过去 7 天的 30% 抽样回放, 加 1 套 8 doc 真实种子 doc (贴近 MiroFish 量级) 全量跑.
- **Day 0-1**: 烟测 + LLM 真实调用 (见 §6) + benchmark 三方对照.
- **Day 2-4**: 跑完整 12 轮 × 30 actors run, 监控 §4 指标.
- **Day 5-6**: 切回 baseline flag 跑同样 corpus 对比, 验证可重现.
- **Go / No-Go**: `avg_signal_density >= 0.70` 且 `softdemote_count / total_input < 0.20` 且 `_batch_failures` 空且 `latency_p99` 退化 < 15%.

### 阶段 B — Production 10% 灰度 3 天 (Day 7 ~ Day 9)

- **目标**: 验证小流量在 production 真实环境无回归, 并捕获 P99 退化边界.
- **Flag 配置**: 同 staging 全开, 部署到 10% 的 worker 节点 (按 user_id 末位 hash mod 10 切流).
- **监控重点**: 与 baseline 90% 流量对比 `latency_p99` / `entities_unique_per_doc` / `_batch_failures`. 任意指标 30 分钟连续越界即 §5(a) 单 flag 关闭.
- **Day 7**: 10% 全 flag 跑 + 90% 旧路径, 每小时 diff 一次.
- **Day 8-9**: 维持 10%, 关注长尾 doc (entities > 100 旧路径) 是否在 25 cap 后丢关键信息 (通过后续 query 召回率间接观察).
- **Go / No-Go**: 召回率人工抽样 ≥ baseline 的 95%.

### 阶段 C — Production 全量 (Day 10+)

- **目标**: 推 100% worker 至优化路径, 旧路径保留 7 天作为紧急回滚.
- **Flag 配置**: 同 §3.A, 全开.
- **Day 10**: 推 50%, 观察 6 小时, 推 100%.
- **Day 11-17**: 旧路径保持热部署, 7 天窗口.
- **Day 18+**: 旧路径下线, 清理 `USE_HARD_CAP=false` 分支相关死代码 (后续 P3 任务).

---

## 4. 监控指标清单

| 指标 | 采集位置 (file:line) | 健康阈值 | 越界处理 |
|------|----------------------|----------|----------|
| `softdemote_count` | `backend/services/entity_extractor.py:75` `_extractor_softdemote_count`; `:178` 实例 `self._softdemote_count`; `backend/services/graph_builder_service.py:178` `_softdemote_count` (`:193` `get_softdemote_count()` 暴露) | 单 doc < 输入实体数 20%; 单 run 累计 < 1000 | > 30% 说明 ontology 白名单失配, §5(a) 临时关闭 `STRATEGICMIND_USE_HARD_CAP` 或扩展 `DEFAULT_BOTTOM_TYPES` (`entity_extractor.py:51-58`) |
| `dedup_metrics.episode_dedup_hits` | `backend/services/loop/memory_writeback.py:338` `_dedup_metrics: Dict[str, int]`; `:430` `episode_dedup_hits += 1` | 单 run > 0 (证明 1h 内容指纹 md5 生效) | 持续为 0 说明自然键未打开或时钟漂移, 检查 `STRATEGICMIND_USE_NATURAL_KEY=1` 与 `time.time_ns()` (`:425` 附近) |
| `dedup_metrics.ws_dedup_hits` | `backend/services/loop/memory_writeback.py:684` `ws_dedup_hits += 1` | 单 run > 200 (12 轮 × 30 actor 中 WSNode 重复率高) | 持续 < 50 说明 `(actor, round, slice)` 三维键未触发, 检查 `:83-85` 解析 |
| `dedup_metrics.in_reply_to_skipped` | `backend/services/loop/memory_writeback.py:527` `in_reply_to_skipped += 1` | 单 run < 50 (orphan 应 < 5-15/run 上限) | > 100 说明上游 episode 时序错乱, 检查 `EpisodicMemory` flush 顺序 |
| `_batch_failures` | `backend/services/entity_extractor.py:173` `self._batch_failures: List[str]`; `:300-301` 容量 100 追加; 暴露给 `__repr__` | 任意 5 分钟窗口增量 < 5 条 | 持续上涨说明 LLM provider 不稳定, §5(a) 关闭 `STRATEGICMIND_USE_HARD_CAP` 让 mock fallback 接管 |
| `avg_signal_density` | `backend/services/graph_builder_service.py:137-150` `_signal_score()` 优先读 `attributes["signal_density"]`; 排序键 `entity_extractor.py:480-486` `-float((e.attributes or {}).get("signal_density", 0.5))` | >= 0.70 (mock 基线 0.784) | < 0.55 说明 LLM 没遵循 `signal_density: float in [0.0, 1.0]` prompt 指令 (`kg_prompts.py:233`), §5(a) 关闭 hard-cap 让 LLM 完全自由发挥作为短期降级 |
| `store_entities_unique_per_doc` | `LocalKnowledgeStore._entity_index` 键数 / 处理 doc 数; benchmark 报告 `entities_after_cap` | 8-25 entities/doc (取决于 cap) | > 50 说明 cap 失效, 立即 §5(a) 关 hard-cap 排查 |
| `latency_p99` | Flask / worker 接入 Prometheus 客户端直方图 | 与 baseline 相比退化 < 15% | > 25% 即 §5(a) 优先关 `STRATEGICMIND_STORE_LOCK_DISABLED` 排查锁竞争, 再 §5(b) 全 flag 关闭 |

指标 dashboard 建议 (P2 后续): 把以上 6 项 + latency 接入 staging Prometheus + Grafana 面板, 每 5 min 采样, 越界告警走企业微信机器人.

---

## 5. 回滚步骤

### (a) 单 flag env 即时关闭 (无需重启 worker)

- **适用**: 单点越界 (如 `_batch_failures` 上涨 / `softdemote_count` 异常 / `latency_p99` 锁竞争), 其他 flag 行为正常.
- **做法**: 在 worker 进程的 systemd / supervisor 环境直接 `export STRATEGICMIND_<FLAG>=0` 并触发配置 reload; `_parse_bool()` (`backend/config/manager.py:41-63`) 与 `_no_double_write()` (`backend/services/pipeline_orchestrator.py:114-132`) 每次调用重读 env, 下一条请求即生效.
- **注意**: `STRATEGICMIND_STORE_LOCK_DISABLED` 在 `LocalKnowledgeStore.__init__` 时一次性快照 (`local_knowledge_store.py:69-77`), 改 env 后需重启 worker 才能换 `_NullAsyncLock` / `asyncio.Lock`.
- **回滚时延**: 1 个请求 RTT (< 5s).

### (b) 全 flag 关闭 (需重启 worker)

- **适用**: 多指标同时越界 / LLM provider 全面不可用 / 召回率显著下降, 怀疑 prompt 硬上限与白名单联合生效引发副作用.
- **做法**: `unset STRATEGICMIND_USE_HARD_CAP STRATEGICMIND_USE_NATURAL_KEY STRATEGICMIND_NO_DOUBLE_WRITE STRATEGICMIND_SHARED_RUN_ID` (恢复默认), 同时 `systemctl restart strategicmind-worker` 重建所有 in-process `LocalKnowledgeStore` 锁与 `EpisodicMemory` 状态. 预计 worker pool 滚动重启 2-3 分钟.
- **回滚时延**: 3-5 分钟 (含健康检查).

### (c) `git revert 080e307e` 后重新部署

- **适用**: 严重回归 (如 graph 文件 corruption / 数据回放后下游 query 集体失效 / benchmark 反向劣化), 怀疑 commit 本身设计有缺陷.
- **做法**:
  1. `git revert --no-edit 080e307e` 在 release 分支上, 解决可能冲突 (重点 `backend/services/pipeline_orchestrator.py:104-132` 与 `loop/memory_writeback.py:80-85`).
  2. 跑 `pytest backend/tests/test_memory_writeback_integration.py backend/tests/test_loop_engine_integration.py backend/tests/test_pipeline.py` 验证回归 — 必须 100% 通过.
  3. CI 通过后 `git push` 触发 production 部署 pipeline, 灰度 10% → 50% → 100% 节奏同 §3.C, 但反向 (baseline 100% → optimized 0%).
  4. 部署后保留 7 天观察窗, 同时新开 P2.5 任务根因复盘.
- **回滚时延**: 30-60 分钟 (含 CI).

---

## 6. 真实 LLM 烟测脚本调用方式

> 适用于 staging 第一天 (Day 0-1) 验证 prompt 硬上限在真实 LLM 下行为; 不要在 production 跑, 避免污染线上数据.

```bash
# 1) 准备环境变量 (以阿里云 bailian / qwen-plus 为例)
export STRATEGICMIND_USE_HARD_CAP=true
export STRATEGICMIND_USE_NATURAL_KEY=1
export STRATEGICMIND_NO_DOUBLE_WRITE=true
export STRATEGICMIND_SHARED_RUN_ID=true
export LLM_PROVIDER=bailian
export LLM_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
export LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
export LLM_MODEL_NAME=qwen-plus

# 2) 去掉 --mock 走真实 LLM 路径
cd /Users/jasonlee/strategicmind
python3 backend/scripts/benchmark_kg_optimization.py --mode=optimized

# 3) 与 baseline 对照
python3 backend/scripts/benchmark_kg_optimization.py --mode=baseline > /tmp/baseline.json 2>&1
python3 backend/scripts/benchmark_kg_optimization.py --mode=optimized > /tmp/optimized.json 2>&1
diff /tmp/baseline.json /tmp/optimized.json | head -100
```

**预期结果** (来自 `backend/scripts/benchmark_kg_optimization.py:11-19` 注释 + `entity_extractor.py:320-321` `AT MOST 25` 硬契约):

- `entities_returned` per doc ≤ 30 (硬上限 25 + soft demote 5-10% 漂移), mock 路径下严格 ≤ 25.
- `relations_returned` per doc ≤ 60, mock 路径下严格 ≤ 40.
- `avg_signal_density` ≥ 0.70 (mock 0.784), 比 baseline 提升 ≥ 25%.
- `_batch_failures` 在 8 doc run 下应为 0; 若 > 0 说明 LLM JSON parse 失败, 需检查 `entity_extractor.py:300-301` 100 容量 ring buffer 采样.
- `store_entities_unique/doc` 在 8 doc 真实场景约 20-30, 接近 MiroFish 80-240 节点 (按 8 doc 折算).

**注意**: mock 路径 (`--mock`, 默认开) 不响应 prompt 硬上限, 因为 mock 直接返回固定 60/100 payload (`benchmark_kg_optimization.py:78-90` 附近), 真实 LLM 才会按 prompt 收敛. 比较时务必 `entities_returned` 截断在 parser 端 (`entity_extractor.py:351` 附近) 与 LLM 端 `AT MOST 25` 双向检查.

---

## 7. 已知 Limitation

1. **Mock 不响应 prompt 硬上限** — `backend/scripts/benchmark_kg_optimization.py:78-90` 返回固定 60 entity / 100 relation JSON, 无论 `STRATEGICMIND_USE_HARD_CAP` 开关, 都得靠 parser 端硬截断 (`entity_extractor.py:351` 附近) 才能收敛; mock benchmark 测的是 *代码路径* (cap / whitelist / soft demote / sort) 而非 *prompt 服从度*, §6 必须用真实 LLM 验证. 见 `benchmark_kg_optimization.py:21-25` 注释.
2. **软降级桶占节点配额** — `backend/services/graph_builder_service.py:289-296` 把白名单未命中的实体软降级为 `Concept` 并打 `__is_fallback=True` + `[fallback]` 前缀, 这些 fallback 节点计入 `_get_max_entities_per_doc()` 25 cap 名额, 在高 OOV 场景 (如金融 ticker / 化学式) 会挤压真实高 signal 实体, 短期缓解靠扩展 `DEFAULT_BOTTOM_TYPES` (`entity_extractor.py:51-58`), 长期靠 P2-5 taxonomy 可扩展.
3. **实体类型 taxonomy 在 FAANG / 金融场景过窄** — `backend/services/entity_extractor.py:51-58` `DEFAULT_BOTTOM_TYPES` 当前 8 个 bottom type (Person / Organization / Location / Concept / Event / Product / Document / Metric), FAANG 内部代号 / 金融衍生品 (CDS, CDO, SPV) / 监管机构 (SEC, FASB) 都被软降级为 `Concept`, 前端 `display_name` 剥离 `[fallback]` 前缀约定 (P2 后续) 尚未落地, 暂以 namespace 隔离保证不污染主图.
4. **`STRATEGICMIND_USE_NATURAL_KEY` 默认关闭** — `backend/services/loop/memory_writeback.py:83-85` 为 T1.5 acceptance 字节级兼容, 默认 `0`; §3.A 阶段第一次打开需要重点跑 `test_memory_writeback_integration.py` 与回归测试, 若发现老 episode 文件结构不兼容需先做一次性 migrate (建议保留 7 天, 旧 run 仍按 uuid 键读).
5. **`STRATEGICMIND_STORE_LOCK_DISABLED` flag 改完需重启** — `backend/services/local_knowledge_store.py:69-77` `_is_store_lock_disabled()` 在 `__init__` 一次性快照, 不会响应运行时 env 变化; §5(a) 紧急关闭锁的步骤不适用于本 flag, 必须走 §5(b) 重启 worker 或 §5(c) revert, 已在 `local_knowledge_store.py:28-32` 文档中标注.

---

## 8. 引用速查

- commit: `080e307e` `perf(knowledge-graph): 收敛 strategicmind 每轮节点至 MiroFish 量级`
- 主入口: `backend/services/entity_extractor.py:48-79` (HARD_CAP env + soft demote counter)
- 写入路径: `backend/services/loop/memory_writeback.py:80-85` (USE_NATURAL_KEY), `:338` (dedup_metrics), `:430` `:527` `:684` (三个计数点)
- 双写消除: `backend/services/pipeline_orchestrator.py:104-132`
- 共享 run_id: `backend/services/iterative_simulation_engine.py:15` `:57-65`
- Store lock: `backend/services/local_knowledge_store.py:66-77` `:147-150`
- 集中解析: `backend/config/manager.py:41-63` `parse_bool()`
- benchmark: `backend/scripts/benchmark_kg_optimization.py:1-31` `:78-90`
- 集成测试覆盖: 43 passed / 2 skipped / 0 failed (见 §1)
