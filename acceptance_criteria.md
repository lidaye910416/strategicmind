# 验收标准

> 每个 PRD 的可执行验收条件。测试文件位于 `tests/acceptance/`。
> **测试通过 = 验收通过。** 运行：`pytest tests/acceptance/ -v`

---

## 索引

| PRD | 标题 | 测试文件 | 关键指标 |
|-----|------|---------|---------|
| PRD-001 | 本地 Graph RAG 替代方案 | `test_graphrag_migration.py` | 搜索召回率 ≥70%，P99 <2s |
| PRD-002 | 基础功能重构 | `test_interface_abstraction.py` | Provider 切换 0 改动，0 Service 自己读 env |
| PRD-003 | SimulationRunner 拆分 | `test_simulation_runner_split.py` | 主类 ≤200 行，6 组件均可单测 |
| PRD-004 | AgentProfile 生成重构 | `test_profile_generation.py` | CSV/JSON 字段完整，Zep Import = 0 |
| PRD-005 | API 层迁移与本体 Schema 本地化 | `test_api_layer.py` | Zep Import = 0，`OntologySchema` JSON 有效 |
| PRD-006 | 种子文档智能生成与丰富 | `test_seed_document_pipeline.py` | 报告 ≥3000 字，实体 ≥10，<20min |
| PRD-007 | 大规模 Agent 调度与异步架构 | `test_large_scale_scheduling.py` | 1000 Agent <5min，并发 ≤30 |
| PRD-008 | Agent 分群与多轮迭代分析 | `test_iterative_analysis.py` | 收敛率 ≥80% |
| PRD-009 | 端到端自动化链路编排 | `test_pipeline_orchestration.py` | 7 步全自动，暂停/恢复，checkpoint |
| **PRD-010** | **战略模拟引擎核心设计** | `test_strategic_simulation_engine.py` | **✅ MVP 已通过** |

---

## PRD-010 · 战略模拟引擎 — 完整 US 清单

```bash
# 核心模型
pytest tests/acceptance/test_strategic_simulation_engine.py::TestStrategicAgentModel -v
pytest tests/acceptance/test_strategic_simulation_engine.py::TestActionTypeAndStrategicAction -v

# 信念引擎
pytest tests/acceptance/test_strategic_simulation_engine.py::TestBeliefEngine -v

# 配置生成
pytest tests/acceptance/test_strategic_simulation_engine.py::TestStrategicConfigGenerator -v

# 决策引擎
pytest tests/acceptance/test_strategic_simulation_engine.py::TestLLMDecisionEngine -v

# 模拟循环
pytest tests/acceptance/test_strategic_simulation_engine.py::TestSimulationLoop -v

# 传播层
pytest tests/acceptance/test_strategic_simulation_engine.py::TestPropagationLayer -v

# Runner
pytest tests/acceptance/test_strategic_simulation_engine.py::TestStrategicSimulationRunner -v

# 脚本 + Pipeline 集成
pytest tests/acceptance/test_strategic_simulation_engine.py::TestRunStrategicSimulationScript -v
pytest tests/acceptance/test_strategic_simulation_engine.py::TestPipelineIntegration -v

# 能力对比（vs OASIS）
pytest tests/acceptance/test_strategic_simulation_engine.py::TestStrategicVsOasisCapabilities -v
```

> 当前 `tests/acceptance/` 下只有 `test_strategic_simulation_engine.py`，其他测试文件在对应 PRD 实现时创建。

---

## 运行命令

```bash
# 所有验收测试
pytest tests/acceptance/ -v

# 按 PRD
pytest tests/acceptance/test_strategic_simulation_engine.py -v

# 按单个 US
pytest tests/acceptance/test_strategic_simulation_engine.py::TestStrategicAgentModel::test_strategic_agent_importable -v

# 覆盖率
pytest tests/acceptance/ --cov=backend --cov-report=term -v
```
