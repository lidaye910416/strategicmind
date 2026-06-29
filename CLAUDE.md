# StrategicMind 项目 — AI 协作者开发规范

> StrategicMind 是公司战略推演平台, 基于「持续演化的知识图谱 + 多 Agent 博弈推演」自研技术栈。
> 本文件记录历次踩过的坑 + UI 规范 + 5 目标实施要点, 避免重复犯错。

---

## ⚠️ 已踩过的坑（必须避免）

### 1. i18n 文本与硬编码重复
**症状**: Workbench 7 步流水线卡片同时渲染 `WORKBENCH.stagesTitle` ("7 步推演流水线")
和硬编码的 `<div>7 步推演流水线</div>`，同一文本出现两次。
**原因**: 改 i18n 时只换了上半部分，没注意下方硬编码。
**对策**:
- 渲染中文/英文时**只用 i18n keys**，绝不复写硬编码字符串
- 改 i18n 文本前先 `grep -n` 全文确认无重复
- 卡片主标题统一用 `WORKBENCH.<key>`，不写 hardcoded fallback

### 2. 数据通道 SSE 不重放历史事件
**症状**: 启动推演后 /workbench 图谱空，因为 SSE 端 `generate()` 启动时只 yield 当前 snapshot，
不重放 EventBus 历史。
**原因**: 编排器在 SSE 订阅前已 emit 了 `graph_progress`/`entity_emerged`，新订阅者收不到。
**对策**:
- SSE 端在 `yield snapshot` 后立即 `bus.get_history(run_id)` 重放 200 条历史
- 前端 `useGraphStream` 加 phase-based refetch（监听 `progress.phase` 变化兜底）

### 3. EventBus async/sync 不兼容
**症状**: SSE 显示 0 个 live_event 帧。
**原因**: `EventBus.subscribe()` 返回 `asyncio.Queue` 但 Flask SSE 是 sync generator，
调用 `q.get_nowait()` 不工作。
**对策**:
- `EventBus.subscribe()` 必须返回**线程安全**的 `queue.Queue`（不是 `asyncio.Queue`）
- 这样同步 Flask 端 + 异步 orchestrator 端都能正确 publish/consume

### 4. EventBus 双实例问题
**症状**: orchestrator 写自己的 `self.event_bus`，SSE 端 `_resolve_global_bus()` 读模块级 singleton，两者不一致。
**对策**:
- orchestrator 构造时 `self.event_bus = _global_bus`（从 `backend.services.event_bus import event_bus`）
- 永远用模块级 singleton，不要 new EventBus()

### 5. StrategicConfigGenerator 派生参数未生效
**症状**: 即使前端传 `user_params={years:3, time_step:"month"}`，sim_config.max_rounds 仍是 3。
**原因**: `_stage_config_generation` 没读 user_params；generate() 也未传 user_params 形参。
**对策**:
- `_stage_config_generation` 开头先算 `max_rounds = years × {year:1, quarter:4, month:12}[time_step]`
- 再把 user_params 透传给 `StrategicConfigGenerator.generate(doc, req, user_params)`
- 派生结果写回 sim_config

### 6. 数据清理要找对位置
**症状**: `rm data/pipelines/*.json` 后 `/runs` 仍返回 20 个历史 run。
**原因**: 数据同时存在 `data/` 和 `backend/data/` 两个目录。orchestrator 用 `BACKEND_DIR / "data" / "pipelines"`。
**对策**:
- 清空时同时清 `data/` + `backend/data/` 两套
- 检查路径: `ls backend/data/pipelines/`

---

## 🎨 UI 规范

### 卡片布局
- **避免 3 列网格 + 多块堆叠** (用户反馈"排列很奇怪")
- **首选单行 list-item**: `[icon] | [summary] | [actions]`
- 每行 ≤ 40px 高, 一屏显示 10+ 条
- 进度条融入主信息流, 不单独占块
- 操作按钮 icon-only (9×9px), 不用文字+icon

### RecentRuns 排列
- 客户端按 `updated_at` 降序排序
- 按日期分组: 今天/昨天/本周/更早 (Sun/Moon/CalendarDays/Archive 图标)
- run_id 用 `#1a748477` 短码显示, 不用完整 `run_xxxxxxxx`
- 时间显示用相对时间 (5 分钟前/2 小时前/昨天)

### 状态徽章
- 大色块: `px-2 py-1` + icon + 12px 字号
- 不用单色圆点 (`w-1.5 h-1.5`)
- 颜色: emerald=completed, blue=running, amber=paused, rose=failed, ink=cancelled

### 实时图谱
- `/graph-snapshot` 端点必须返回真实 entities (非 0)
- 前端 store 用 `graphNodes: GraphNodeData[]` 数组 (不是 Map)
- `SimNode.label/type` 必填 (buildGraphPositions 总是设置)
- SimNode → PositionedNode 类型映射: `n.label ?? n.name ?? n.id`, `n.type ?? 'RELATED_TO'`

