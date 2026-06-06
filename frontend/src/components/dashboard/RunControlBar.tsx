/**
 * RunControlBar - 启动按钮 + 运行中控制条（暂停/继续/取消/重置/查看报告/实时视图）。
 *
 * 来源：原 views/Dashboard.tsx 行 433-489 区块，P2-8 拆出。
 */
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  Play, ChevronDown, Loader2, FileText, Sparkles,
} from 'lucide-react'
import PipelineDashboard from '../PipelineDashboard'
import { DASHBOARD, APP_ROUTES } from '../../i18n/zh'
import type { PipelineStatus } from '../../store/pipeline'

interface Props {
  uploadsCount: number
  runId: string | null
  status: string | undefined
  currentStage: string | undefined
  progress: number
  isStarting: boolean
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onCancel: () => void
  onReset: () => void
}

export default function RunControlBar({
  uploadsCount, runId, status, currentStage, progress, isStarting,
  onStart, onPause, onResume, onCancel, onReset,
}: Props) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {uploadsCount === 0 && !runId ? (
        <div className="text-sm text-ink-400 flex items-center gap-1.5">
          <ChevronDown size={12} className="-rotate-90" />
          {DASHBOARD.needDoc}
        </div>
      ) : !runId ? (
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.98 }}
          className="btn-primary h-11 px-6 text-sm"
          onClick={onStart}
          disabled={isStarting}
        >
          {isStarting
            ? <Loader2 size={16} className="animate-spin" />
            : <Play size={16} />}
          {isStarting ? '正在构建推演任务…' : '启动推演'}
        </motion.button>
      ) : (
        <div className="w-full">
          <PipelineDashboard
            runId={runId}
            currentStage={currentStage}
            progress={progress}
            status={status as PipelineStatus | undefined}
          />
          <div className="flex flex-wrap gap-2 mt-3">
            {status === 'running' && (
              <button className="btn-ghost" onClick={onPause}>{DASHBOARD.pause}</button>
            )}
            {status === 'paused' && (
              <button className="btn-primary" onClick={onResume}>{DASHBOARD.resume}</button>
            )}
            {(status === 'running' || status === 'paused') && (
              <button className="btn-danger" onClick={onCancel}>{DASHBOARD.cancel}</button>
            )}
            {status === 'completed' && (
              <Link to={APP_ROUTES.report(runId)} className="btn-primary">
                <FileText size={16} /> {DASHBOARD.viewReport}
              </Link>
            )}
            <button className="btn-ghost" onClick={onReset}>{DASHBOARD.newRun}</button>
            {status === 'running' && (
              <Link to={APP_ROUTES.simulation(runId)} className="btn-ghost">
                <Sparkles size={14} /> {DASHBOARD.liveView}
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
