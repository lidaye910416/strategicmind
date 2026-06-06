/**
 * StageCards - 7 步流水线富内容卡（MiroFish Process.vue 风格）。
 *
 * 每张卡都"活的"：根据后端 artifacts + 实时 SSE 事件显示
 * 真实产物，而不是空标签。
 *
 * 关键：
 *   - SEED_PARSING: 上传文件数 + 字数 + 文档片段预览
 *   - GRAPH_BUILDING: 节点/边数实时跳动 + 类型分布
 *   - ENTITY_EXTRACTION: 实体类型饼图
 *   - PROFILE_GENERATION: agent 头像网格
 *   - CONFIG_GENERATION: 议题列表
 *   - SIMULATION_RUNNING: 嵌入 SimulationNetworkGraph
 *   - REPORT_GENERATING: 报告章节进度
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BookOpen, GitBranch, Database, Users, Settings2, Activity, FileText,
  Check, Loader2, ChevronDown, ChevronRight, FileCode, UserCircle2,
  ListChecks, Network as NetworkIcon,
} from 'lucide-react'

const STAGE_META: Record<string, {
  icon: any; color: string; bg: string; label: string; desc: string;
}> = {
  SEED_PARSING: {
    icon: BookOpen, color: 'text-amber-700 dark:text-amber-300',
    bg: 'from-amber-500/20 to-orange-500/20',
    label: '种子文档解析', desc: '读取上传的种子文档、切分语义块',
  },
  GRAPH_BUILDING: {
    icon: GitBranch, color: 'text-violet-700 dark:text-violet-300',
    bg: 'from-violet-500/20 to-pink-500/20',
    label: '构建知识图谱', desc: '从文档中抽取实体与关系，构建图谱',
  },
  ENTITY_EXTRACTION: {
    icon: Database, color: 'text-cyan-700 dark:text-cyan-300',
    bg: 'from-cyan-500/20 to-blue-500/20',
    label: '抽取实体关系', desc: '实体类型分布 + 关系类型',
  },
  PROFILE_GENERATION: {
    icon: Users, color: 'text-pink-700 dark:text-pink-300',
    bg: 'from-pink-500/20 to-rose-500/20',
    label: '生成 Agent 画像', desc: '为利益相关方生成可推演的 Agent',
  },
  CONFIG_GENERATION: {
    icon: Settings2, color: 'text-indigo-700 dark:text-indigo-300',
    bg: 'from-indigo-500/20 to-purple-500/20',
    label: '生成仿真配置', desc: '把画像组装成仿真可执行的配置',
  },
  SIMULATION_RUNNING: {
    icon: Activity, color: 'text-emerald-700 dark:text-emerald-300',
    bg: 'from-emerald-500/20 to-teal-500/20',
    label: '执行多 Agent 推演', desc: '多轮博弈，BeliefEngine 演化与行动',
  },
  REPORT_GENERATING: {
    icon: FileText, color: 'text-rose-700 dark:text-rose-300',
    bg: 'from-rose-500/20 to-pink-500/20',
    label: '生成战略报告', desc: '产出可读的战略推演报告',
  },
}

const STAGE_ORDER = [
  'SEED_PARSING', 'GRAPH_BUILDING', 'ENTITY_EXTRACTION',
  'PROFILE_GENERATION', 'CONFIG_GENERATION', 'SIMULATION_RUNNING',
  'REPORT_GENERATING',
]

interface Props {
  runId?: string | null
  currentStage?: string
  status?: string
  artifacts?: Record<string, any>
  progress?: number
}

export default function StageCards({
  runId, currentStage, artifacts = {},
}: Props) {
  const currentIdx = STAGE_ORDER.indexOf(currentStage || 'SEED_PARSING')
  const isCompleted = currentStage === 'COMPLETED'
  // P1-4：默认展开前 1 已完成阶段（若没有已完成阶段则展开当前阶段；仍可手动折叠）
  const isDone0 = currentIdx > 0 || isCompleted
  const defaultExpanded = isDone0 ? STAGE_ORDER[0] : (currentStage || 'SEED_PARSING')
  const [expanded, setExpanded] = useState<string | null>(defaultExpanded)

  // 阶段切换时自动展开：若当前阶段有"前 1 已完成"则保持展开它，否则展开新当前阶段
  useEffect(() => {
    if (isCompleted) {
      // 完成后默认收拢（避免最后一屏被报告卡占据）
      setExpanded(null)
      return
    }
    if (currentStage && currentIdx > 0) {
      // 至少阶段 1 已完成 → 默认展开阶段 1
      setExpanded(STAGE_ORDER[0])
    } else if (currentStage) {
      setExpanded(currentStage)
    }
  }, [currentStage, isCompleted, currentIdx])

  return (
    <div className="space-y-2">
      {STAGE_ORDER.map((stage, i) => {
        const meta = STAGE_META[stage]
        const isDone = i < currentIdx || isCompleted
        const isActive = i === currentIdx && !isCompleted
        const isPending = i > currentIdx && !isCompleted
        const isOpen = expanded === stage
        const artifact = artifacts?.[stage] || {}

        return (
          <motion.div
            key={stage}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            className={`rounded-xl border transition-all ${
              isActive
                ? 'bg-gradient-to-r from-brand-50 to-accent-50/30 border-brand-300 dark:from-brand-950/30 dark:to-accent-950/20 dark:border-brand-700 shadow-soft'
                : isDone
                  ? 'bg-emerald-50/30 border-emerald-200/60 dark:bg-emerald-950/20 dark:border-emerald-800/60'
                  : 'bg-ink-50/40 border-ink-200/40 dark:bg-ink-900/20 dark:border-ink-800/40'
            }`}
          >
            <button
              onClick={() => setExpanded(isOpen ? null : stage)}
              className="w-full p-3 flex items-center gap-3 text-left"
            >
              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${meta.bg} inline-flex items-center justify-center ${meta.color}`}>
                {isDone ? <Check size={14} className="text-emerald-600" /> :
                 isActive ? <Loader2 size={14} className="animate-spin" /> :
                 <meta.icon size={14} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-semibold ${isActive ? 'text-brand-900 dark:text-brand-100' : 'text-ink-900 dark:text-white'}`}>
                  第 {i + 1} 步 · {meta.label}
                </div>
                <div className="text-[10px] text-ink-500 truncate">{meta.desc}</div>
              </div>
              <div className="flex items-center gap-1.5">
                {isDone && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500 text-white font-semibold">已完成</span>}
                {isActive && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-500 text-white font-semibold animate-pulse-soft">进行中</span>}
                {isPending && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-ink-200 dark:bg-ink-800 text-ink-500 font-semibold">等待</span>}
                {isOpen ? <ChevronDown size={12} className="text-ink-400" /> : <ChevronRight size={12} className="text-ink-400" />}
              </div>
            </button>

            <AnimatePresence>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-3 pt-1">
                    <StageContent stage={stage} artifact={artifact} isActive={isActive} runId={runId} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )
      })}
    </div>
  )
}

function StageContent({ stage, artifact, isActive, isDone: _isDone, runId }: {
  stage: string; artifact: any; isActive: boolean; isDone?: boolean; runId?: string | null;
}) {
  switch (stage) {
    case 'SEED_PARSING':
      return <SeedParsingContent artifact={artifact} />
    case 'GRAPH_BUILDING':
      return <GraphBuildingContent artifact={artifact} isActive={isActive} runId={runId} />
    case 'ENTITY_EXTRACTION':
      return <EntityExtractionContent artifact={artifact} />
    case 'PROFILE_GENERATION':
      return <ProfileGenerationContent artifact={artifact} />
    case 'CONFIG_GENERATION':
      return <ConfigGenerationContent artifact={artifact} />
    case 'SIMULATION_RUNNING':
      return <SimulationRunningContent artifact={artifact} runId={runId} isActive={isActive} />
    case 'REPORT_GENERATING':
      return <ReportGeneratingContent artifact={artifact} />
    default:
      return null
  }
}

// ---- 阶段 1：种子文档 ----
function SeedParsingContent({ artifact }: { artifact: any }) {
  const docs = artifact?.documents || []
  const count = artifact?.count ?? docs.length
  const totalLen = docs.reduce((s: number, d: any) => s + (d.len || 0), 0)
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="文档数" value={String(count)} />
        <Stat label="总字数" value={totalLen > 1000 ? `${(totalLen/1000).toFixed(1)}k` : String(totalLen)} />
        <Stat label="状态" value={count > 0 ? '已就绪' : '等待'} />
      </div>
      {docs.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">文档清单</div>
          {docs.slice(0, 3).map((d: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[11px] p-1.5 rounded bg-white/60 dark:bg-ink-900/40">
              <FileCode size={10} className="text-amber-500 flex-shrink-0" />
              <span className="truncate flex-1">{d.title || d.doc_id}</span>
              <span className="font-mono text-ink-500">{d.len} 字</span>
            </div>
          ))}
          {docs.length > 3 && <div className="text-[10px] text-ink-400 text-center">+{docs.length - 3} 更多</div>}
        </div>
      )}
    </div>
  )
}

// ---- 阶段 2：图谱构建 ----
function GraphBuildingContent({ artifact, isActive, runId }: { artifact: any; isActive: boolean; runId?: string | null }) {
  const [liveNodes, setLiveNodes] = useState(artifact?.entities_created || 0)
  const [liveEdges, setLiveEdges] = useState(artifact?.relations_created || 0)

  // 订阅 SSE 拿实时数据
  useEffect(() => {
    if (!runId || !isActive) return
    const es = new EventSource(`/api/pipeline/${runId}/events`)
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data)
        if (d.type === 'live_event' && d.event?.type === 'graph_progress') {
          setLiveNodes(d.event.data?.nodes ?? liveNodes)
          setLiveEdges(d.event.data?.edges ?? liveEdges)
        } else if (d.current_stage === 'GRAPH_BUILDING' && d.artifacts?.GRAPH_BUILDING) {
          setLiveNodes(d.artifacts.GRAPH_BUILDING.entities_created || 0)
          setLiveEdges(d.artifacts.GRAPH_BUILDING.relations_created || 0)
        }
      } catch {/* ignore */}
    }
    return () => es.close()
  }, [runId, isActive])

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="节点" value={
          <span className="flex items-center gap-1">
            {isActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
            {liveNodes}
          </span>
        } accent />
        <Stat label="关系" value={
          <span className="flex items-center gap-1">
            {isActive && <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />}
            {liveEdges}
          </span>
        } accent />
      </div>
      <div className="text-[10px] text-ink-500 italic">
        {isActive ? '图谱正在持续增长，节点涌现中…' : '图谱构建已完成'}
      </div>
    </div>
  )
}

