/**
 * ShockBanner - 外部冲击红色高亮横幅 (should-tier v3)
 *
 * 数据源: store.activeShock (后端 SSE shock_injected emit 时同步设置, 3s 后自动清除)
 * 显示: 被冲击部门 + magnitude 条 + msg_cn 描述
 *
 * 与 must-tier v2 ShockToast 区别: ShockToast 是长期队列提示 (toast 列表),
 * ShockBanner 是单条红色高亮横幅 (顶部闪现 3s, 强调"现在正在发生冲击").
 */
import { motion, AnimatePresence } from 'framer-motion'
import { Zap, X, AlertTriangle } from 'lucide-react'
import { useActiveShock, usePipelineStore } from '../store/pipeline'
import { WORKBENCH } from '../i18n/zh'

export default function ShockBanner() {
  const shock = useActiveShock() as any
  const clearActiveShock = usePipelineStore((s) => s.clearActiveShock)

  return (
    <AnimatePresence>
      {shock && (
        <motion.div
          data-testid="shock-banner"
          key={`shock-${shock.ts}`}
          initial={{ opacity: 0, y: -16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.25 }}
          className="mx-4 md:mx-10 mt-2 relative overflow-hidden rounded-xl
                     bg-gradient-to-r from-rose-500 via-red-500 to-rose-600
                     text-white shadow-lg"
          role="alert"
        >
          {/* 背景闪烁效果 */}
          <motion.div
            className="absolute inset-0 bg-white/20"
            animate={{ opacity: [0, 0.18, 0] }}
            transition={{ duration: 1.2, repeat: 1 }}
          />

          <div className="relative flex items-center gap-3 px-4 py-3">
            <div className="w-9 h-9 rounded-lg bg-white/20 inline-flex items-center justify-center shrink-0">
              <Zap size={16} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wider font-bold text-white/80 flex items-center gap-1">
                <AlertTriangle size={9} />
                {WORKBENCH.shockBannerTitle}
                {shock.round != null && (
                  <span className="ml-1 px-1.5 py-0.5 rounded bg-white/20 text-[9px] font-mono">
                    R{shock.round}
                  </span>
                )}
              </div>
              <div className="text-sm font-semibold truncate">
                {shock.factor_name || '外部冲击'}
                {shock.msg_cn && (
                  <span className="text-white/85 font-normal ml-2">{shock.msg_cn}</span>
                )}
              </div>
              {/* magnitude 进度条 */}
              {typeof shock.severity === 'number' && (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-white/25 rounded-full overflow-hidden max-w-[200px]">
                    <motion.div
                      data-testid="shock-severity-bar"
                      className="h-full bg-white"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, shock.severity * 100)}%` }}
                      transition={{ duration: 0.4 }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-white/85 font-bold tabular-nums">
                    {WORKBENCH.shockBannerSeverity(shock.severity)}
                  </span>
                </div>
              )}
            </div>
            <button
              onClick={clearActiveShock}
              data-testid="shock-banner-close"
              className="w-7 h-7 inline-flex items-center justify-center rounded text-white/80 hover:text-white hover:bg-white/20 transition-colors shrink-0"
              aria-label="关闭冲击横幅"
            >
              <X size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
