/**
 * HeroSection - Dashboard 顶部 Hero 区（标题 + 模型 badge + 右侧操作）。
 *
 * 来源：原 views/Dashboard.tsx 行 147-197 区块，P2-8 拆出。
 */
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  Cpu, Server, Cloud, FlaskConical, ChevronDown, Network,
  FileText, ArrowUpRight, Sparkles,
} from 'lucide-react'
import Hero from '../layout/Hero'
import { COMMON, DASHBOARD, PROVIDER } from '../../i18n/zh'

export interface CurrentProvider {
  provider: string
  model: string
  base_url: string
  is_local: boolean
  requires_api_key: boolean
}

const ICON_FOR_PROVIDER: Record<string, any> = {
  ollama: Server,
  minimax: Sparkles,
  bailian: Cloud,
  mock: FlaskConical,
}

interface Props {
  currentProvider: CurrentProvider | null
  onShowPicker: () => void
  canViewReport: boolean
  viewReportHref: string
}

export default function HeroSection({
  currentProvider, onShowPicker, canViewReport, viewReportHref,
}: Props) {
  return (
    <Hero
      eyebrow="StrategicMind · 多 Agent 博弈推演"
      title={COMMON.appName}
      subtitle={DASHBOARD.headerSubtitle}
      rightSlot={
        <div className="flex items-center gap-2 flex-wrap">
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.98 }}
            onClick={onShowPicker}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-xl
                       bg-white/80 dark:bg-ink-900/60
                       border border-ink-200/60 dark:border-ink-800/60
                       hover:border-brand-300 dark:hover:border-brand-600
                       shadow-soft transition-colors"
            title={PROVIDER.badge}
          >
            {currentProvider && ICON_FOR_PROVIDER[currentProvider.provider]
              ? (() => {
                  const Icon = ICON_FOR_PROVIDER[currentProvider.provider]
                  return (
                    <span className="w-5 h-5 rounded-md bg-gradient-to-br from-brand-500/20 to-accent-500/20
                                     inline-flex items-center justify-center text-brand-600 dark:text-brand-400">
                      <Icon size={11} />
                    </span>
                  )
                })()
              : <Cpu size={14} className="text-ink-400" />}
            <div className="text-left leading-tight">
              <div className="text-[10px] uppercase tracking-wider text-ink-500 dark:text-ink-400 font-semibold">
                {PROVIDER.current}
              </div>
              <div className="text-xs font-semibold text-ink-900 dark:text-white font-mono">
                {currentProvider?.model || '...'}
              </div>
            </div>
            <ChevronDown size={12} className="text-ink-400" />
          </motion.button>
          <Link to="/workbench" className="btn-ghost h-9">
            <Network size={14} /> 推演工作台
          </Link>
          <Link
            to={canViewReport ? viewReportHref : '#'}
            className={`btn-primary h-9 ${!canViewReport ? 'pointer-events-none opacity-50' : ''}`}
          >
            <FileText size={14} /> {DASHBOARD.viewReport} <ArrowUpRight size={12} />
          </Link>
        </div>
      }
    />
  )
}
