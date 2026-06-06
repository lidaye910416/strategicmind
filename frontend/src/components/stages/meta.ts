/**
 * stages/meta - 阶段元数据（icon / 颜色 / 标签）。
 *
 * 来源：原 components/StageCards.tsx 的 STAGE_META + STAGE_ORDER，
 *       P2-4 拆出（避免主 StageCards 文件膨胀）。
 */
import {
  BookOpen, GitBranch, Database, Users, Settings2, Activity, FileText,
} from 'lucide-react'

export interface StageMeta {
  icon: any
  color: string
  bg: string
  label: string
  desc: string
}

export const STAGE_META: Record<string, StageMeta> = {
  SEED_PARSING: { icon: BookOpen, color: 'text-amber-700 dark:text-amber-300', bg: 'from-amber-500/20 to-orange-500/20', label: '种子文档解析', desc: '读取上传的种子文档、切分语义块' },
  GRAPH_BUILDING: { icon: GitBranch, color: 'text-violet-700 dark:text-violet-300', bg: 'from-violet-500/20 to-pink-500/20', label: '构建知识图谱', desc: '从文档中抽取实体与关系，构建图谱' },
  ENTITY_EXTRACTION: { icon: Database, color: 'text-cyan-700 dark:text-cyan-300', bg: 'from-cyan-500/20 to-blue-500/20', label: '抽取实体关系', desc: '实体类型分布 + 关系类型' },
  PROFILE_GENERATION: { icon: Users, color: 'text-pink-700 dark:text-pink-300', bg: 'from-pink-500/20 to-rose-500/20', label: '生成 Agent 画像', desc: '为利益相关方生成可推演的 Agent' },
  CONFIG_GENERATION: { icon: Settings2, color: 'text-indigo-700 dark:text-indigo-300', bg: 'from-indigo-500/20 to-purple-500/20', label: '生成仿真配置', desc: '把画像组装成仿真可执行的配置' },
  SIMULATION_RUNNING: { icon: Activity, color: 'text-emerald-700 dark:text-emerald-300', bg: 'from-emerald-500/20 to-teal-500/20', label: '执行多 Agent 推演', desc: '多轮博弈，BeliefEngine 演化与行动' },
  REPORT_GENERATING: { icon: FileText, color: 'text-rose-700 dark:text-rose-300', bg: 'from-rose-500/20 to-pink-500/20', label: '生成战略报告', desc: '产出可读的战略推演报告' },
}

export const STAGE_ORDER = [
  'SEED_PARSING', 'GRAPH_BUILDING', 'ENTITY_EXTRACTION',
  'PROFILE_GENERATION', 'CONFIG_GENERATION', 'SIMULATION_RUNNING',
  'REPORT_GENERATING',
] as const

export type StageName = typeof STAGE_ORDER[number]
