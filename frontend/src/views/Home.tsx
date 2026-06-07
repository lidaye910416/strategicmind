/**
 * Home - 首页 (brand landing) at /welcome.
 *
 * 设计:
 *   - 顶部 hero: brand 标题 + 一行简介 + 2 个 CTA (去工作台 / 查看历史)
 *   - 3 个 feature card (知识图谱 / 多回合推演 / 结构化报告)
 *   - 最近一次推演预览 (LatestRunGraph), 兜底"尚无完成的任务"占位
 *
 * 复用:
 *   - LatestRunGraph (components/dashboard/) — 复用上一步的成果
 *   - 不在 Home 上显示 RecentRuns / UploadCard — 职责单一, 引导到 / 或 /history
 */
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Rocket, Network, GitBranch, FileText, ArrowUpRight,
} from 'lucide-react'
import { APP_ROUTES, HOME } from '../i18n/zh'
import LatestRunGraph from '../components/dashboard/LatestRunGraph'
import { fadeUp, stagger } from '../lib/motion'

const FEATURES = [
  { icon: Network, titleKey: 'feature1Title' as const, descKey: 'feature1Desc' as const },
  { icon: GitBranch, titleKey: 'feature2Title' as const, descKey: 'feature2Desc' as const },
  { icon: FileText, titleKey: 'feature3Title' as const, descKey: 'feature3Desc' as const },
]

export default function Home() {
  return (
    <div className="min-h-screen" data-home>
      {/* Hero */}
      <section className="px-6 md:px-10 pt-16 md:pt-24 pb-12 max-w-5xl mx-auto">
        <motion.div
          initial="initial" animate="animate" variants={stagger(0.08)}
          className="flex flex-col gap-5"
        >
          {/* badge */}
          <motion.div variants={fadeUp} className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                             bg-brand-100 dark:bg-brand-900/40
                             text-brand-700 dark:text-brand-300
                             text-[11px] font-semibold tracking-wider">
              <Rocket size={11} />
              {HOME.badge}
            </span>
          </motion.div>

          {/* title */}
          <motion.h1
            variants={fadeUp}
            className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.1] text-ink-900 dark:text-white"
          >
            {HOME.title1}
            <br />
            <span className="bg-gradient-to-r from-brand-600 to-brand-400 bg-clip-text text-transparent">
              {HOME.title2}
            </span>
          </motion.h1>

          {/* subtitle */}
          <motion.p
            variants={fadeUp}
            className="text-base text-ink-600 dark:text-ink-300 max-w-2xl leading-relaxed"
          >
            {HOME.subtitle}
          </motion.p>

          {/* CTAs */}
          <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              to={APP_ROUTES.home}
              title={HOME.ctaStartTitle}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl
                         bg-ink-900 dark:bg-white text-white dark:text-ink-900
                         hover:bg-brand-600 dark:hover:bg-brand-400
                         hover:text-white dark:hover:text-ink-900
                         text-sm font-semibold transition-colors"
            >
              <Rocket size={15} />
              {HOME.ctaStart}
            </Link>
            <Link
              to={APP_ROUTES.history}
              title={HOME.ctaHistoryTitle}
              className="inline-flex items-center gap-1.5 h-11 px-4 rounded-xl
                         text-ink-700 dark:text-ink-200 hover:text-brand-600 dark:hover:text-brand-300
                         text-sm font-medium transition-colors"
            >
              {HOME.ctaHistory}
              <ArrowUpRight size={14} />
            </Link>
          </motion.div>
        </motion.div>
      </section>

      {/* Feature cards */}
      <section className="px-6 md:px-10 pb-10 max-w-5xl mx-auto">
        <motion.div
          initial="initial" animate="animate" variants={stagger(0.06)}
          className="grid grid-cols-1 md:grid-cols-3 gap-4"
        >
          {FEATURES.map((f) => (
            <motion.div
              key={f.titleKey}
              variants={fadeUp}
              className="card p-5 hover:border-brand-300/70 dark:hover:border-brand-700/60
                         transition-colors"
            >
              <div className="flex items-center justify-center w-10 h-10 rounded-xl
                              bg-brand-100 dark:bg-brand-900/40
                              text-brand-600 dark:text-brand-300 mb-3">
                <f.icon size={18} />
              </div>
              <h3 className="text-[15px] font-semibold text-ink-900 dark:text-white mb-1.5">
                {HOME[f.titleKey]}
              </h3>
              <p className="text-xs text-ink-500 dark:text-ink-400 leading-relaxed">
                {HOME[f.descKey]}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Latest run preview */}
      <section className="px-6 md:px-10 pb-20 max-w-5xl mx-auto">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-[13px] font-bold uppercase tracking-wider text-ink-800 dark:text-ink-100">
            {HOME.latestTitle}
          </h2>
          <div className="flex-1 h-px bg-ink-200/40 dark:bg-ink-800/40" />
        </div>
        <LatestRunGraph />
      </section>
    </div>
  )
}