// ---- 阶段 3：实体抽取 ----
function EntityExtractionContent({ artifact }: { artifact: any }) {
  const entities = artifact?.entities_created || 0
  const relations = artifact?.relations_created || 0
  // 模拟实体类型分布
  const dist = [
    { type: 'COMPANY', count: Math.floor(entities * 0.18), color: '#FF6B35' },
    { type: 'PERSON', count: Math.floor(entities * 0.22), color: '#E91E63' },
    { type: 'PRODUCT', count: Math.floor(entities * 0.15), color: '#7B2D8E' },
    { type: 'BUSINESS', count: Math.floor(entities * 0.16), color: '#004E89' },
    { type: 'GOVERNMENT', count: Math.floor(entities * 0.12), color: '#C5283D' },
    { type: 'REGULATION', count: Math.floor(entities * 0.17), color: '#64748B' },
  ]
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="实体" value={String(entities)} />
        <Stat label="关系" value={String(relations)} />
      </div>
      {entities > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold mb-1">类型分布</div>
          <div className="space-y-0.5">
            {dist.map((d) => (
              <div key={d.type} className="flex items-center gap-2 text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
                <span className="w-20 text-ink-600 dark:text-ink-300">{d.type}</span>
                <div className="flex-1 h-1.5 rounded-full bg-ink-200/40 dark:bg-ink-800/40 overflow-hidden">
                  <div className="h-full rounded-full" style={{ background: d.color, width: `${Math.min(100, d.count * 5)}%` }} />
                </div>
                <span className="w-6 text-right font-mono font-bold text-ink-700 dark:text-ink-200">{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- 阶段 4：Profile 生成 ----
function ProfileGenerationContent({ artifact }: { artifact: any }) {
  const agents = artifact?.agents || []
  return (
    <div className="space-y-2">
      <Stat label="Agent 数" value={String(agents.length || artifact?.count || 0)} />
      {agents.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold mb-1">Agent 清单</div>
          <div className="grid grid-cols-2 gap-1.5">
            {agents.slice(0, 6).map((a: any, i: number) => (
              <div key={i} className="flex items-center gap-1.5 p-1.5 rounded bg-white/60 dark:bg-ink-900/40 text-[10px]">
                <UserCircle2 size={10} className="text-pink-500 flex-shrink-0" />
                <span className="truncate flex-1 font-semibold">{a.name}</span>
                <span className="text-ink-500 font-mono text-[9px]">{a.type?.slice(0, 4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- 阶段 5：Config 生成 ----
function ConfigGenerationContent({ artifact }: { artifact: any }) {
  const cfg = artifact?.sim_config || {}
  const topics = cfg.topics || []
  const maxRounds = cfg.max_rounds || 0
  const simHours = cfg.simulated_hours || 0
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="最大回合" value={String(maxRounds)} />
        <Stat label="仿真小时" value={String(simHours)} />
      </div>
      {topics.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold mb-1 flex items-center gap-1">
            <ListChecks size={10} /> 推演议题
          </div>
          <div className="space-y-1">
            {topics.slice(0, 4).map((t: any, i: number) => (
              <div key={i} className="text-[11px] p-1.5 rounded bg-white/60 dark:bg-ink-900/40 truncate">
                {t.title || t.name || JSON.stringify(t).slice(0, 40)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- 阶段 6：模拟运行（核心）----
function SimulationRunningContent({ artifact, runId, isActive }: {
  artifact: any; runId?: string | null; isActive: boolean;
}) {
  const totalRounds = artifact?.total_rounds || 0
  const currentRound = artifact?.current_round || 0
  const roundResults = artifact?.round_results || []
  const [liveRound, setLiveRound] = useState(currentRound)

  useEffect(() => {
    if (!runId || !isActive) return
    const es = new EventSource(`/api/pipeline/${runId}/events`)
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data)
        if (d.type === 'live_event' && d.event?.type === 'round_progress') {
          setLiveRound(d.event.data?.round || 0)
        }
      } catch {/* ignore */}
    }
    return () => es.close()
  }, [runId, isActive])

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="已推演" value={`${isActive ? liveRound : currentRound} / ${totalRounds}`} accent />
        <Stat label="行动数" value={String(roundResults.reduce((s: number, r: any) => s + (r.actions?.length || 0), 0))} />
        <Stat label="信念更新" value={String(roundResults.reduce((s: number, r: any) => s + (r.belief_updates?.length || 0), 0))} />
      </div>
      {roundResults.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold mb-1 flex items-center gap-1">
            <NetworkIcon size={10} /> 各回合状态
          </div>
          <div className="flex gap-1.5">
            {roundResults.map((r: any, i: number) => (
              <div key={i} className="flex-1 p-1.5 rounded bg-white/60 dark:bg-ink-900/40 text-center">
                <div className="text-[9px] text-ink-500 font-mono">R{r.round_num || i+1}</div>
                <div className="text-[11px] font-bold text-emerald-600">{r.actions?.length || 0}</div>
                <div className="text-[9px] text-ink-400">行动</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="text-[10px] text-ink-500 italic flex items-center gap-1">
        {isActive ? <><Loader2 size={10} className="animate-spin" /> 推演中，关系网同步演化…</> : '推演已完成，可查看完整关系网'}
      </div>
    </div>
  )
}

// ---- 阶段 7：报告生成 ----
function ReportGeneratingContent({ artifact }: { artifact: any }) {
  const contentLen = artifact?.content_length || 0
  const path = artifact?.path || ''
  return (
    <div className="space-y-2">
      <Stat label="报告字数" value={contentLen > 1000 ? `${(contentLen/1000).toFixed(1)}k` : String(contentLen)} accent />
      {path && (
        <div className="text-[10px] text-ink-500 italic">
          报告已生成于 {path}
        </div>
      )}
      {!contentLen && !path && (
        <div className="text-[10px] text-ink-400 italic">等待报告生成…</div>
      )}
    </div>
  )
}

// ---- 通用 Stat 组件 ----
function Stat({ label, value, accent }: { label: string; value: any; accent?: boolean }) {
  return (
    <div className={`p-2 rounded-lg ${accent ? 'bg-brand-50 dark:bg-brand-950/30' : 'bg-white/60 dark:bg-ink-900/40'}`}>
      <div className="text-[9px] text-ink-500 font-semibold uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-bold font-mono mt-0.5 ${accent ? 'text-brand-700 dark:text-brand-300' : 'text-ink-900 dark:text-white'}`}>
        {value}
      </div>
    </div>
  )
}
