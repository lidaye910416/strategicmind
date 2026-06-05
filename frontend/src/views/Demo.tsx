/**
 * 案例示范页 - 独立页面，演示如何使用本系统做战略推演。
 *
 * 与工作台完全分离：工作台是「做分析」，本页是「学方法」。
 *
 * Implements: US-100 案例示范
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Sparkles, FileText, Activity } from 'lucide-react'
import DemoCase from '../components/DemoCase'
import Hero from '../components/layout/Hero'
import { DEMO, APP_ROUTES, COMMON } from '../i18n/zh'
import { fadeUp, stagger } from '../lib/motion'

const DEMO_RUN_ID = 'run_a869a890'

export default function Demo() {
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    fetch(`/api/pipeline/${DEMO_RUN_ID}`)
      .then((r) => r.json())
      .then((d) => {
        setProgress(Math.round((d.progress || 0) * 100))
        setStatus(d.status || 'unknown')
      })
      .catch(() => setStatus('error'))
  }, [])

  return (
    <div className="min-h-screen">
      <Hero
        eyebrow="学习 · 案例示范"
        title={DEMO.caseTitle}
        subtitle={DEMO.caseSubtitle}
        rightSlot={
          <div className="flex items-center gap-2 flex-wrap">
            <Link to={APP_ROUTES.home} className="btn-ghost h-9">
              <ArrowLeft size={14} /> {COMMON.backToDashboard}
            </Link>
            <Link to={APP_ROUTES.report(DEMO_RUN_ID)} className="btn-ghost h-9">
              <FileText size={14} /> {DEMO.goToReport}
            </Link>
            <Link to={APP_ROUTES.simulation(DEMO_RUN_ID)} className="btn-primary h-9">
              <Activity size={14} /> {DEMO.goToSimulation}
            </Link>
          </div>
        }
      />

      <motion.div
        variants={stagger(0.08)}
        initial="initial"
        animate="animate"
        className="px-6 md:px-10 pb-16 space-y-5 max-w-5xl"
      >
        {/* 顶部：状态卡片 + 用途说明 */}
        <motion.div variants={fadeUp} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card p-5 md:col-span-2">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-bold
                            text-ink-500 dark:text-ink-400">
              <Sparkles size={12} /> 案例状态
            </div>
            <div className="mt-2 flex items-baseline gap-3">
              <div className="text-2xl font-bold text-ink-900 dark:text-white">
                {status === 'completed' ? '已完成' : status}
              </div>
              <span className="badge-completed">演示数据</span>
            </div>
            <div className="mt-3 text-sm text-ink-500 dark:text-ink-400 leading-relaxed">
              以下展示的是真实跑过的 {DEMO_RUN_ID} 推演结果：上传种子文档后，
              系统按 7 步流水线执行，最终产出可读的战略推演报告。每一栏
              展示的都是从后端 checkpoint 拉取的真实产物。
            </div>
          </div>
          <div className="card p-5 bg-gradient-to-br from-brand-50/60 to-accent-50/30
                          dark:from-brand-950/30 dark:to-accent-950/20">
            <div className="text-[11px] uppercase tracking-wider font-bold
                            text-ink-500 dark:text-ink-400">
              完成度
            </div>
            <div className="mt-2 text-3xl font-bold text-brand-600 dark:text-brand-400 tabular-nums">
              {progress}%
            </div>
            <div className="mt-3 h-1.5 rounded-full overflow-hidden bg-ink-200/60 dark:bg-ink-800/60">
              <motion.div
                className="h-full bg-gradient-to-r from-brand-500 to-accent-500"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
            <div className="text-[11px] text-ink-500 dark:text-ink-400 mt-2">
              7 步流水线全部完成
            </div>
          </div>
        </motion.div>

        {/* 7 步详解 */}
        <motion.div variants={fadeUp}>
          <DemoCase />
        </motion.div>
      </motion.div>
    </div>
  )
}
