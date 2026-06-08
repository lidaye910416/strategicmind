/**
 * MarketEnvPulse - 市场环境脉搏仪表盘 (should-tier v3)
 *
 * 数据源: store.latestMarketEvent (后端 SSE market_event emit 时同步设置)
 * 字段: sector_growth_rate, policy_pressure, capital_availability, consumer_sentiment,
 *       cycle_label_cn, policy_stance_cn, industry
 *
 * 渲染: 4 项核心指标 (policy_pressure 进度条 / cycle_label_cn 大色块 /
 *       capital_availability / consumer_sentiment 数字) + 行业标签
 *
 * 空态: latestMarketEvent === null → 等待 Q1 市场快照
 */
import { motion } from 'framer-motion'
import { Activity, TrendingUp, DollarSign, BarChart3, Calendar } from 'lucide-react'
import { useLatestMarketEvent } from '../store/pipeline'
import { WORKBENCH } from '../i18n/zh'

export default function MarketEnvPulse() {
  const evt = useLatestMarketEvent() as any

  if (!evt) {
    return (
      <div
        data-testid="market-env-pulse-empty"
        className="card p-4 flex items-center gap-2 text-[11px] text-ink-500 dark:text-ink-400"
      >
        <div className="w-9 h-9 rounded-lg bg-ink-100 dark:bg-ink-800/60 inline-flex items-center justify-center text-ink-400">
          <Activity size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider font-bold text-ink-500">
            {WORKBENCH.marketEnvTitle}
          </div>
          <div className="text-[11px] mt-0.5">{WORKBENCH.marketEnvEmpty}</div>
        </div>
      </div>
    )
  }

  const policy_pressure = typeof evt.policy_pressure === 'number' ? evt.policy_pressure : null
  const capital = typeof evt.capital_availability === 'number' ? evt.capital_availability : null
  const sentiment = typeof evt.consumer_sentiment === 'number' ? evt.consumer_sentiment : null
  const cycle = evt.cycle_label_cn || evt.cycle_label || '—'
  const stance = evt.policy_stance_cn || evt.policy_stance || ''
  const industry = evt.industry || '—'

  // policy_pressure → 进度条颜色 (低=绿, 中=橙, 高=红)
  const pressureColor = policy_pressure == null
    ? 'bg-ink-300'
    : policy_pressure > 0.66
      ? 'bg-rose-500'
      : policy_pressure > 0.33
        ? 'bg-amber-500'
        : 'bg-emerald-500'

  const capColor = capital == null
    ? 'text-ink-500'
    : capital > 0.6
      ? 'text-emerald-600 dark:text-emerald-400'
      : capital > 0.3
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-rose-600 dark:text-rose-400'

  const sentColor = sentiment == null
    ? 'text-ink-500'
    : sentiment > 0.6
      ? 'text-emerald-600 dark:text-emerald-400'
      : sentiment > 0.3
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-rose-600 dark:text-rose-400'

  return (
    <motion.div
      data-testid="market-env-pulse"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-4"
    >
      {/* 顶部: 标题 + 行业 + 周期色块 */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20 inline-flex items-center justify-center text-blue-600">
          <Activity size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider font-bold text-ink-500">
            {WORKBENCH.marketEnvTitle}
          </div>
          <div className="text-sm font-semibold text-ink-900 dark:text-white tabular-nums">
            {WORKBENCH.marketEnvIndustry}：<span className="font-mono text-[12px]">{industry}</span>
          </div>
        </div>
        <div
          data-testid="market-env-cycle"
          className="px-3 py-1.5 rounded-lg bg-gradient-to-br from-brand-500 to-accent-500 text-white font-bold text-sm shadow-soft"
        >
          {cycle}
        </div>
      </div>

      {/* 4 项核心指标 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {/* 1) 政策压力 (进度条) */}
        <div className="p-2.5 rounded-lg border border-ink-200/50 dark:border-ink-800/50 bg-ink-50/40 dark:bg-ink-900/30">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-ink-500 mb-1">
            <BarChart3 size={9} /> {WORKBENCH.marketEnvPolicyPressure}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-ink-200/60 dark:bg-ink-800/60 rounded-full overflow-hidden">
              <div
                data-testid="policy-pressure-bar"
                className={`h-full ${pressureColor} transition-all duration-500`}
                style={{ width: `${(policy_pressure ?? 0) * 100}%` }}
              />
            </div>
            <span className="text-[11px] font-mono font-bold text-ink-700 dark:text-ink-200 tabular-nums w-9 text-right">
              {policy_pressure == null ? '—' : policy_pressure.toFixed(2)}
            </span>
          </div>
          {stance && (
            <div className="text-[10px] text-ink-500 dark:text-ink-400 mt-1 truncate">{stance}</div>
          )}
        </div>

        {/* 2) 资金可得性 */}
        <div className="p-2.5 rounded-lg border border-ink-200/50 dark:border-ink-800/50 bg-ink-50/40 dark:bg-ink-900/30">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-ink-500 mb-1">
            <DollarSign size={9} /> {WORKBENCH.marketEnvCapital}
          </div>
          <div className={`text-base font-bold tabular-nums ${capColor}`}>
            {capital == null ? '—' : capital.toFixed(2)}
          </div>
          <div className="text-[10px] text-ink-500 dark:text-ink-400 mt-0.5">
            {capital != null && (capital > 0.6 ? '宽松' : capital > 0.3 ? '中性' : '紧缩')}
          </div>
        </div>

        {/* 3) 消费情绪 */}
        <div className="p-2.5 rounded-lg border border-ink-200/50 dark:border-ink-800/50 bg-ink-50/40 dark:bg-ink-900/30">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-ink-500 mb-1">
            <TrendingUp size={9} /> {WORKBENCH.marketEnvSentiment}
          </div>
          <div className={`text-base font-bold tabular-nums ${sentColor}`}>
            {sentiment == null ? '—' : sentiment.toFixed(2)}
          </div>
          <div className="text-[10px] text-ink-500 dark:text-ink-400 mt-0.5">
            {sentiment != null && (sentiment > 0.6 ? '乐观' : sentiment > 0.3 ? '中性' : '悲观')}
          </div>
        </div>

        {/* 4) 行业增速 */}
        <div className="p-2.5 rounded-lg border border-ink-200/50 dark:border-ink-800/50 bg-ink-50/40 dark:bg-ink-900/30">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-ink-500 mb-1">
            <Calendar size={9} /> 行业增速
          </div>
          <div className={`text-base font-bold tabular-nums ${
            typeof evt.sector_growth_rate === 'number'
              ? evt.sector_growth_rate > 0 ? 'text-emerald-600' : 'text-rose-600'
              : 'text-ink-500'
          }`}>
            {typeof evt.sector_growth_rate === 'number'
              ? `${(evt.sector_growth_rate * 100).toFixed(1)}%`
              : '—'}
          </div>
          <div className="text-[10px] text-ink-500 dark:text-ink-400 mt-0.5">
            Q{evt.quarter ?? '?'} · FY{evt.fiscal_year_offset ?? '?'}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