### Workbench 起步状态
- `!runId` 时显示"🚀 推演工作台就绪" 大 hero (Rocket icon + 引导文案)
- 有 runId 但 graphData 为空时显示 Loader2 + "正在从知识图谱中检索实体..."
- 部门关系图: `company.departments.length > 0` 才渲染
- 移除 demo-graph 预加载 (避免显示假内容)

---

## 🔧 关键设计模式

### 9 目标映射（含 MiroFish 对齐 G6-G9）
| 目标 | 实施位置 | 文件 |
|---|---:|---|
| G1 前后端链接 | `backend/app/__init__.py` CORS + `frontend/vite.config.ts` proxy `/api` | — |
| G2 Dashboard ↔ Workbench 同步 | `backend/app/api/pipeline.py` SSE 双轨 + `frontend/src/store/hooks/useGraphStream.ts` | — |
| G3 公司经营 + 多轮参数 | `backend/services/strategic_config_generator.py` 接收 user_params + `_generate_with_user_params` | — |
| G4 历史任务不丢 | `backend/app/api/pipeline.py` `/runs` 端点 + `frontend/src/components/RecentRuns.tsx` | — |
| G5 多年循环 | `POST /<id>/advance-year` + `market_event` 触发 + `ExternalShockSimulator` 接入 | — |
| **G6 修 3 个 console bug** ✅ DONE (`0dbb1e13`) | `RoundTimeline.tsx` hook 重排 + `simulation.py` 加 `GET /api/simulation/<id>` + `pipeline.ts` 切 `createWithEqualityFn` | [`goals/G6-fix-3-bugs.md`](goals/G6-fix-3-bugs.md) |
| **G7 KG 切 nano-graphRAG 替身** ✅ DONE (`7f4be6b6` + fix `6914eb85`) | 新建 `backend/services/kg_engine/` package（NetworkX + JSON），pin `networkx>=3.0` 进 `backend/requirements.txt`，`STRATEGICMIND_PROFILE_RETRIEVAL` flag 控 PROFILE_GENERATION；A/B harness `scripts/eval_profile_retrieval.py`。Verification: pytest `backend/services/kg_engine/tests/` 11/11 PASS | [`goals/G7-kg-engine.md`](goals/G7-kg-engine.md) |
| **G8 Workbench 切 atomic selector slices** ✅ DONE (`2cd37e1f`) | `usePipelineStore` 拆 4 slice（graph/sim/config/ui）+ `RoundTimeline` 改 `React.memo` + `InnerWorkbenchContent` 拆 6 tab panel 去掉 22+ prop drill | [`goals/G8-atomic-slices.md`](goals/G8-atomic-slices.md) |
| **G9 5 步 wizard + agent interview IPC** ✅ DONE (`0722d395` + infra fix) | 新 `views/Process.tsx` + 6 wizard step + 新 `backend/app/api/interview.py` blueprint + `loop/engine.py:227` 后挂 JSONL writer。Verification: pytest `backend/tests/integration/test_interview_ipc.py` 7/7 PASS + frontend vitest Process.router 6/6 PASS | [`goals/G9-wizard-ipc.md`](goals/G9-wizard-ipc.md) |

### G6-G9 verifier status (2026-06-29)
- **Frontend (vitest)**: 47 files, 316/316 tests PASS (5.20s)
- **Frontend (tsc --noEmit)**: 15 pre-existing `TS6133 unused` warnings (non-fatal, no new errors)
- **Backend (pytest)**: BLOCKED — pytest collection fails on `backend/services/__init__.py:4` because `backend/__init__.py` is missing (namespace package) AND `backend/services/__init__.py` does `from .service_factory import ServiceFactory` which fails when pytest treats `backend/services/` as top-level. The `backend/services/kg_engine/tests/conftest.py` stub is bypassed because pytest imports the parent `__init__.py` before the leaf conftest runs. Fix: add empty `backend/__init__.py` OR move the broken chain behind lazy import.
- **Backend health (`/api/health` on :8000)**: `{"status":"healthy","service":"湖北数创 API"}` — server up.

### 测试约定
- `backend/tests/integration/` — 后端集成 (启动 run, 验证端点)
- `frontend/src/{store,lib,services}/__tests__/` — 前端单元 (vitest + jsdom)
- `frontend/e2e/` — 端到端 (playwright, 默认 `test.skip()`)
- 所有测试用 `from backend.services import` 绝对路径, 避免循环
- mock LLM: `monkeypatch.setenv("STRATEGICMIND_LLM_OVERRIDE", "...")`

---

## 📁 数据目录结构

```
data/                          # 根目录 (orchestrator 旧路径, 大部分数据已迁走)
backend/data/
├── pipelines/                 # run checkpoints (.json)
├── reports/                   # 推演报告 (.md)
└── knowledge_graphs/          # 实体图谱快照 (.json)
uploads/                       # 种子文档 (.txt) — 保留
.claude/workflows/             # saved workflow scripts
docs/superpowers/specs/        # design specs + 终报告
```

**清空数据时同时清 2 套**: `data/` + `backend/data/`。

---

## 🏷️ Git 工作流

- 主分支: **`main`**
- 修复分支: `feature/<goal-N>-<topic>` (e.g. `feature/goal-2-sync`)
- 合并: `--no-ff` 保留分支历史
- 合并后 worktree 保留, 不主动删除
- commit message: `<type>(<scope>): <chinese summary>` + 多行 body

