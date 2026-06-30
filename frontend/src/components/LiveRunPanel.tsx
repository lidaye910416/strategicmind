/**
 * LiveRunPanel - DEPRECATION SHIM (1 release).
 *
 * Bug #3 修复: LiveRunPanel 已拆分为 LiveRunPanel/{Graph,Network,Stages} 子组件。
 * 这个文件保留 1 release 作过渡 — 默认导出 + 命名导出都映射到新的目录模块,
 * 并在第一次调用时 console.warn 提示迁移。
 *
 * 旧 props 行为:
 *   - compact=true  → 仅 Graph + Network + 完整工作台 link
 *   - compact=false → Graph + Network + (show 含 stages 时) Stages
 */
import { Network, Radio, Maximize2, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { usePipelineStore } from '../store/pipeline'
import { APP_ROUTES } from '../i18n/zh'
import Graph from './LiveRunPanel/Graph'
import NetworkPanel from './LiveRunPanel/Network'
import Stages from './LiveRunPanel/Stages'

interface Props {
  runId?: string | null
  compact?: boolean
  title?: string
  subtitle?: string
  show?: Array<'graph' | 'network' | 'platforms' | 'stages' | 'timeline' | 'logs'>
}

const DEFAULT_SHOW: NonNullable<Props['show']> = [
  'graph', 'network', 'platforms', 'stages', 'timeline', 'logs',
]

let warnedOnce = false
function warnOnce() {
  if (warnedOnce) return
  warnedOnce = true
  // eslint-disable-next-line no-console
  console.warn(
    '[LiveRunPanel] default-import + compact flag are deprecated. ' +
      "Import sub-components directly: `import { Graph, Network, Stages } from '@/components/LiveRunPanel'`.",
  )
}

/** 旧 default export — 保留 1 release */
export default function LiveRunPanel(props: Props) {
  warnOnce()
  const {
    runId: runIdProp,
    compact = false,
    title = '实时推演面板',
    subtitle,
    show = DEFAULT_SHOW,
  } = props
  const runId = runIdProp || usePipelineStore.getState().runId

  if (!runId) {
    return (
      <div className="card p-8 text-center bg-gradient-to-br from-brand-50/40 to-accent-50/20
                      dark:from-brand-950/20 dark:to-accent-950/10
                      border-2 border-dashed border-brand-200/60 dark:border-brand-800/40">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500/20 to-accent-500/20
                        inline-flex items-center justify-center text-brand-500 mb-3">
          <Network size={22} />
        </div>
        <div className="text-sm font-semibold text-ink-900 dark:text-white mb-1">
          {title}
        </div>
        <div className="text-xs text-ink-500 dark:text-ink-400">
          {subtitle || '尚未启动推演。配置好参数并点击"启动推演"后，可视化将在这里出现。'}
        </div>
      </div>
    )
  }

  if (compact) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500/20 to-pink-500/20 inline-flex items-center justify-center text-violet-600">
              <Radio size={15} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                {title}
              </div>
              <div className="text-xs text-ink-700 dark:text-ink-300 truncate">
                {subtitle || '推演运行中'}
              </div>
            </div>
          </div>
          <Link
            to={APP_ROUTES.workbenchWithRun(runId)}
            className="btn-ghost h-8 text-[11px] flex items-center gap-1 flex-shrink-0"
          >
            <Maximize2 size={11} /> 完整工作台
            <ChevronRight size={11} />
          </Link>
        </div>
        <Graph />
        <NetworkPanel />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Graph />
      <NetworkPanel />
      {show?.includes('stages') && <Stages />}
    </div>
  )
}

/**
 * Named re-exports for the new sub-component API.
 *
 * 旧 LiveRunPanel.tsx 路径仍存在 (1 release deprecation shim), 但调用方现在 import:
 *   import { Graph, Network, Stages } from '../LiveRunPanel'  ← 新 API, 不打 warning
 * 这里 re-export 让 shim 路径与新目录路径 (`./LiveRunPanel/index`) 行为一致。
 * 子组件是 default export, 用 `default as X` 重命名后 named re-export。
 */
export { default as Graph } from './LiveRunPanel/Graph'
export { default as Network } from './LiveRunPanel/Network'
export { default as Stages } from './LiveRunPanel/Stages'
