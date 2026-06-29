/**
 * DebateTabPanel — Tab 3: 议题推演 (topic resolution + multi-round simulation).
 *
 * Subscribes to:
 *   - uiSlice: runId
 *   - DebateContext (provided by Workbench.tsx): topicInput/setTopicInput/
 *     resolution/resolving/resolveTopic/runCompanySimulation/simResult/etc.
 */
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Zap, Loader2, FileDown, Activity, Lightbulb } from 'lucide-react'
import { WORKBENCH, APP_ROUTES } from '../../../i18n/zh'
import { useRunId } from '../../../store/pipeline'
import { useCompany } from '../CompanyContext'
import { useDebate } from '../DebateContext'

export default function DebateTabPanel() {
  const navigate = useNavigate()
  const runId = useRunId()
  const { companyId } = useCompany()
  const {
    topicInput, setTopicInput,
    resolution, resolving, resolveTopic,
    runCompanySimulation,
    simResult, simulating, simulatingRound, simulatingPct,
    downloadCompanyReport,
  } = useDebate()

  return (
    <div className="space-y-3" data-testid="tab-panel-debate">
      <section id="dept" className="card p-4 scroll-mt-28">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-500/20 to-brand-500/20 inline-flex items-center justify-center text-accent-600">
            <Zap size={14} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
              {WORKBENCH.debateSection}
            </div>
            <div className="text-sm font-semibold text-ink-900 dark:text-white">
              {WORKBENCH.debateTitle}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            placeholder={WORKBENCH.debatePlaceholder}
            className="input flex-1"
            disabled={!companyId}
          />
          <button
            onClick={resolveTopic}
            disabled={!companyId || resolving || !topicInput.trim()}
            className="btn-primary h-9"
          >
            {resolving ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
            {WORKBENCH.debateRun}
          </button>
        </div>

        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <button
              onClick={runCompanySimulation}
              disabled={!companyId || simulating}
              className="btn-ghost h-7 text-[11px] flex-1"
              title={WORKBENCH.runMultiRoundTitle}
            >
              {simulating ? <Loader2 size={11} className="animate-spin" /> : <Activity size={11} />}
              {WORKBENCH.runMultiRound}
            </button>
            <button
              onClick={downloadCompanyReport}
              disabled={!companyId}
              className="btn-ghost h-7 text-[11px] px-2"
              title={WORKBENCH.downloadReportTitle}
            >
              <FileDown size={11} />
            </button>
          </div>
          {simulating && simulatingRound > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] font-mono">
              <span className="text-ink-500">推演中</span>
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4].map((r) => (
                  <span
                    key={r}
                    className={`px-1.5 py-0.5 rounded font-bold transition-colors ${
                      r < simulatingRound
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : r === simulatingRound
                          ? 'bg-brand-500 text-white animate-pulse-soft'
                          : 'bg-ink-100 text-ink-400 dark:bg-ink-800 dark:text-ink-500'
                    }`}
                  >
                    {r}
                  </span>
                ))}
              </div>
              <span className="text-brand-600 dark:text-brand-400 font-bold tabular-nums">
                {simulatingRound}/4
              </span>
              <span className="text-ink-400">·</span>
              <span className="text-ink-500 tabular-nums">{Math.round(simulatingPct)}%</span>
            </div>
          )}
        </div>

        {simResult && simResult.round_results && (
          <div className="mt-3 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
              {WORKBENCH.multiRoundResults}（{simResult.round_results.length} 回合）
            </div>
            {simResult.round_results.map((r: any, i: number) => {
              const res = r.resolution || {}
              return (
                <div key={i} className="p-2 rounded-lg bg-ink-50/70 dark:bg-ink-900/50 border border-ink-200/50">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[11px] font-semibold text-ink-700 dark:text-ink-200 truncate">
                      R{r.round_num || i + 1} · {r.topic || res.topic}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold text-brand-600">
                        {res.company_position?.toFixed(2) || '0.00'}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                        res.outcome === 'ADOPTED' ? 'bg-emerald-100 text-emerald-700' :
                        res.outcome === 'REJECTED' ? 'bg-rose-100 text-rose-700' :
                        res.outcome === 'COMPROMISED' ? 'bg-amber-100 text-amber-700' :
                        'bg-ink-100 text-ink-700'
                      }`}>
                        {res.outcome_label_cn || res.outcome || '?'}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <AnimatePresence>
          {resolution && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-3 p-3 rounded-xl bg-gradient-to-br from-brand-50 to-accent-50/40 dark:from-brand-950/40 dark:to-accent-950/20 border border-brand-200/50"
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                    {WORKBENCH.companyStance}
                  </div>
                  <div className="text-xl font-bold font-mono text-brand-700 dark:text-brand-300">
                    {resolution.company_position >= 0 ? '+' : ''}{resolution.company_position.toFixed(2)}
                  </div>
                </div>
                <span className={`text-xs px-3 py-1.5 rounded-full font-semibold ${
                  resolution.outcome === 'ADOPTED' ? 'bg-emerald-100 text-emerald-700' :
                  resolution.outcome === 'REJECTED' ? 'bg-rose-100 text-rose-700' :
                  resolution.outcome === 'COMPROMISED' ? 'bg-amber-100 text-amber-700' :
                  'bg-ink-100 text-ink-700'
                }`}>
                  {resolution.outcome_label_cn}
                </span>
              </div>

              <div className="space-y-1.5">
                {resolution.positions
                  .sort((a, b) => b.position - a.position)
                  .map((p) => {
                    const pos = Math.max(-1, Math.min(1, p.position))
                    return (
                      <div key={p.dept_type} className="flex items-center gap-2 text-[11px]">
                        <div className="w-16 text-ink-600 dark:text-ink-300 truncate">{p.dept_name}</div>
                        <div className="flex-1 h-2 rounded-full bg-ink-200/60 dark:bg-ink-800/60 relative overflow-hidden">
                          <div className="absolute top-0 h-full w-px bg-ink-300/50 dark:bg-ink-700/60" style={{ left: '25%' }} aria-hidden="true" />
                          <div className="absolute top-0 h-full w-px bg-ink-400/70 dark:bg-ink-500/70" style={{ left: '50%' }} aria-hidden="true" />
                          <div className="absolute top-0 h-full w-px bg-ink-300/50 dark:bg-ink-700/60" style={{ left: '75%' }} aria-hidden="true" />
                          <div
                            className={`absolute top-0 h-full rounded-full transition-transform ${
                              pos >= 0 ? 'bg-emerald-500' : 'bg-rose-500'
                            }`}
                            style={{
                              left: '50%',
                              width: '50%',
                              transformOrigin: 'left center',
                              transform: `scaleX(${pos})`,
                            }}
                          />
                        </div>
                        <div className={`w-12 text-right font-mono font-semibold ${
                          p.position > 0.2 ? 'text-emerald-600' :
                          p.position < -0.2 ? 'text-rose-600' : 'text-ink-500'
                        }`}>
                          {p.position >= 0 ? '+' : ''}{p.position.toFixed(2)}
                        </div>
                      </div>
                    )
                  })}
              </div>

              <div className="mt-2 text-[11px] text-ink-600 dark:text-ink-400 italic">
                {resolution.summary}
              </div>

              {runId && (
                <button
                  onClick={() => {
                    navigate(APP_ROUTES.simulation(runId), {
                      state: {
                        fromResolution: {
                          topic: topicInput,
                          outcome: resolution.outcome,
                          companyPosition: resolution.company_position,
                          summary: resolution.summary,
                        },
                      },
                    })
                  }}
                  className="mt-3 w-full inline-flex items-center justify-center gap-1.5
                             h-8 px-3 rounded-lg
                             bg-gradient-to-r from-brand-500 to-accent-500
                             text-white text-xs font-semibold
                             hover:from-brand-600 hover:to-accent-600
                             shadow-soft transition-all"
                  title={WORKBENCH.ctaStartNewRoundTitle}
                >
                  <Lightbulb size={12} /> {WORKBENCH.ctaStartNewRound}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  )
}