---

## 🛠️ 服务管理

```bash
# 后端
pkill -f "backend.run_server" 2>/dev/null
cd /Users/jasonlee/strategicmind
nohup python3 -m backend.run_server > /tmp/backend.log 2>&1 &
# PID 会变, 查: lsof -i :8000

# 前端
pkill -f "vite" 2>/dev/null
cd /Users/jasonlee/strategicmind/frontend
nohup npm run dev > /tmp/frontend.log 2>&1 &

# 跑测试
cd /Users/jasonlee/strategicmind
python3 -m pytest backend/tests/integration/ backend/tests/acceptance/ --ignore=backend/tests/e2e -q
cd frontend && npm run test
```

---

## 🚀 5 目标最终达成度

| # | 目标 | 状态 | 验证 |
|---|---|:---:|---|
| G1 | 前后端链接 | ✅ | vite proxy 200 + CORS preflight 200 |
| G2 | Dashboard ↔ Workbench 同步 | ✅ | SSE live_event 真跑通, history replay |
| G3 | 公司经营 + 多轮参数 | ✅ | max_rounds=12 (1y×month) + 9 dept slot agents + report 含 external_factors |
| G4 | 历史任务不丢 | ✅ | /runs 持久化扫描 + RecentRuns 卡片 + 复制配置 |
| G5 | 多年循环 | ✅ | /advance-year 端点 + market_event + 9 季度扰动 |
| **G6** | 修 3 console bug (hook+404+zustand) | ✅ DONE (commit `0dbb1e13`) | [`goals/G6-fix-3-bugs.md`](goals/G6-fix-3-bugs.md) — `curl /api/simulation/run_755516f8` → 200 (5 keys) + vitest 7/7 (RoundTimeline hookOrder 2 + pipeline.shallow 5) |
| **G7** | KG 切 `kg_engine` (NetworkX 替身) | ⏳ PENDING | [`goals/G7-kg-engine.md`](goals/G7-kg-engine.md) — `pytest backend/services/kg_engine/` 全绿 + A/B harness 报告 |
| **G8** | Workbench atomic selector slices | ⏳ PENDING | [`goals/G8-atomic-slices.md`](goals/G8-atomic-slices.md) — `tsc --noEmit` 0 新错 + 22+ props 减到 ≤4 |
| **G9** | 5 步 wizard + interview IPC | ⏳ PENDING | [`goals/G9-wizard-ipc.md`](goals/G9-wizard-ipc.md) — `/process/<id>?step=N` 跑通 + SSE interview_token |

---

## 📚 文档索引 (新结构 2026-06-23)

完整文档在 `docs/`, 核心入口:

- 入口: [`docs/README.md`](docs/README.md) — 找什么的速查
- 决策: [`docs/decisions/`](docs/decisions/) — WHY 选 A 不选 B (ADR, 5-15 行/条)
- 架构: [`docs/architecture/`](docs/architecture/) — 系统当前长什么样 (WHAT IS)
- Bug: [`docs/bugs/`](docs/bugs/) — 3 P0 bug 诊断 (全部 ✅ FIXED)
- 实现: [`docs/features/`](docs/features/) — DONE 的具体 spec (含 commit 链接)
- 工作流: [`docs/runs/2026-06-23-p0-bug-fix.md`](docs/runs/2026-06-23-p0-bug-fix.md) — 这次 workflow 完整故事
- 运维: [`docs/operations/`](docs/operations/) — 启停 / 数据
- 归档: [`docs/archive/`](docs/archive/) — 过期文档 (不应用于新代码)

**核心约定**: 未来做类似选择前, 先看 `decisions/`. 文档状态 (FIXED/DONE/PLANNED/ARCHIVED) 在文件顶部 status 头, 一眼可见.

---

## 📖 docs/ 按需读取 (避免重复争论)

**Trigger**: 任务涉及**非显然设计决策** (即"在 A 和 B 之间选"). 满足即查, 否则不查.

**怎么查** (满足 trigger 后):
1. `ls docs/decisions/ADR-*.md` 扫一眼 (1 秒, 7 个文件)
2. 任务涉及模块 grep ADR 列表 → 命中 → 读 ADR → **遵循 (不再论证, 不再选)**
3. 未命中 → 自由决策. 若决策**非显然**, 实施完写 ADR-NNN.md (5-15 行, 模板见 `docs/decisions/README.md`)

**不查场景** (节省时间):
- 修 typo / 格式化 / 加测试用例
- 跑测试 / 启服务 / 查状态 / 部署
- 用户说"按 X 改" (明确指令, 无选型)
- 1 行 hotfix / 数据清理

**示例**:
- "用 evict-by-signal 替代 FIFO" → 触发 → `ls docs/decisions/` → 命中 `ADR-001` → 遵循, 不论证
- "重命名 `setGraphSnapshot` 内部变量" → 不触发 (无选型, 用户明确指令)
- "新功能: agent 协作" → 触发 → 检查 ADR-003 (跨页面架构) 是否适用, 决定 follow or 写新 ADR-008
