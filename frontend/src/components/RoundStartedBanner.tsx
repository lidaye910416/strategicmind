/**
 * RoundStartedBanner - 回合开始顶部闪现横幅 (should-tier v3)
 *
 * 数据源: store.roundStartedBanner (后端 SSE round_started emit 时同步设置, 1s 后自动清空)
 * 显示: 顶部 1 秒闪现 "Round N 开始"
 */
import { motion, AnimatePresence } from 'framer-motion'
import { FastForward } from 'lucide-react'
import { useRoundStartedBanner } from '../store/pipeline'
import { WORKBENCH } from '../i18n/zh'

export default function RoundStartedBanner() {
  const banner = useRoundStartedBanner()
  return (
    <AnimatePresence>
      {banner && (
        <motion.div
          data-testid="round-started-banner"
          key={`round-${banner.ts}`}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          className="fixed top-2 left-1/2 -translate-x-1/2 z-40
                     px-4 py-2 rounded-full
                     bg-gradient-to-r from-brand-500 to-accent-500
                     text-white text-sm font-bold shadow-lg
                     flex items-center gap-2"
        >
          <FastForward size={12} />
          {WORKBENCH.roundStartedBannerHint(banner.round)}
          {banner.total_rounds != null && (
            <span className="text-white/80 text-[10px] font-mono font-normal">
              / {banner.total_rounds}
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
