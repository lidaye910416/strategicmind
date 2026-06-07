# StrategicMind 项目 — AI 协作者开发规范

> StrategicMind 是基于 MiroFish 范式的公司战略推演平台。
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

### 5 目标映射
| 目标 | 实施位置 |
|---|---|
| G1 前后端链接 | `backend/app/__init__.py` CORS + `frontend/vite.config.ts` proxy `/api` |
| G2 Dashboard ↔ Workbench 同步 | `backend/app/api/pipeline.py` SSE 双轨 + `frontend/src/store/hooks/useGraphStream.ts` |
| G3 公司经营 + 多轮参数 | `backend/services/strategic_config_generator.py` 接收 user_params + `_generate_with_user_params` |
| G4 历史任务不丢 | `backend/app/api/pipeline.py` `/runs` 端点 + `frontend/src/components/RecentRuns.tsx` |
| G5 多年循环 | `POST /<id>/advance-year` + `market_event` 触发 + `ExternalShockSimulator` 接入 |

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

- 主分支: **`main`** (从 `ralph/mirofish-refactor` 重命名)
- 修复分支: `feature/<goal-N>-<topic>` (e.g. `feature/goal-2-sync`)
- 合并: `--no-ff` 保留分支历史
- 合并后 worktree 保留, 不主动删除
- commit message: `<type>(<scope>): <chinese summary>` + 多行 body

---

## 🛠️ 服务管理

```bash
# 后端
pkill -f "backend.run_server" 2>/dev/null
cd /Users/jasonlee/mirofish-refactor
nohup python3 -m backend.run_server > /tmp/backend.log 2>&1 &
# PID 会变, 查: lsof -i :8000

# 前端
pkill -f "vite" 2>/dev/null
cd /Users/jasonlee/mirofish-refactor/frontend
nohup npm run dev > /tmp/frontend.log 2>&1 &

# 跑测试
cd /Users/jasonlee/mirofish-refactor
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
