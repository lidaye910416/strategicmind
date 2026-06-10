/**
 * roundTimelineMeta - 18 种动作类型配置 + 平台分类 + 通道文案
 *
 * 从 RoundTimeline.tsx 抽出（避免单文件超 500 行）。
 */

import {
  Megaphone, Newspaper, FileText, Lock, Share2, EyeOff, MessageSquare, Users,
  BarChart3, Archive, Vote, Brain, Search, UserPlus, UserMinus, Eye as EyeIcon, Zap,
} from 'lucide-react'

export interface ActionMetaShape {
  icon: any
  label: string
  color: string
  bg: string
  border: string
  variant: 'text' | 'numeric' | 'binary' | 'idle'
}

// 18 种动作类型完整配置（工作台风格）
export const ACTION_META: Record<string, ActionMetaShape> = {
  MAKE_STATEMENT:    { icon: Megaphone,  label: '公开发声',   color: 'text-brand-700 dark:text-brand-300',     bg: 'bg-brand-50 dark:bg-brand-950/40',       border: 'border-brand-200/60 dark:border-brand-800/60',   variant: 'text' },
  PUBLISH_REPORT:    { icon: Newspaper,  label: '发布报告',   color: 'text-cyan-700 dark:text-cyan-300',       bg: 'bg-cyan-50 dark:bg-cyan-950/40',         border: 'border-cyan-200/60 dark:border-cyan-800/60',     variant: 'text' },
  FILE_DOCUMENT:     { icon: FileText,   label: '提交文件',   color: 'text-sky-700 dark:text-sky-300',         bg: 'bg-sky-50 dark:bg-sky-950/40',           border: 'border-sky-200/60 dark:border-sky-800/60',       variant: 'text' },
  PRIVATE_MEETING:   { icon: Lock,       label: '私下会商',   color: 'text-purple-700 dark:text-purple-300',   bg: 'bg-purple-50 dark:bg-purple-950/40',     border: 'border-purple-200/60 dark:border-purple-800/60', variant: 'text' },
  LEAK_INFORMATION:  { icon: Share2,     label: '泄漏信息',   color: 'text-rose-700 dark:text-rose-300',       bg: 'bg-rose-50 dark:bg-rose-950/40',         border: 'border-rose-200/60 dark:border-rose-800/60',     variant: 'text' },
  CONCEALED_TRADE:   { icon: EyeOff,     label: '暗盘交易',   color: 'text-ink-700 dark:text-ink-300',         bg: 'bg-ink-50 dark:bg-ink-950/40',           border: 'border-ink-200/60 dark:border-ink-800/60',       variant: 'numeric' },
  PROPOSE_DEAL:      { icon: MessageSquare, label: '提出交易', color: 'text-amber-700 dark:text-amber-300',     bg: 'bg-amber-50 dark:bg-amber-950/40',       border: 'border-amber-200/60 dark:border-amber-800/60',   variant: 'text' },
  COORDINATE_POSITION:{ icon: Users,      label: '协调立场',   color: 'text-indigo-700 dark:text-indigo-300',   bg: 'bg-indigo-50 dark:bg-indigo-950/40',     border: 'border-indigo-200/60 dark:border-indigo-800/60', variant: 'text' },
  NEGOTIATE:         { icon: MessageSquare, label: '谈判协商', color: 'text-violet-700 dark:text-violet-300',   bg: 'bg-violet-50 dark:bg-violet-950/40',     border: 'border-violet-200/60 dark:border-violet-800/60', variant: 'text' },
  TRADE_ASSET:       { icon: Archive,    label: '资产转移',   color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-950/40',   border: 'border-emerald-200/60 dark:border-emerald-800/60', variant: 'numeric' },
  ACCUMULATE_POSITION:{ icon: BarChart3, label: '建仓动作',   color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-950/40',   border: 'border-emerald-200/60 dark:border-emerald-800/60', variant: 'numeric' },
  RATING_ACTION:     { icon: Vote,       label: '评级动作',   color: 'text-fuchsia-700 dark:text-fuchsia-300', bg: 'bg-fuchsia-50 dark:bg-fuchsia-950/40',   border: 'border-fuchsia-200/60 dark:border-fuchsia-800/60', variant: 'binary' },
  SHARE_INTEL:       { icon: Brain,      label: '情报分享',   color: 'text-pink-700 dark:text-pink-300',       bg: 'bg-pink-50 dark:bg-pink-950/40',         border: 'border-pink-200/60 dark:border-pink-800/60',     variant: 'text' },
  SPREAD_NARRATIVE:  { icon: Megaphone,  label: '传播叙事',   color: 'text-orange-700 dark:text-orange-300',   bg: 'bg-orange-50 dark:bg-orange-950/40',     border: 'border-orange-200/60 dark:border-orange-800/60', variant: 'text' },
  GATHER_INTEL:      { icon: Search,     label: '情报搜集',   color: 'text-teal-700 dark:text-teal-300',       bg: 'bg-teal-50 dark:bg-teal-950/40',         border: 'border-teal-200/60 dark:border-teal-800/60',     variant: 'text' },
  FORM_COALITION:    { icon: UserPlus,   label: '组建联盟',   color: 'text-lime-700 dark:text-lime-300',       bg: 'bg-lime-50 dark:bg-lime-950/40',         border: 'border-lime-200/60 dark:border-lime-800/60',     variant: 'text' },
  JOIN_COALITION:    { icon: UserPlus,   label: '加入联盟',   color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-950/40',   border: 'border-emerald-200/60 dark:border-emerald-800/60', variant: 'text' },
  LEAVE_COALITION:   { icon: UserMinus,  label: '退出联盟',   color: 'text-rose-700 dark:text-rose-300',       bg: 'bg-rose-50 dark:bg-rose-950/40',         border: 'border-rose-200/60 dark:border-rose-800/60',     variant: 'text' },
  IDLE:              { icon: EyeIcon,    label: '保持沉默',   color: 'text-ink-500',                            bg: 'bg-ink-50/50 dark:bg-ink-900/30',        border: 'border-ink-200/40 dark:border-ink-800/40',       variant: 'idle' },
}

export function actionMeta(t: string): ActionMetaShape {
  return ACTION_META[t] || {
    icon: Zap, label: t || '未知动作',
    color: 'text-ink-700 dark:text-ink-200',
    bg: 'bg-ink-50 dark:bg-ink-900/40',
    border: 'border-ink-200/60 dark:border-ink-800/60',
    variant: 'text',
  }
}

export const CHANNEL_LABELS: Record<string, { label: string; color: string }> = {
  DIRECT: { label: '直连', color: 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300' },
  BROADCAST: { label: '广播', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' },
  GRAPH: { label: '图谱', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300' },
  MEDIA: { label: '媒体', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300' },
  SOCIAL_MEDIA: { label: '社交', color: 'bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300' },
  MARKET_SIGNAL: { label: '市场', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' },
  RUMOR: { label: '传闻', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300' },
  OFFICIAL: { label: '官方', color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300' },
}

export function classifyPlatform(action: { action_type: string }): 'external' | 'internal' {
  // 内部动作（部门内部、协同）
  if (['PRIVATE_MEETING', 'COORDINATE_POSITION', 'JOIN_COALITION', 'LEAVE_COALITION'].includes(action.action_type)) {
    return 'internal'
  }
  return 'external'
}
